import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startTestServer } from './helpers.js';
import {
  DEFAULT_PRINTER, normalizePrinterConfig, toTSPL, toZPL, buildLayout, SAMPLE_LABEL, asciiSafe, code128WorstModules,
} from '../server/printing/labels.js';

test('konfigurasi printer divalidasi', () => {
  assert.equal(normalizePrinterConfig({}).label_width_mm, 50);
  assert.throws(() => normalizePrinterConfig({ mode: 'network', host: '' }), /IP printer/);
  assert.throws(() => normalizePrinterConfig({ mode: 'network', host: 'a b' }), /tidak valid/);
  assert.throws(() => normalizePrinterConfig({ dpi: 250 }), /DPI/);
  assert.throws(() => normalizePrinterConfig({ port: 70000 }), /Port/);
  assert.throws(() => normalizePrinterConfig({ mode: 'system', queue: '' }), /antrian/);
  assert.throws(() => normalizePrinterConfig({ label_width_mm: 30, margin_mm: 10 }), /Margin/);
});

test('TSPL berisi perintah yang benar', () => {
  const cfg = normalizePrinterConfig({ mode: 'network', host: '192.168.1.50' });
  const out = toTSPL(cfg, [SAMPLE_LABEL], 2);
  assert.match(out, /^SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\n/);
  assert.match(out, /BARCODE \d+,\d+,"128",\d+,0,0,\d+,\d+,"DLV2610090001"/);
  // nama panjang turun ke font lebih kecil (id "1") alih-alih terpotong
  assert.match(out, /TEXT \d+,\d+,"1",0,1,1,"Viscose Print Floral - Sage Green"/);
  assert.match(out, /PRINT 2,1\r\n$/);
});

test('ZPL berisi perintah yang benar', () => {
  const cfg = normalizePrinterConfig({ language: 'ZPL' });
  const out = toZPL(cfg, [SAMPLE_LABEL], 3);
  assert.match(out, /\^XA/);
  assert.match(out, /\^PW400\r\n\^LL240/);
  assert.match(out, /\^BCN,\d+,N,N,N,A\^FDDLV2610090001\^FS/);
  assert.match(out, /\^PQ3,0,1,N\r\n\^XZ/);
});

test('layout muat di label: tidak ada elemen di luar area & barcode tidak lebih lebar dari label', () => {
  for (const [w, h, dpi] of [[50, 30, 203], [40, 30, 203], [60, 40, 300], [50, 25, 203]]) {
    const cfg = normalizePrinterConfig({ label_width_mm: w, label_height_mm: h, dpi });
    const layout = buildLayout(cfg, SAMPLE_LABEL);
    const barcode = layout.elements.find((e) => e.type === 'barcode');
    assert.ok(barcode, 'barcode harus selalu ada');
    assert.ok(barcode.narrow >= 1);
    assert.ok(barcode.x + code128WorstModules(barcode.data) * barcode.narrow <= layout.width, `barcode keluar label ${w}x${h}`);
    for (const el of layout.elements) {
      const bottom = el.y + (el.type === 'barcode' ? el.height : el.font.h);
      assert.ok(bottom <= layout.height, `elemen ${el.type} keluar bawah label ${w}x${h}`);
    }
  }
});

