import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncHandler } from '../util.js';
import {
  receiveRolls, issueRolls, adjustRoll, voidRoll, updateRollInfo,
  listRolls, getRollDetail, listMovements, dashboard,
} from '../services/inventory.js';

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function stockRoutes({ db, config }) {
  const r = Router();
  r.use(requireAuth);

  r.get('/dashboard', (_req, res) => res.json(dashboard(db, config)));

  // Barang masuk
  r.post('/receipts', asyncHandler(async (req, res) => {
    res.status(201).json(receiveRolls(db, req.user, config, req.body || {}));
  }));

  r.get('/receipts', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const rows = db
      .prepare(
        `SELECT rc.*, u.name AS user_name, COUNT(r.id) AS roll_count, COALESCE(SUM(r.initial_yards),0) AS total_yards
           FROM receipts rc LEFT JOIN users u ON u.id = rc.user_id LEFT JOIN rolls r ON r.receipt_id = rc.id
          GROUP BY rc.id ORDER BY rc.id DESC LIMIT ?`,
      )
      .all(limit);
    res.json({ rows });
  });

  r.get('/receipts/:id/rolls', (req, res) => {
    const rows = db.prepare('SELECT code FROM rolls WHERE receipt_id = ? ORDER BY id').all(Number(req.params.id));
    res.json({ codes: rows.map((x) => x.code) });
  });

  // Barang keluar
  r.post('/outbound', asyncHandler(async (req, res) => {
    res.status(201).json(issueRolls(db, req.user, config, req.body || {}));
  }));

  // Roll
  r.get('/rolls', (req, res) => res.json(listRolls(db, req.query)));
  r.get('/rolls/:code', (req, res) => res.json(getRollDetail(db, req.params.code)));
  r.patch('/rolls/:code', (req, res) => res.json({ roll: updateRollInfo(db, req.params.code, req.body || {}) }));
  r.post('/rolls/:code/adjust', (req, res) => res.json({ roll: adjustRoll(db, req.user, req.params.code, req.body || {}) }));
  r.post('/rolls/:code/void', requireAdmin, (req, res) => res.json({ roll: voidRoll(db, req.user, req.params.code, req.body || {}) }));

  // Riwayat mutasi
  r.get('/movements', (req, res) => res.json(listMovements(db, config, req.query)));

  r.get('/movements.csv', (req, res) => {
    const { rows } = listMovements(db, config, { ...req.query, limit: 5000, offset: 0 });
    const head = ['Waktu (UTC)', 'Tipe', 'Dokumen', 'Kode Roll', 'Kain', 'Warna', 'Yard (+/-)', 'Sisa', 'Keperluan', 'Referensi', 'Catatan', 'Petugas'];
    const lines = [head.join(',')];
    for (const m of rows) {
      lines.push([m.created_at, m.type, m.doc_no, m.roll_code, m.material_name, m.material_color, m.delta, m.balance_after, m.purpose, m.ref, m.notes, m.user_name].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mutasi-gudang.csv"');
    res.send('﻿' + lines.join('\r\n'));
  });

  return r;
}
