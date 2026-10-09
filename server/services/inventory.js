import { tx, getSetting } from '../db.js';
import { bad, notFound, round2, parseYards, cleanStr, reqStr, nowIso, localDate } from '../util.js';

const EPS = 0.005;
export const MAX_ROLLS_PER_RECEIPT = 200;
export const MAX_ITEMS_PER_OUTBOUND = 200;

export const normalizeCode = (code) => cleanStr(code, 64).toUpperCase();

export function getPrefix(db) {
  const prefix = getSetting(db, 'barcode_prefix', 'DLV');
  return /^[A-Z0-9]{1,5}$/.test(prefix) ? prefix : 'DLV';
}

const yymmdd = (isoDate) => isoDate.slice(2, 4) + isoDate.slice(5, 7) + isoDate.slice(8, 10);

/** Nomor urut harian berikutnya untuk pola `${prefix}${tanggal}${urut4}`. */
function nextRollSeq(db, stem) {
  const row = db
    .prepare('SELECT MAX(CAST(SUBSTR(code, ?) AS INTEGER)) m FROM rolls WHERE code LIKE ?')
    .get(stem.length + 1, `${stem}%`);
  return (row.m || 0) + 1;
}

function nextDocNo(db, table, column, prefix, day) {
  const stem = `${prefix}-${yymmdd(day)}-`;
  const row = db
    .prepare(`SELECT MAX(CAST(SUBSTR(${column}, ?) AS INTEGER)) m FROM ${table} WHERE ${column} LIKE ?`)
    .get(stem.length + 1, `${stem}%`);
  return `${stem}${String((row.m || 0) + 1).padStart(3, '0')}`;
}

const ROLL_SELECT = `
  SELECT r.*, m.code AS material_code, m.name AS material_name, m.color AS material_color,
         m.width_cm AS material_width_cm,
         rc.receipt_no, rc.supplier, rc.ref_doc, rc.received_at
    FROM rolls r
    JOIN materials m ON m.id = r.material_id
    LEFT JOIN receipts rc ON rc.id = r.receipt_id`;

export function findRoll(db, code) {
  return db.prepare(`${ROLL_SELECT} WHERE r.code = ?`).get(normalizeCode(code)) || null;
}

export function getRollOrThrow(db, code) {
  const roll = findRoll(db, code);
  if (!roll) throw notFound(`Roll dengan kode ${normalizeCode(code)} tidak ditemukan`);
  return roll;
}

export function getRollDetail(db, code) {
  const roll = getRollOrThrow(db, code);
  const movements = db
    .prepare(
      `SELECT mv.*, u.name AS user_name
         FROM movements mv LEFT JOIN users u ON u.id = mv.user_id
        WHERE mv.roll_id = ? ORDER BY mv.id DESC`,
    )
    .all(roll.id);
  return { roll, movements };
}

