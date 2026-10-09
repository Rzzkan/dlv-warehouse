import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','staff')),
  password_hash TEXT NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Master jenis kain (mis. Viscose Print, Katun Jepang, Rayon Twill)
CREATE TABLE IF NOT EXISTS materials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  width_cm   REAL,
  min_yards  REAL NOT NULL DEFAULT 0,
  notes      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Dokumen penerimaan barang (satu surat jalan -> banyak roll)
CREATE TABLE IF NOT EXISTS receipts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no  TEXT NOT NULL UNIQUE,
  supplier    TEXT NOT NULL DEFAULT '',
  ref_doc     TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- Satu baris = satu roll fisik dengan satu barcode
CREATE TABLE IF NOT EXISTS rolls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  material_id   INTEGER NOT NULL REFERENCES materials(id),
  receipt_id    INTEGER REFERENCES receipts(id),
  initial_yards REAL NOT NULL,
  current_yards REAL NOT NULL,
  location      TEXT NOT NULL DEFAULT '',
  lot           TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','depleted','void')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rolls_material ON rolls(material_id);
CREATE INDEX IF NOT EXISTS idx_rolls_status   ON rolls(status);

-- Buku mutasi: setiap perubahan yard dicatat (delta + / -)
CREATE TABLE IF NOT EXISTS movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id       INTEGER NOT NULL REFERENCES rolls(id),
  type          TEXT NOT NULL CHECK (type IN ('IN','OUT','ADJUST')),
  delta         REAL NOT NULL,
  balance_after REAL NOT NULL,
  doc_no        TEXT NOT NULL DEFAULT '',
  purpose       TEXT NOT NULL DEFAULT '',
  ref           TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_roll ON movements(roll_id);
CREATE INDEX IF NOT EXISTS idx_movements_time ON movements(created_at);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Jalankan fn dalam satu transaksi; rollback bila terjadi error. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}
