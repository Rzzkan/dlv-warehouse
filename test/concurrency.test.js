import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let t;
let material;

before(async () => {
  t = await startTestServer();
  const res = await t.admin.post('/api/materials', { code: 'CON-1', name: 'Kain Uji Konkurensi' });
  material = res.data.material;
});
after(() => t.close());

test('barang masuk paralel: kode roll dan nomor dokumen tidak pernah bentrok', async () => {
  const N = 12;
  const results = await Promise.all(
    Array.from({ length: N }, () => t.admin.post('/api/receipts', {
      items: [{ material_id: material.id, yards: 10 }, { material_id: material.id, yards: 20 }],
    })),
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  const codes = results.flatMap((r) => r.data.rolls.map((x) => x.code));
  const docs = results.map((r) => r.data.receipt.receipt_no);
  assert.equal(codes.length, N * 2);
  assert.equal(new Set(codes).size, N * 2, 'kode roll harus unik');
  assert.equal(new Set(docs).size, N, 'nomor dokumen harus unik');
});

test('barang keluar paralel pada satu roll: stok tidak pernah minus', async () => {
  const rec = await t.admin.post('/api/receipts', { items: [{ material_id: material.id, yards: 100 }] });
  const code = rec.data.rolls[0].code;
  // 10 permintaan x 15 yard = 150 yard, padahal hanya ada 100 -> tepat 6 yang boleh berhasil (90 yard)
  const results = await Promise.all(
    Array.from({ length: 10 }, () => t.admin.post('/api/outbound', { purpose: 'Uji', items: [{ code, yards: 15 }] })),
  );
  const ok = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 400).length;
  assert.equal(ok, 6, `berhasil=${ok}`);
  assert.equal(ok + rejected, 10, 'tidak ada status lain (mis. 500/deadlock)');
  const detail = await t.admin.get(`/api/rolls/${code}`);
  assert.equal(detail.data.roll.current_yards, 10);
  assert.equal(detail.data.movements.filter((m) => m.type === 'OUT').length, 6);
});

test('barang keluar paralel multi-roll dengan urutan berbeda tidak deadlock', async () => {
  const rec = await t.admin.post('/api/receipts', { items: [{ material_id: material.id, yards: 50 }, { material_id: material.id, yards: 50 }] });
  const [a, b] = rec.data.rolls.map((r) => r.code);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => t.admin.post('/api/outbound', {
      purpose: 'Uji', items: i % 2 ? [{ code: a, yards: 5 }, { code: b, yards: 5 }] : [{ code: b, yards: 5 }, { code: a, yards: 5 }],
    })),
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  const da = await t.admin.get(`/api/rolls/${a}`);
  const db = await t.admin.get(`/api/rolls/${b}`);
  assert.equal(da.data.roll.current_yards, 10);
  assert.equal(db.data.roll.current_yards, 10);
});
