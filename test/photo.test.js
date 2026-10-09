import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let t;
let code;

// JPEG minimal valid-header (cukup untuk uji sniff); isi dipadatkan agar ukurannya realistis
const jpegBuf = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]);
const dataUrl = (buf, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;

before(async () => {
  t = await startTestServer();
  const m = (await t.admin.post('/api/materials', { code: 'PH-1', name: 'Kain Foto' })).data.material;
  const rec = await t.admin.post('/api/receipts', { items: [{ material_id: m.id, yards: 50 }] });
  code = rec.data.rolls[0].code;
});
after(() => t.close());

test('roll baru belum punya foto; GET foto = 404', async () => {
  assert.equal((await t.admin.get(`/api/rolls/${code}`)).data.roll.photo_at, null);
  assert.equal((await t.admin.get(`/api/rolls/${code}/photo`)).status, 404);
});

test('unggah foto -> bisa diambil kembali persis sama, tampil di detail & daftar', async () => {
  const buf = jpegBuf();
  const up = await t.admin.put(`/api/rolls/${code}/photo`, { image: dataUrl(buf) });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const res = await fetch(`${t.base}/api/rolls/${code}/photo`, { headers: { Cookie: await cookieOf() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(buf));
  assert.ok((await t.admin.get(`/api/rolls/${code}`)).data.roll.photo_at);
  const list = await t.admin.get('/api/rolls?status=in_stock');
  assert.ok(list.data.rows.find((r) => r.code === code).photo_at);
});

async function cookieOf() {
  const c = t.client();
  await c.post('/api/auth/login', { username: 'admin', password: 'rahasia123' });
  const r = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'rahasia123' }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('foto bisa diganti (satu foto per roll)', async () => {
  const second = jpegBuf(500);
  assert.equal((await t.admin.put(`/api/rolls/${code}/photo`, { image: dataUrl(second) })).status, 200);
  const res = await fetch(`${t.base}/api/rolls/${code}/photo`, { headers: { Cookie: await cookieOf() } });
  assert.equal(Buffer.from(await res.arrayBuffer()).length, second.length);
  const n = await t.db.get('SELECT COUNT(*) c FROM roll_photos');
  assert.equal(n.c, 1);
});

test('validasi: bukan gambar, header palsu, terlalu besar, roll tidak ada, tanpa login', async () => {
  assert.equal((await t.admin.put(`/api/rolls/${code}/photo`, { image: 'bukan gambar' })).status, 400);
  assert.equal((await t.admin.put(`/api/rolls/${code}/photo`, { image: dataUrl(Buffer.from('<script>alert(1)</script>')) })).status, 400, 'isi bukan gambar');
  assert.equal((await t.admin.put(`/api/rolls/${code}/photo`, { image: dataUrl(jpegBuf(2.1 * 1024 * 1024)) })).status, 400, '>2MB');
  assert.equal((await t.admin.put(`/api/rolls/TIDAKADA/photo`, { image: dataUrl(jpegBuf()) })).status, 404);
  assert.equal((await t.client().put(`/api/rolls/${code}/photo`, { image: dataUrl(jpegBuf()) })).status, 401);
  // body JSON global tetap dibatasi 1MB di rute lain
  const big = await t.admin.post('/api/materials', { code: 'X', name: 'y'.repeat(1.2 * 1024 * 1024) });
  assert.equal(big.status, 413);
});

test('hapus foto hanya admin', async () => {
  const staff = (await t.admin.post('/api/users', { username: 'staf1', name: 'Staf', password: 'staf12345', role: 'staff' }));
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  const s = t.client();
  assert.equal((await s.post('/api/auth/login', { username: 'staf1', password: 'staf12345' })).status, 200);
  const del = await fetch(`${t.base}/api/rolls/${code}/photo`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: await cookieOfUser('staf1', 'staf12345') }, body: '{}' });
  assert.equal(del.status, 403);
  // staf boleh mengunggah foto
  assert.equal((await s.put(`/api/rolls/${code}/photo`, { image: dataUrl(jpegBuf()) })).status, 200);
  const adminDel = await fetch(`${t.base}/api/rolls/${code}/photo`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: await cookieOf() }, body: '{}' });
  assert.equal(adminDel.status, 200);
  assert.equal((await t.admin.get(`/api/rolls/${code}/photo`)).status, 404);
});

async function cookieOfUser(username, password) {
  const r = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return r.headers.get('set-cookie').split(';')[0];
}