test('SVG barcode berukuran fisik kelipatan dot printer', async () => {
  const t0 = await startTestServer();
  try {
    // 134 modul (Code128 subset B+C) x 2 dot x 25.4 / 203 dpi = 33.53 mm
    const res = await t0.admin.get('/api/barcode/DLV2610090001.svg?m=2&dpi=203&h=10');
    assert.equal(res.status, 200);
    assert.match(res.data, /width="33\.5\d+mm" height="10mm"/);
    assert.match(res.data, /preserveAspectRatio="none"/);
    // 300 dpi: 134 x 3 x 25.4 / 300 = 34.04 mm
    const r300 = await t0.admin.get('/api/barcode/DLV2610090001.svg?m=3&dpi=300&h=12');
    assert.match(r300.data, /width="34\.0\d+mm" height="12mm"/);
    // parameter tidak valid -> ukuran layar biasa, bukan mm
    const plain = await t0.admin.get('/api/barcode/DLV2610090001.svg?m=99&dpi=1&h=1');
    assert.doesNotMatch(plain.data, /mm"/);
  } finally {
    await t0.close();
  }
});

test('teks non-ASCII & karakter kontrol dibersihkan', () => {
  assert.equal(asciiSafe('Kain "Batik" ^Çafé~'), 'Kain Batik Cafe');
});

// ---- Integrasi: server + printer palsu TCP ----
let t;
let fake;
const received = [];

before(async () => {
  t = await startTestServer();
  await new Promise((resolve) => {
    fake = net.createServer((sock) => {
      const chunks = [];
      sock.on('data', (d) => chunks.push(d));
      sock.on('end', () => received.push(Buffer.concat(chunks).toString('latin1')));
    }).listen(0, '127.0.0.1', resolve);
  });
});
after(async () => {
  await t.close();
  await new Promise((r) => fake.close(r));
});

test('simpan konfigurasi, tes koneksi, dan cetak label via TCP', async () => {
  const port = fake.address().port;
  const m = (await t.admin.post('/api/materials', { code: 'KTN', name: 'Katun', color: 'Putih' })).data.material;
  const rc = await t.admin.post('/api/receipts', { supplier: 'PT A', items: [{ material_id: m.id, yards: 75 }, { material_id: m.id, yards: 60 }] });
  const codes = rc.data.rolls.map((r) => r.code);

  // default: mode browser
  const def = await t.admin.post('/api/print/labels', { codes });
  assert.equal(def.data.mode, 'browser');
  assert.match(def.data.url, /^\/print\.html\?codes=/);

  const bad = await t.admin.put('/api/printer/config', { mode: 'network', host: '', port });
  assert.equal(bad.status, 400);

  const saved = await t.admin.put('/api/printer/config', { mode: 'network', language: 'TSPL', host: '127.0.0.1', port, copies: 1, label_width_mm: 50, label_height_mm: 30 });
  assert.equal(saved.status, 200);

  const ping = await t.admin.post('/api/printer/ping', {});
  assert.equal(ping.status, 200);
  assert.equal(ping.data.ok, true);

  const printed = await t.admin.post('/api/print/labels', { codes, copies: 2 });
  assert.equal(printed.status, 200);
  assert.equal(printed.data.sent, 2);
  await new Promise((r) => setTimeout(r, 100));
  const jobs = received.filter(Boolean); // koneksi tes ping tidak mengirim data
  assert.equal(jobs.length, 1);
  assert.match(jobs[0], new RegExp(`"${codes[0]}"`));
  assert.match(jobs[0], new RegExp(`"${codes[1]}"`));
  assert.equal((jobs[0].match(/PRINT 2,1/g) || []).length, 2);

  const test = await t.admin.post('/api/printer/test', {});
  assert.equal(test.data.sent, 1);

  const raw = await t.admin.get(`/api/print/raw?codes=${codes[0]}`);
  assert.equal(raw.status, 200);
  assert.match(raw.data, /^SIZE 50 mm/);

  assert.equal((await t.admin.post('/api/print/labels', { codes: ['TIDAKADA'] })).status, 404);
  assert.equal((await t.admin.post('/api/print/labels', { codes: [] })).status, 400);
});

test('printer tidak terjangkau memberi pesan error yang jelas', async () => {
  const closed = await new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const res = await t.admin.post('/api/printer/ping', { mode: 'network', host: '127.0.0.1', port: closed });
  assert.equal(res.status, 502);
  assert.match(res.data.error, /menolak koneksi/);
});

test('pratinjau perintah mengikuti nilai form', async () => {
  const res = await t.admin.post('/api/printer/preview', { language: 'ZPL', label_width_mm: 60, label_height_mm: 40, dpi: 300 });
  assert.equal(res.status, 200);
  assert.match(res.data.commands, /\^PW709/);
  assert.equal(res.data.layout.height, 472);
});
