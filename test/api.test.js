import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let t;
let material;

before(async () => {
  t = await startTestServer();
  const res = await t.admin.post('/api/materials', { code: 'vsc-sage', name: 'Viscose Print', color: 'Sage', width_cm: 145, min_yards: 100 });
  assert.equal(res.status, 201);
  material = res.data.material;
});
after(() => t.close());

test('akses tanpa login ditolak', async () => {
  const anon = t.client();
  assert.equal((await anon.get('/api/dashboard')).status, 401);
  assert.equal((await anon.post('/api/auth/login', { username: 'admin', password: 'salah' })).status, 401);
});

test('POST non-JSON ditolak (perlindungan CSRF)', async () => {
  const res = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(res.status, 415);
});

test('kode kain dinormalisasi dan unik', async () => {
  assert.equal(material.code, 'VSC-SAGE');
  const dup = await t.admin.post('/api/materials', { code: 'VSC-SAGE', name: 'Lain' });
  assert.equal(dup.status, 400);
});

test('barang masuk membuat roll, kode barcode unik, dan mutasi IN', async () => {
  const res = await t.admin.post('/api/receipts', {
    supplier: 'CV Sinar Textile',
    ref_doc: 'SJ-001',
    items: [
      { material_id: material.id, yards: 120.5, location: 'A-01' },
      { material_id: material.id, yards: '80,25' },
      { material_id: material.id, yards: 100 },
    ],
  });
  assert.equal(res.status, 201);
  const { receipt, rolls } = res.data;
  assert.match(receipt.receipt_no, /^GR-\d{6}-001$/);
  assert.equal(rolls.length, 3);
  const codes = rolls.map((r) => r.code);
  assert.equal(new Set(codes).size, 3);
  for (const c of codes) assert.match(c, /^DLV\d{6}\d{4}$/);
  assert.equal(rolls[1].initial_yards, 80.25);
  assert.equal(rolls[0].supplier, 'CV Sinar Textile');

  const detail = await t.admin.get(`/api/rolls/${codes[0]}`);
  assert.equal(detail.data.movements.length, 1);
  assert.equal(detail.data.movements[0].type, 'IN');
  assert.equal(detail.data.movements[0].delta, 120.5);
});

test('validasi barang masuk: yard 0, kain tidak ada, kosong', async () => {
  assert.equal((await t.admin.post('/api/receipts', { items: [] })).status, 400);
  assert.equal((await t.admin.post('/api/receipts', { items: [{ material_id: material.id, yards: 0 }] })).status, 400);
  assert.equal((await t.admin.post('/api/receipts', { items: [{ material_id: 9999, yards: 10 }] })).status, 400);
  assert.equal((await t.admin.post('/api/receipts', { items: [{ material_id: material.id, yards: 'abc' }] })).status, 400);
});

test('barang keluar sebagian mengurangi sisa; keluar semua = habis', async () => {
  const list = await t.admin.get('/api/rolls?status=in_stock');
  const roll = list.data.rows.find((r) => r.initial_yards === 100);
  const out1 = await t.admin.post('/api/outbound', { purpose: 'Produksi', ref: 'PO-77', items: [{ code: roll.code, yards: 30.5 }] });
  assert.equal(out1.status, 201);
  assert.match(out1.data.doc_no, /^OUT-\d{6}-001$/);
  assert.equal(out1.data.rolls[0].current_yards, 69.5);
  assert.equal(out1.data.rolls[0].status, 'in_stock');

  const over = await t.admin.post('/api/outbound', { purpose: 'Produksi', items: [{ code: roll.code, yards: 70 }] });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /melebihi sisa/);

  const out2 = await t.admin.post('/api/outbound', { purpose: 'Produksi', items: [{ code: roll.code.toLowerCase(), yards: 69.5 }] });
  assert.equal(out2.status, 201);
  assert.equal(out2.data.rolls[0].current_yards, 0);
  assert.equal(out2.data.rolls[0].status, 'depleted');
  assert.match(out2.data.doc_no, /-002$/);

  const again = await t.admin.post('/api/outbound', { purpose: 'Produksi', items: [{ code: roll.code, yards: 1 }] });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /sudah habis/);
});

