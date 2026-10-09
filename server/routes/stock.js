import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncHandler } from '../util.js';
import {
  receiveRolls, issueRolls, adjustRoll, voidRoll, updateRollInfo,
  listRolls, getRollDetail, listMovements, dashboard,
} from '../services/inventory.js';

const csvCell = (v) => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function stockRoutes({ db, config }) {
  const r = Router();
  r.use(requireAuth);

  r.get('/dashboard', asyncHandler(async (_req, res) => res.json(await dashboard(db, config))));

  // Barang masuk
  r.post('/receipts', asyncHandler(async (req, res) => {
    res.status(201).json(await receiveRolls(db, req.user, config, req.body || {}));
  }));

  r.get('/receipts', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const rows = await db.all(
      `SELECT rc.*, u.name AS user_name,
              (SELECT COUNT(*) FROM rolls r WHERE r.receipt_id = rc.id) AS roll_count,
              (SELECT COALESCE(SUM(r.initial_yards),0) FROM rolls r WHERE r.receipt_id = rc.id) AS total_yards
         FROM receipts rc LEFT JOIN users u ON u.id = rc.user_id
        ORDER BY rc.id DESC LIMIT ?`,
      [limit],
    );
    res.json({ rows });
  }));

  r.get('/receipts/:id/rolls', asyncHandler(async (req, res) => {
    const rows = await db.all('SELECT code FROM rolls WHERE receipt_id = ? ORDER BY id', [Number(req.params.id)]);
    res.json({ codes: rows.map((x) => x.code) });
  }));

  // Barang keluar
  r.post('/outbound', asyncHandler(async (req, res) => {
    res.status(201).json(await issueRolls(db, req.user, config, req.body || {}));
  }));

  // Roll
  r.get('/rolls', asyncHandler(async (req, res) => res.json(await listRolls(db, req.query))));
  r.get('/rolls/:code', asyncHandler(async (req, res) => res.json(await getRollDetail(db, req.params.code))));
  r.patch('/rolls/:code', asyncHandler(async (req, res) => res.json({ roll: await updateRollInfo(db, req.params.code, req.body || {}) })));
  r.post('/rolls/:code/adjust', asyncHandler(async (req, res) => res.json({ roll: await adjustRoll(db, req.user, req.params.code, req.body || {}) })));
  r.post('/rolls/:code/void', requireAdmin, asyncHandler(async (req, res) => res.json({ roll: await voidRoll(db, req.user, req.params.code, req.body || {}) })));

  // Riwayat mutasi
  r.get('/movements', asyncHandler(async (req, res) => res.json(await listMovements(db, config, req.query))));

  r.get('/movements.csv', asyncHandler(async (req, res) => {
    const { rows } = await listMovements(db, config, { ...req.query, limit: 5000, offset: 0 });
    const head = ['Waktu (UTC)', 'Tipe', 'Dokumen', 'Kode Roll', 'Kain', 'Warna', 'Yard (+/-)', 'Sisa', 'Keperluan', 'Referensi', 'Catatan', 'Petugas'];
    const lines = [head.join(',')];
    for (const m of rows) {
      lines.push([m.created_at, m.type, m.doc_no, m.roll_code, m.material_name, m.material_color, m.delta, m.balance_after, m.purpose, m.ref, m.notes, m.user_name].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mutasi-gudang.csv"');
    res.send('﻿' + lines.join('\r\n'));
  }));

  return r;
}
