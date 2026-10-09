import { Router } from 'express';
import bwipjs from 'bwip-js';
import { requireAuth, requireAdmin } from '../auth.js';
import { getSetting, setSetting } from '../db.js';
import { asyncHandler, bad, HttpError } from '../util.js';
import { findRoll, normalizeCode } from '../services/inventory.js';
import {
  DEFAULT_PRINTER, normalizePrinterConfig, rollToLabel, SAMPLE_LABEL, buildPrintData, buildLayout, asciiSafe,
} from '../printing/labels.js';
import { dispatchPrint, pingNetwork } from '../printing/send.js';

export const loadPrinterConfig = async (db) => normalizePrinterConfig(await getSetting(db, 'printer', {}), DEFAULT_PRINTER);

function parseCodes(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const codes = [...new Set(raw.map(normalizeCode).filter(Boolean))];
  if (codes.length === 0) throw bad('Pilih minimal satu roll untuk dicetak');
  if (codes.length > 300) throw bad('Maksimal 300 label per cetak');
  return codes;
}

async function labelsForCodes(db, codes) {
  const labels = [];
  for (const code of codes) {
    const roll = await findRoll(db, code);
    if (!roll) throw new HttpError(404, `Roll ${code} tidak ditemukan`);
    labels.push(rollToLabel(roll));
  }
  return labels;
}

export function printingRoutes({ db }) {
  const r = Router();
  r.use(requireAuth);

  // Gambar barcode Code 128 (SVG).
  // Tanpa parameter: ukuran layar. Dengan ?m=<dot per modul>&dpi=<203|300>&h=<tinggi mm>: ukuran fisik
  // tepat kelipatan dot printer (hasil cetak via browser/driver jadi tajam & terbaca scanner).
  r.get('/barcode/:code.svg', (req, res) => {
    const text = asciiSafe(req.params.code).slice(0, 40);
    if (!text) throw bad('Kode barcode kosong');
    const raw = bwipjs.toSVG({ bcid: 'code128', text, scale: 1, height: 12, includetext: false, paddingwidth: 0, paddingheight: 0 });
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(raw);
    const modules = Number(vb[1]);
    const m = Math.round(Number(req.query.m));
    const dpi = Number(req.query.dpi);
    const h = Number(req.query.h);
    const physical = m >= 1 && m <= 6 && (dpi === 203 || dpi === 300) && h >= 3 && h <= 60;
    const size = physical
      ? `width="${((modules * m * 25.4) / dpi).toFixed(3)}mm" height="${h}mm"`
      : `width="${modules * 2}" height="${Number(vb[2]) * 2}"`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(raw.replace('<svg ', `<svg ${size} preserveAspectRatio="none" `));
  });

  r.get('/printer/config', asyncHandler(async (_req, res) => {
    res.json({ config: await loadPrinterConfig(db), defaults: DEFAULT_PRINTER });
  }));

  r.put('/printer/config', requireAdmin, asyncHandler(async (req, res) => {
    const cfg = normalizePrinterConfig(req.body || {}, DEFAULT_PRINTER);
    await setSetting(db, 'printer', cfg);
    res.json({ config: cfg });
  }));

  // Tes koneksi ke printer jaringan (bisa dengan nilai yang belum disimpan)
  r.post('/printer/ping', requireAdmin, asyncHandler(async (req, res) => {
    const cfg = normalizePrinterConfig({ ...(await loadPrinterConfig(db)), ...(req.body || {}) });
    if (cfg.mode !== 'network') throw bad('Tes koneksi hanya untuk mode printer jaringan');
    res.json(await pingNetwork(cfg));
  }));

  // Cetak label tes
  r.post('/printer/test', requireAdmin, asyncHandler(async (req, res) => {
    const cfg = normalizePrinterConfig({ ...(await loadPrinterConfig(db)), ...(req.body || {}) });
    if (cfg.mode === 'browser') return res.json({ mode: 'browser', url: '/print.html?test=1' });
    await dispatchPrint(cfg, buildPrintData(cfg, [SAMPLE_LABEL], 1));
    res.json({ mode: cfg.mode, sent: 1 });
  }));

  // Pratinjau perintah mentah (untuk debugging) berdasarkan konfigurasi di form
  r.post('/printer/preview', requireAdmin, asyncHandler(async (req, res) => {
    const cfg = normalizePrinterConfig({ ...(await loadPrinterConfig(db)), ...(req.body || {}) });
    const layout = buildLayout(cfg, SAMPLE_LABEL);
    res.json({
      config: cfg,
      label: { ...SAMPLE_LABEL, narrow: layout.narrow },
      commands: buildPrintData(cfg, [SAMPLE_LABEL], 1),
      layout: { width: layout.width, height: layout.height, narrow: layout.narrow },
    });
  }));

  // Data label untuk render di browser (halaman print.html)
  r.get('/print/labels-data', asyncHandler(async (req, res) => {
    const cfg = await loadPrinterConfig(db);
    const labels = req.query.test ? [SAMPLE_LABEL] : await labelsForCodes(db, parseCodes(req.query.codes));
    // `narrow` = lebar bar (dot) yang benar-benar dipakai agar barcode muat di label
    res.json({ config: cfg, labels: labels.map((l) => ({ ...l, narrow: buildLayout(cfg, l).narrow })) });
  }));

  // Cetak label: mode jaringan/sistem dikirim dari server; mode browser mengembalikan URL cetak
  r.post('/print/labels', asyncHandler(async (req, res) => {
    const cfg = await loadPrinterConfig(db);
    const codes = parseCodes(req.body?.codes);
    const copies = req.body?.copies ? Math.min(Math.max(Math.round(Number(req.body.copies)), 1), 20) : cfg.copies;
    const labels = await labelsForCodes(db, codes);
    if (cfg.mode === 'browser') {
      return res.json({ mode: 'browser', url: `/print.html?codes=${encodeURIComponent(codes.join(','))}&copies=${copies}` });
    }
    await dispatchPrint(cfg, buildPrintData(cfg, labels, copies));
    res.json({ mode: cfg.mode, sent: labels.length, copies });
  }));

  // Unduh file perintah mentah (.prn) untuk dikirim manual ke printer
  r.get('/print/raw', asyncHandler(async (req, res) => {
    const cfg = await loadPrinterConfig(db);
    const labels = await labelsForCodes(db, parseCodes(req.query.codes));
    res.setHeader('Content-Type', 'text/plain; charset=us-ascii');
    res.setHeader('Content-Disposition', `attachment; filename="label-${cfg.language.toLowerCase()}.prn"`);
    res.send(buildPrintData(cfg, labels));
  }));

  return r;
}
