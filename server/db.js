import mysql from 'mysql2/promise';

const TABLE_OPTS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

// Urutan penting: tabel yang direferensikan harus dibuat lebih dulu.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(60)  NOT NULL,
    name          VARCHAR(120) NOT NULL,
    role          ENUM('admin','staff') NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    must_change   TINYINT(1)   NOT NULL DEFAULT 0,
    active        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME(3)  NOT NULL,
    UNIQUE KEY uq_users_username (username)
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64)     NOT NULL PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    expires_at DATETIME(3)  NOT NULL,
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS settings (
    skey   VARCHAR(64) NOT NULL PRIMARY KEY,
    svalue TEXT        NOT NULL
  ) ${TABLE_OPTS}`,

  // Penghitung nomor urut atomik (kode roll harian, nomor dokumen GR/OUT)
  `CREATE TABLE IF NOT EXISTS counters (
    name  VARCHAR(64)     NOT NULL PRIMARY KEY,
    value BIGINT UNSIGNED NOT NULL
  ) ${TABLE_OPTS}`,

  // Master jenis kain (mis. Viscose Print, Katun Jepang, Rayon Twill)
  `CREATE TABLE IF NOT EXISTS materials (
    id         INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code       VARCHAR(30)   NOT NULL,
    name       VARCHAR(80)   NOT NULL,
    color      VARCHAR(40)   NOT NULL DEFAULT '',
    width_cm   DECIMAL(7,2)  NULL,
    min_yards  DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes      VARCHAR(300)  NOT NULL DEFAULT '',
    active     TINYINT(1)    NOT NULL DEFAULT 1,
    created_at DATETIME(3)   NOT NULL,
    UNIQUE KEY uq_materials_code (code)
  ) ${TABLE_OPTS}`,

  // Dokumen penerimaan barang (satu surat jalan -> banyak roll)
  `CREATE TABLE IF NOT EXISTS receipts (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receipt_no  VARCHAR(30)  NOT NULL,
    supplier    VARCHAR(120) NOT NULL DEFAULT '',
    ref_doc     VARCHAR(80)  NOT NULL DEFAULT '',
    received_at DATE         NOT NULL,
    notes       VARCHAR(500) NOT NULL DEFAULT '',
    user_id     INT UNSIGNED NULL,
    created_at  DATETIME(3)  NOT NULL,
    UNIQUE KEY uq_receipts_no (receipt_no),
    CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ${TABLE_OPTS}`,

  // Satu baris = satu roll fisik dengan satu barcode
  `CREATE TABLE IF NOT EXISTS rolls (
    id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code          VARCHAR(40)   NOT NULL,
    material_id   INT UNSIGNED  NOT NULL,
    receipt_id    INT UNSIGNED  NULL,
    initial_yards DECIMAL(12,2) NOT NULL,
    current_yards DECIMAL(12,2) NOT NULL,
    location      VARCHAR(60)   NOT NULL DEFAULT '',
    lot           VARCHAR(60)   NOT NULL DEFAULT '',
    notes         VARCHAR(300)  NOT NULL DEFAULT '',
    status        ENUM('in_stock','depleted','void') NOT NULL DEFAULT 'in_stock',
    created_at    DATETIME(3)   NOT NULL,
    updated_at    DATETIME(3)   NOT NULL,
    UNIQUE KEY uq_rolls_code (code),
    KEY idx_rolls_material (material_id),
    KEY idx_rolls_status (status),
    KEY idx_rolls_receipt (receipt_id),
    CONSTRAINT fk_rolls_material FOREIGN KEY (material_id) REFERENCES materials(id),
    CONSTRAINT fk_rolls_receipt  FOREIGN KEY (receipt_id)  REFERENCES receipts(id)
  ) ${TABLE_OPTS}`,

  // Buku mutasi: setiap perubahan yard dicatat (delta + / -)
  `CREATE TABLE IF NOT EXISTS movements (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    roll_id       INT UNSIGNED    NOT NULL,
    type          ENUM('IN','OUT','ADJUST') NOT NULL,
    delta         DECIMAL(12,2)   NOT NULL,
    balance_after DECIMAL(12,2)   NOT NULL,
    doc_no        VARCHAR(30)     NOT NULL DEFAULT '',
    purpose       VARCHAR(80)     NOT NULL DEFAULT '',
    ref           VARCHAR(80)     NOT NULL DEFAULT '',
    notes         VARCHAR(500)    NOT NULL DEFAULT '',
    user_id       INT UNSIGNED    NULL,
    created_at    DATETIME(3)     NOT NULL,
    KEY idx_movements_roll (roll_id),
    KEY idx_movements_time (created_at),
    KEY idx_movements_doc (doc_no),
    CONSTRAINT fk_movements_roll FOREIGN KEY (roll_id) REFERENCES rolls(id),
    CONSTRAINT fk_movements_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ${TABLE_OPTS}`,
];

const DB_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

const poolOptions = (db) => ({
  host: db.host,
  port: db.port,
  user: db.user,
  password: db.password,
  charset: 'utf8mb4',
  timezone: 'Z', // semua DATETIME disimpan & dibaca sebagai UTC
  decimalNumbers: true, // DECIMAL -> number JS (yard maks 2 desimal, aman)
  dateStrings: ['DATE'], // kolom DATE (tanggal terima) tetap 'YYYY-MM-DD'
  waitForConnections: true,
  connectionLimit: db.poolSize || 10,
});

/** Bungkus executor (pool atau koneksi transaksi) dengan helper all/get/run. */
function wrap(exec, extra = {}) {
  return {
    ...extra,
    exec,
    async all(sql, params = []) {
      const [rows] = await exec.query(sql, params);
      return rows;
    },
    async get(sql, params = []) {
      const [rows] = await exec.query(sql, params);
      return rows[0] ?? null;
    },
    async run(sql, params = []) {
      const [res] = await exec.query(sql, params);
      return { insertId: Number(res.insertId), affectedRows: res.affectedRows };
    },
  };
}

/** Buka koneksi (membuat database & tabel bila perlu). */
export async function openDb(config) {
  const cfg = config.db;
  if (!DB_NAME_RE.test(cfg.database)) throw new Error('DB_NAME hanya boleh huruf, angka, underscore');

  if (cfg.autoCreate) {
    const admin = await mysql.createConnection(poolOptions(cfg));
    try {
      await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (err) {
      // Tanpa hak CREATE: lanjut, mungkin database sudah dibuat administrator
      if (!['ER_DBACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(err.code)) throw err;
    } finally {
      await admin.end();
    }
  }

  const pool = mysql.createPool({ ...poolOptions(cfg), database: cfg.database });
  try {
    for (const ddl of SCHEMA) await pool.query(ddl);
  } catch (err) {
    await pool.end();
    throw err;
  }
  const db = wrap(pool, { pool, inTx: false });
  db.close = () => pool.end();
  return db;
}

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Jalankan fn(txDb) dalam satu transaksi (READ COMMITTED); rollback bila error.
 * Deadlock dicoba ulang otomatis. Bila sudah di dalam transaksi, fn memakai transaksi yang sama.
 */
export async function tx(db, fn) {
  if (db.inTx) return fn(db);
  for (let attempt = 1; ; attempt++) {
    const conn = await db.pool.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const result = await fn(wrap(conn, { pool: db.pool, inTx: true }));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (RETRYABLE.has(err.code) && attempt < 3) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

/**
 * Alokasikan `count` nomor urut berurutan untuk `name` secara atomik.
 * Harus dipanggil di dalam tx(); mengembalikan nomor pertama. Baris counter terkunci sampai commit,
 * sehingga permintaan paralel tidak pernah mendapat nomor yang sama, dan rollback tidak meninggalkan lubang.
 */
export async function allocateSeq(db, name, count = 1) {
  if (!db.inTx) throw new Error('allocateSeq harus dipanggil di dalam transaksi');
  await db.run('INSERT INTO counters(name, value) VALUES(?, ?) ON DUPLICATE KEY UPDATE value = value + ?', [name, count, count]);
  const row = await db.get('SELECT value FROM counters WHERE name = ?', [name]);
  return Number(row.value) - count + 1;
}

export async function getSetting(db, key, fallback = null) {
  const row = await db.get('SELECT svalue FROM settings WHERE skey = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.svalue);
  } catch {
    return fallback;
  }
}

export async function setSetting(db, key, value) {
  await db.run(
    'INSERT INTO settings(skey, svalue) VALUES(?, ?) ON DUPLICATE KEY UPDATE svalue = ?',
    [key, JSON.stringify(value), JSON.stringify(value)],
  );
}
