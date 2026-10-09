import { Router } from 'express';
import { requireAuth, requireAdmin, hashPassword, destroyUserSessions } from '../auth.js';
import { getSetting, setSetting } from '../db.js';
import { bad, notFound, cleanStr, reqStr, now, asyncHandler } from '../util.js';

function parseMaterial(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.code !== undefined) out.code = reqStr(body.code, 'Kode kain', 30).toUpperCase().replace(/\s+/g, '-');
  if (!partial || body.name !== undefined) out.name = reqStr(body.name, 'Nama kain', 80);
  if (!partial || body.color !== undefined) out.color = cleanStr(body.color, 40);
  if (!partial || body.width_cm !== undefined) {
    const w = body.width_cm === '' || body.width_cm === null || body.width_cm === undefined ? null : Number(body.width_cm);
    if (w !== null && (!Number.isFinite(w) || w <= 0 || w > 1000)) throw bad('Lebar kain (cm) tidak valid');
    out.width_cm = w;
  }
  if (!partial || body.min_yards !== undefined) {
    const n = Number(body.min_yards ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 1000000) throw bad('Stok minimum tidak valid');
    out.min_yards = n;
  }
  if (!partial || body.notes !== undefined) out.notes = cleanStr(body.notes, 300);
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return out;
}

export function masterRoutes({ db }) {
  const r = Router();
  r.use(requireAuth);

  // ---- Jenis kain ----
  r.get('/materials', asyncHandler(async (req, res) => {
    const all = req.query.all === '1';
    const rows = await db.all(
      `SELECT m.*,
              (SELECT COALESCE(SUM(r.current_yards),0) FROM rolls r WHERE r.material_id = m.id AND r.status = 'in_stock') AS stock_yards,
              (SELECT COUNT(*) FROM rolls r WHERE r.material_id = m.id AND r.status = 'in_stock') AS stock_rolls
         FROM materials m ${all ? '' : 'WHERE m.active = 1'} ORDER BY m.name, m.color`,
    );
    res.json({ rows });
  }));

  r.post('/materials', asyncHandler(async (req, res) => {
    const m = parseMaterial(req.body || {});
    if (await db.get('SELECT 1 AS x FROM materials WHERE code = ?', [m.code])) throw bad(`Kode kain ${m.code} sudah dipakai`);
    const info = await db.run(
      'INSERT INTO materials(code, name, color, width_cm, min_yards, notes, active, created_at) VALUES(?,?,?,?,?,?,1,?)',
      [m.code, m.name, m.color, m.width_cm, m.min_yards, m.notes, now()],
    );
    res.status(201).json({ material: await db.get('SELECT * FROM materials WHERE id = ?', [info.insertId]) });
  }));

  r.patch('/materials/:id', asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT * FROM materials WHERE id = ?', [Number(req.params.id)]);
    if (!cur) throw notFound('Jenis kain tidak ditemukan');
    const m = { ...cur, ...parseMaterial(req.body || {}, { partial: true }) };
    if (await db.get('SELECT id FROM materials WHERE code = ? AND id <> ?', [m.code, cur.id])) throw bad(`Kode kain ${m.code} sudah dipakai`);
    await db.run('UPDATE materials SET code=?, name=?, color=?, width_cm=?, min_yards=?, notes=?, active=? WHERE id=?', [
      m.code, m.name, m.color, m.width_cm, m.min_yards, m.notes, m.active, cur.id,
    ]);
    res.json({ material: await db.get('SELECT * FROM materials WHERE id = ?', [cur.id]) });
  }));

  // ---- Pengguna (admin) ----
  r.get('/users', requireAdmin, asyncHandler(async (_req, res) => {
    res.json({ rows: await db.all('SELECT id, username, name, role, active, created_at FROM users ORDER BY id') });
  }));

  r.post('/users', requireAdmin, asyncHandler(async (req, res) => {
    const username = reqStr(req.body?.username, 'Username', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Username 3-40 karakter: huruf kecil, angka, titik, minus, underscore');
    const name = reqStr(req.body?.name, 'Nama', 80);
    const role = req.body?.role === 'admin' ? 'admin' : 'staff';
    const password = String(req.body?.password ?? '');
    if (password.length < 8) throw bad('Password minimal 8 karakter');
    if (await db.get('SELECT 1 AS x FROM users WHERE username = ?', [username])) throw bad('Username sudah dipakai');
    const info = await db.run(
      'INSERT INTO users(username, name, role, password_hash, must_change, active, created_at) VALUES(?,?,?,?,0,1,?)',
      [username, name, role, hashPassword(password), now()],
    );
    res.status(201).json({ user: await db.get('SELECT id, username, name, role, active FROM users WHERE id = ?', [info.insertId]) });
  }));

  r.patch('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!cur) throw notFound('Pengguna tidak ditemukan');
    const name = req.body?.name !== undefined ? reqStr(req.body.name, 'Nama', 80) : cur.name;
    const role = req.body?.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'staff') : cur.role;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : cur.active;
    if (id === req.user.id && (!active || role !== 'admin')) throw bad('Anda tidak bisa menonaktifkan atau menurunkan akun Anda sendiri');
    if (req.body?.password && String(req.body.password).length < 8) throw bad('Password minimal 8 karakter');
    await db.run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [name, role, active, id]);
    if (req.body?.password) {
      await db.run('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', [hashPassword(String(req.body.password)), id]);
      await destroyUserSessions(db, id);
    }
    if (!active) await destroyUserSessions(db, id);
    res.json({ user: await db.get('SELECT id, username, name, role, active FROM users WHERE id = ?', [id]) });
  }));

  // ---- Pengaturan umum ----
  r.get('/settings/general', asyncHandler(async (_req, res) => {
    res.json({
      barcode_prefix: await getSetting(db, 'barcode_prefix', 'DLV'),
      company_name: await getSetting(db, 'company_name', 'Delova Wardrobe'),
    });
  }));

  r.put('/settings/general', requireAdmin, asyncHandler(async (req, res) => {
    const prefix = reqStr(req.body?.barcode_prefix, 'Prefix barcode', 5).toUpperCase();
    if (!/^[A-Z0-9]{1,5}$/.test(prefix)) throw bad('Prefix barcode: 1-5 huruf/angka (tanpa spasi atau simbol)');
    await setSetting(db, 'barcode_prefix', prefix);
    await setSetting(db, 'company_name', cleanStr(req.body?.company_name, 60) || 'Delova Wardrobe');
    res.json({ barcode_prefix: prefix, company_name: await getSetting(db, 'company_name') });
  }));

  return r;
}