test('barang keluar atomik: satu baris gagal -> tidak ada yang berubah', async () => {
  const list = await t.admin.get('/api/rolls?status=in_stock');
  const [a, b] = list.data.rows;
  const before = a.current_yards;
  const res = await t.admin.post('/api/outbound', {
    purpose: 'Sampling',
    items: [{ code: a.code, yards: 1 }, { code: b.code, yards: 99999 }],
  });
  assert.equal(res.status, 400);
  const after = await t.admin.get(`/api/rolls/${a.code}`);
  assert.equal(after.data.roll.current_yards, before);
  assert.equal((await t.admin.post('/api/outbound', { items: [{ code: a.code, yards: 1 }] })).status, 400); // keperluan wajib
  assert.equal((await t.admin.post('/api/outbound', { purpose: 'X', items: [{ code: 'NOPE', yards: 1 }] })).status, 404);
  assert.equal((await t.admin.post('/api/outbound', { purpose: 'X', items: [{ code: a.code, yards: 1 }, { code: a.code, yards: 1 }] })).status, 400);
});

test('penyesuaian stok & void (admin saja)', async () => {
  const list = await t.admin.get('/api/rolls?status=in_stock');
  const roll = list.data.rows[0];
  const noReason = await t.admin.post(`/api/rolls/${roll.code}/adjust`, { new_yards: 50 });
  assert.equal(noReason.status, 400);
  const adj = await t.admin.post(`/api/rolls/${roll.code}/adjust`, { new_yards: 50, notes: 'Opname bulanan' });
  assert.equal(adj.status, 200);
  assert.equal(adj.data.roll.current_yards, 50);
  const detail = await t.admin.get(`/api/rolls/${roll.code}`);
  assert.equal(detail.data.movements[0].type, 'ADJUST');

  // staf biasa tidak boleh void
  assert.equal((await t.admin.post('/api/users', { username: 'gudang1', name: 'Gudang', password: 'passwordku1' })).status, 201);
  const staff = t.client();
  assert.equal((await staff.post('/api/auth/login', { username: 'gudang1', password: 'passwordku1' })).status, 200);
  assert.equal((await staff.post(`/api/rolls/${roll.code}/void`, { reason: 'x' })).status, 403);
  assert.equal((await staff.get('/api/users')).status, 403);
  assert.equal((await staff.put('/api/printer/config', {})).status, 403);

  const v = await t.admin.post(`/api/rolls/${roll.code}/void`, { reason: 'Rusak terkena air' });
  assert.equal(v.status, 200);
  assert.equal(v.data.roll.status, 'void');
});

test('dashboard, stok, riwayat, dan CSV konsisten', async () => {
  const d = (await t.admin.get('/api/dashboard')).data;
  const sum = (await t.admin.get('/api/rolls?status=in_stock')).data.rows.reduce((s, r) => s + r.current_yards, 0);
  assert.equal(d.totals.yards, Math.round(sum * 100) / 100);
  assert.ok(d.in_today.count >= 3);
  assert.ok(d.out_today.yards > 0);
  assert.equal(d.by_material[0].code, 'VSC-SAGE');

  const mv = (await t.admin.get('/api/movements?type=OUT')).data;
  assert.ok(mv.total >= 2);
  assert.ok(mv.rows.every((m) => m.type === 'OUT' && m.delta < 0));
  const csv = await t.admin.get('/api/movements.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Kode Roll/);
});

test('barcode SVG dihasilkan', async () => {
  const res = await t.admin.get('/api/barcode/DLV2610090001.svg');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /svg/);
  assert.match(res.data, /<svg/);
});

test('ganti password mewajibkan password lama', async () => {
  const c = t.client();
  await c.post('/api/auth/login', { username: 'gudang1', password: 'passwordku1' });
  assert.equal((await c.post('/api/auth/password', { current: 'salah', next: 'barubaru123' })).status, 400);
  assert.equal((await c.post('/api/auth/password', { current: 'passwordku1', next: 'pendek' })).status, 400);
  assert.equal((await c.post('/api/auth/password', { current: 'passwordku1', next: 'barubaru123' })).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.username, 'gudang1');
});