export function listRolls(db, { q, status, material_id, limit = 50, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (status && status !== 'all') {
    where.push('r.status = ?');
    args.push(status);
  }
  if (material_id) {
    where.push('r.material_id = ?');
    args.push(Number(material_id));
  }
  if (q) {
    const like = `%${cleanStr(q, 80)}%`;
    where.push('(r.code LIKE ? OR m.name LIKE ? OR m.code LIKE ? OR m.color LIKE ? OR r.lot LIKE ? OR r.location LIKE ? OR rc.supplier LIKE ?)');
    args.push(like, like, like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const total = db
    .prepare(`SELECT COUNT(*) c FROM rolls r JOIN materials m ON m.id = r.material_id LEFT JOIN receipts rc ON rc.id = r.receipt_id ${clause}`)
    .get(...args).c;
  const rows = db.prepare(`${ROLL_SELECT} ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, lim, off);
  return { rows, total };
}

function insertMovement(db, m) {
  db.prepare(
    `INSERT INTO movements(roll_id, type, delta, balance_after, doc_no, purpose, ref, notes, user_id, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(m.roll_id, m.type, m.delta, m.balance_after, m.doc_no || '', m.purpose || '', m.ref || '', m.notes || '', m.user_id ?? null, m.created_at);
}

/**
 * Barang masuk: satu dokumen penerimaan, banyak roll. Setiap roll mendapat kode barcode unik.
 * items: [{ material_id, yards, location?, lot?, notes? }]
 */
export function receiveRolls(db, user, config, payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw bad('Tambahkan minimal satu roll');
  if (items.length > MAX_ROLLS_PER_RECEIPT) throw bad(`Maksimal ${MAX_ROLLS_PER_RECEIPT} roll per penerimaan`);

  const supplier = cleanStr(payload.supplier, 120);
  const refDoc = cleanStr(payload.ref_doc, 80);
  const notes = cleanStr(payload.notes, 500);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(payload.received_at || '') ? payload.received_at : localDate(config.tzOffsetMinutes);

  return tx(db, () => {
    const prefix = getPrefix(db);
    const now = nowIso();
    const receiptNo = nextDocNo(db, 'receipts', 'receipt_no', 'GR', day);
    const rc = db
      .prepare('INSERT INTO receipts(receipt_no, supplier, ref_doc, received_at, notes, user_id, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(receiptNo, supplier, refDoc, day, notes, user?.id ?? null, now);
    const receiptId = Number(rc.lastInsertRowid);

    const stem = `${prefix}${yymmdd(day)}`;
    let seq = nextRollSeq(db, stem);
    const codes = [];

    items.forEach((it, i) => {
      const material = db.prepare('SELECT id, active FROM materials WHERE id = ?').get(Number(it.material_id));
      if (!material || !material.active) throw bad(`Baris ${i + 1}: jenis kain tidak valid`);
      const yards = parseYards(it.yards, `Baris ${i + 1}: yard`);
      const code = `${stem}${String(seq++).padStart(4, '0')}`;
      const r = db
        .prepare(
          `INSERT INTO rolls(code, material_id, receipt_id, initial_yards, current_yards, location, lot, notes, status, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?, 'in_stock', ?, ?)`,
        )
        .run(code, material.id, receiptId, yards, yards, cleanStr(it.location, 60), cleanStr(it.lot, 60), cleanStr(it.notes, 300), now, now);
      insertMovement(db, {
        roll_id: Number(r.lastInsertRowid),
        type: 'IN',
        delta: yards,
        balance_after: yards,
        doc_no: receiptNo,
        purpose: 'Barang masuk',
        ref: refDoc,
        notes: supplier ? `Supplier: ${supplier}` : '',
        user_id: user?.id,
        created_at: now,
      });
      codes.push(code);
    });

    return {
      receipt: db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId),
      rolls: codes.map((c) => findRoll(db, c)),
    };
  });
}

/**
 * Barang keluar (bisa sebagian roll). Semua baris divalidasi dulu, lalu diterapkan atomik.
 * items: [{ code, yards }]
 */
export function issueRolls(db, user, config, payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw bad('Scan atau tambahkan minimal satu roll');
  if (items.length > MAX_ITEMS_PER_OUTBOUND) throw bad(`Maksimal ${MAX_ITEMS_PER_OUTBOUND} roll per dokumen`);
  const purpose = reqStr(payload.purpose, 'Keperluan', 80);
  const ref = cleanStr(payload.ref, 80);
  const notes = cleanStr(payload.notes, 500);

  return tx(db, () => {
    const seen = new Set();
    const planned = items.map((it, i) => {
      const code = normalizeCode(it.code);
      if (!code) throw bad(`Baris ${i + 1}: kode roll kosong`);
      if (seen.has(code)) throw bad(`Roll ${code} muncul lebih dari sekali`);
      seen.add(code);
      const roll = getRollOrThrow(db, code);
      if (roll.status === 'void') throw bad(`Roll ${code} sudah di-void`);
      if (roll.status === 'depleted') throw bad(`Roll ${code} sudah habis`);
      const yards = parseYards(it.yards, `Roll ${code}: yard keluar`);
      if (yards > roll.current_yards + EPS) {
        throw bad(`Roll ${code}: yard keluar (${yards}) melebihi sisa (${roll.current_yards})`);
      }
      return { roll, yards: Math.min(yards, roll.current_yards) };
    });

    const day = localDate(config.tzOffsetMinutes);
    const docNo = nextDocNo(db, 'movements', 'doc_no', 'OUT', day);
    const now = nowIso();
    const results = planned.map(({ roll, yards }) => {
      const remaining = round2(roll.current_yards - yards);
      const status = remaining < EPS ? 'depleted' : 'in_stock';
      db.prepare('UPDATE rolls SET current_yards = ?, status = ?, updated_at = ? WHERE id = ?').run(
        status === 'depleted' ? 0 : remaining,
        status,
        now,
        roll.id,
      );
      insertMovement(db, {
        roll_id: roll.id,
        type: 'OUT',
        delta: -yards,
        balance_after: status === 'depleted' ? 0 : remaining,
        doc_no: docNo,
        purpose,
        ref,
        notes,
        user_id: user?.id,
        created_at: now,
      });
      return findRoll(db, roll.code);
    });
    return { doc_no: docNo, rolls: results };
  });
}

/** Penyesuaian stok (stock opname): set yard sisa ke nilai yang benar. */
export function adjustRoll(db, user, code, payload) {
  const notes = reqStr(payload?.notes, 'Alasan penyesuaian', 300);
  const target = Number(String(payload?.new_yards ?? '').replace(',', '.'));
  if (!Number.isFinite(target) || target < 0 || target > 100000) throw bad('Yard baru harus angka 0 atau lebih');
  const newYards = round2(target);

  return tx(db, () => {
    const roll = getRollOrThrow(db, code);
    if (roll.status === 'void') throw bad('Roll sudah di-void');
    const delta = round2(newYards - roll.current_yards);
    if (Math.abs(delta) < EPS) throw bad('Yard baru sama dengan sisa saat ini');
    const status = newYards < EPS ? 'depleted' : 'in_stock';
    const now = nowIso();
    db.prepare('UPDATE rolls SET current_yards = ?, status = ?, updated_at = ? WHERE id = ?').run(newYards, status, now, roll.id);
    insertMovement(db, {
      roll_id: roll.id,
      type: 'ADJUST',
      delta,
      balance_after: newYards,
      purpose: 'Penyesuaian stok',
      notes,
      user_id: user?.id,
      created_at: now,
    });
    return findRoll(db, roll.code);
  });
}

export function voidRoll(db, user, code, payload) {
  const reason = reqStr(payload?.reason, 'Alasan void', 300);
  return tx(db, () => {
    const roll = getRollOrThrow(db, code);
    if (roll.status === 'void') throw bad('Roll sudah di-void');
    const now = nowIso();
    db.prepare("UPDATE rolls SET current_yards = 0, status = 'void', updated_at = ? WHERE id = ?").run(now, roll.id);
    insertMovement(db, {
      roll_id: roll.id,
      type: 'ADJUST',
      delta: -roll.current_yards,
      balance_after: 0,
      purpose: 'VOID',
      notes: reason,
      user_id: user?.id,
      created_at: now,
    });
    return findRoll(db, roll.code);
  });
}

export function updateRollInfo(db, code, payload) {
  const roll = getRollOrThrow(db, code);
  const location = payload.location !== undefined ? cleanStr(payload.location, 60) : roll.location;
  const lot = payload.lot !== undefined ? cleanStr(payload.lot, 60) : roll.lot;
  const notes = payload.notes !== undefined ? cleanStr(payload.notes, 300) : roll.notes;
  db.prepare('UPDATE rolls SET location = ?, lot = ?, notes = ?, updated_at = ? WHERE id = ?').run(location, lot, notes, nowIso(), roll.id);
  return findRoll(db, roll.code);
}

export function listMovements(db, config, { type, from, to, q, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  const tz = `${Number(config.tzOffsetMinutes) >= 0 ? '+' : ''}${Number(config.tzOffsetMinutes)} minutes`;
  if (['IN', 'OUT', 'ADJUST'].includes(type)) {
    where.push('mv.type = ?');
    args.push(type);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) {
    where.push(`date(mv.created_at, '${tz}') >= ?`);
    args.push(from);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    where.push(`date(mv.created_at, '${tz}') <= ?`);
    args.push(to);
  }
  if (q) {
    const like = `%${cleanStr(q, 80)}%`;
    where.push('(r.code LIKE ? OR m.name LIKE ? OR mv.doc_no LIKE ? OR mv.ref LIKE ? OR mv.purpose LIKE ?)');
    args.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM movements mv
      JOIN rolls r ON r.id = mv.roll_id
      JOIN materials m ON m.id = r.material_id
      LEFT JOIN users u ON u.id = mv.user_id ${clause}`;
  const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...args).c;
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 5000);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = db
    .prepare(
      `SELECT mv.*, r.code AS roll_code, m.name AS material_name, m.color AS material_color, u.name AS user_name
       ${base} ORDER BY mv.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, lim, off);
  return { rows, total };
}

export function dashboard(db, config) {
  const tz = `${Number(config.tzOffsetMinutes) >= 0 ? '+' : ''}${Number(config.tzOffsetMinutes)} minutes`;
  const today = localDate(config.tzOffsetMinutes);
  const totals = db.prepare("SELECT COUNT(*) rolls, COALESCE(SUM(current_yards),0) yards FROM rolls WHERE status = 'in_stock'").get();
  const dayStats = db
    .prepare(
      `SELECT type, COUNT(*) n, COALESCE(SUM(ABS(delta)),0) yards
         FROM movements WHERE date(created_at, '${tz}') = ? AND type IN ('IN','OUT') GROUP BY type`,
    )
    .all(today);
  const stat = (t) => dayStats.find((d) => d.type === t) || { n: 0, yards: 0 };
  const byMaterial = db
    .prepare(
      `SELECT m.id, m.code, m.name, m.color, m.min_yards,
              COUNT(r.id) AS rolls, COALESCE(SUM(r.current_yards),0) AS yards
         FROM materials m LEFT JOIN rolls r ON r.material_id = m.id AND r.status = 'in_stock'
        WHERE m.active = 1 GROUP BY m.id ORDER BY yards DESC, m.name`,
    )
    .all()
    .map((m) => ({ ...m, yards: round2(m.yards), low: m.min_yards > 0 && m.yards < m.min_yards }));
  return {
    today,
    totals: { rolls: totals.rolls, yards: round2(totals.yards) },
    in_today: { count: stat('IN').n, yards: round2(stat('IN').yards) },
    out_today: { count: stat('OUT').n, yards: round2(stat('OUT').yards) },
    by_material: byMaterial,
    low_stock: byMaterial.filter((m) => m.low),
    recent: listMovements(db, config, { limit: 8 }).rows,
  };
}
