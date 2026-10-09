// Pembuat perintah printer thermal. Satu fungsi layout (buildLayout) dipakai untuk
// TSPL (TSC, Xprinter, Gprinter, dll.) dan ZPL (Zebra) supaya tampilan konsisten.

import { bad } from '../util.js';

export const DEFAULT_PRINTER = {
  mode: 'browser', // browser | network | system
  language: 'TSPL', // TSPL | ZPL (untuk mode network & system)
  host: '',
  port: 9100,
  queue: '', // nama antrian printer (mode system)
  timeout_ms: 5000,
  dpi: 203, // 203 | 300
  label_width_mm: 50,
  label_height_mm: 30,
  media: 'gap', // gap | continuous | blackmark
  gap_mm: 2,
  margin_mm: 3,
  direction: 0, // 0 normal, 1 diputar 180 derajat
  darkness: 8, // 0-15
  speed: 4, // 1-10 (inci/detik; sesuai kemampuan printer)
  copies: 1,
  title: 'DELOVA WARDROBE',
  barcode_height_mm: 10,
  barcode_module: 2, // lebar bar tersempit (dot); otomatis diperkecil bila tidak muat
  show_title: true,
  show_material: true,
  show_color: true,
  show_code_text: true,
  show_yards: true,
  show_date: true,
  show_supplier: false,
};

const BOOL_KEYS = ['show_title', 'show_material', 'show_color', 'show_code_text', 'show_yards', 'show_date', 'show_supplier'];

const clampNum = (v, min, max, label, { int = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${label} harus berupa angka`);
  if (n < min || n > max) throw bad(`${label} harus antara ${min} dan ${max}`);
  return int ? Math.round(n) : n;
};

/** Validasi + isi default konfigurasi printer. Melempar HttpError(400) bila tidak valid. */
export function normalizePrinterConfig(input = {}, base = DEFAULT_PRINTER) {
  const src = { ...base, ...input };
  const cfg = { ...DEFAULT_PRINTER };

  if (!['browser', 'network', 'system'].includes(src.mode)) throw bad('Mode printer tidak dikenal');
  cfg.mode = src.mode;
  if (!['TSPL', 'ZPL'].includes(src.language)) throw bad('Bahasa printer harus TSPL atau ZPL');
  cfg.language = src.language;

  cfg.host = String(src.host || '').trim();
  if (cfg.host && !/^[A-Za-z0-9._-]{1,253}$/.test(cfg.host)) throw bad('Alamat IP / hostname printer tidak valid');
  cfg.port = clampNum(src.port, 1, 65535, 'Port', { int: true });
  cfg.queue = String(src.queue || '').trim();
  if (cfg.queue && !/^[\w .\-]{1,80}$/.test(cfg.queue)) throw bad('Nama antrian printer hanya boleh huruf, angka, spasi, titik, minus, underscore');
  cfg.timeout_ms = clampNum(src.timeout_ms, 500, 30000, 'Timeout', { int: true });

  if (cfg.mode === 'network' && !cfg.host) throw bad('Isi alamat IP printer untuk mode jaringan');
  if (cfg.mode === 'system' && !cfg.queue) throw bad('Isi nama antrian printer untuk mode sistem');

  cfg.dpi = Number(src.dpi);
  if (![203, 300].includes(cfg.dpi)) throw bad('DPI harus 203 atau 300');
  cfg.label_width_mm = clampNum(src.label_width_mm, 20, 110, 'Lebar label (mm)');
  cfg.label_height_mm = clampNum(src.label_height_mm, 15, 200, 'Tinggi label (mm)');
  if (!['gap', 'continuous', 'blackmark'].includes(src.media)) throw bad('Jenis media tidak dikenal');
  cfg.media = src.media;
  cfg.gap_mm = clampNum(src.gap_mm, 0, 10, 'Gap (mm)');
  cfg.margin_mm = clampNum(src.margin_mm, 0, 10, 'Margin (mm)');
  cfg.direction = clampNum(src.direction, 0, 1, 'Arah cetak', { int: true });
  cfg.darkness = clampNum(src.darkness, 0, 15, 'Kegelapan', { int: true });
  cfg.speed = clampNum(src.speed, 1, 10, 'Kecepatan', { int: true });
  cfg.copies = clampNum(src.copies, 1, 20, 'Jumlah salinan', { int: true });
  cfg.title = String(src.title ?? '').trim().slice(0, 40);
  cfg.barcode_height_mm = clampNum(src.barcode_height_mm, 5, 30, 'Tinggi barcode (mm)');
  cfg.barcode_module = clampNum(src.barcode_module, 1, 4, 'Lebar bar barcode', { int: true });
  for (const k of BOOL_KEYS) cfg[k] = src[k] === undefined ? DEFAULT_PRINTER[k] : !!src[k];

  if (cfg.label_width_mm - cfg.margin_mm * 2 < 15) throw bad('Margin terlalu besar untuk lebar label ini');
  return cfg;
}

export const mmToDots = (mm, dpi) => Math.round((mm * dpi) / 25.4);

/** Nilai yard untuk label, mis. 125.5 */
export const fmtYards = (y) => String(Math.round(Number(y) * 100) / 100);

function fmtDateShort(value) {
  const iso = value instanceof Date ? value.toISOString() : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : '';
}

/** Data label dari baris roll (hasil findRoll). */
export function rollToLabel(roll) {
  return {
    code: roll.code,
    material: roll.material_name,
    color: roll.material_color || '',
    yards: fmtYards(roll.initial_yards),
    date: fmtDateShort(roll.received_at || roll.created_at),
    supplier: roll.supplier || '',
    lot: roll.lot || '',
  };
}

export const SAMPLE_LABEL = {
  code: 'DLV2610090001',
  material: 'Viscose Print Floral',
  color: 'Sage Green',
  yards: '125.5',
  date: '09/10/26',
  supplier: 'CV Sinar Textile',
  lot: 'LOT-A1',
};

/** Hapus karakter non-ASCII & karakter kontrol printer dari teks. */
export function asciiSafe(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["^~\\]/g, '')
    .trim();
}

// Font dalam dot (203 dpi). TSPL font 1..4 = 8x12, 12x20, 16x24, 24x32.
const FONTS = {
  sm: { id: '1', w: 8, h: 12 },
  md: { id: '2', w: 12, h: 20 },
  lg: { id: '3', w: 16, h: 24 },
  xl: { id: '4', w: 24, h: 32 },
};

/** Perkiraan terburuk jumlah modul Code128 (semua karakter subset B). */
export const code128WorstModules = (text) => 11 * text.length + 35;

/**
 * Susun elemen label dalam satuan dot. Elemen prioritas rendah dibuang bila tinggi label tidak cukup.
 * @returns {{width:number,height:number,elements:Array,narrow:number}}
 */
export function buildLayout(cfg, label) {
  const dpi = cfg.dpi;
  const W = mmToDots(cfg.label_width_mm, dpi);
  const H = mmToDots(cfg.label_height_mm, dpi);
  const m = mmToDots(cfg.margin_mm, dpi);
  const avail = W - 2 * m;
  const scale = dpi / 203;
  const gap = Math.round(4 * scale);
  const mul = Math.max(1, Math.round(scale)); // pengali font bawaan TSPL
  const fontPx = (f) => ({ ...f, h: Math.round(f.h * scale), w: Math.round(f.w * scale), mul });

  const code = asciiSafe(label.code);
  const narrow = Math.max(1, Math.min(cfg.barcode_module, Math.floor(avail / code128WorstModules(code))));
  const barcodeH = mmToDots(cfg.barcode_height_mm, dpi);

  const rows = [];
  // `fonts`: daftar font dari terbesar ke terkecil; dipakai yang pertama muat, bila tidak ada teks dipotong.
  const text = (key, content, fonts, priority) => {
    const clean = asciiSafe(content);
    const list = (Array.isArray(fonts) ? fonts : [fonts]).map(fontPx);
    const f = list.find((c) => clean.length * c.w <= avail) || list[list.length - 1];
    const maxChars = Math.max(1, Math.floor(avail / f.w));
    rows.push({ key, priority, height: f.h + gap, build: (y) => ({ type: 'text', x: m, y, text: clean.slice(0, maxChars), font: f }) });
  };

  if (cfg.show_title && cfg.title) text('title', cfg.title.toUpperCase(), FONTS.sm, 1);
  if (cfg.show_material) {
    const name = cfg.show_color && label.color ? `${label.material} - ${label.color}` : label.material;
    text('material', name, [FONTS.md, FONTS.sm], 5);
  }
  rows.push({ key: 'barcode', priority: 9, height: barcodeH + gap, build: (y) => ({ type: 'barcode', x: m, y, height: barcodeH, narrow, data: code }) });
  if (cfg.show_code_text) text('code', code, FONTS.sm, 3);
  if (cfg.show_yards || cfg.show_date) {
    const parts = [];
    if (cfg.show_yards) parts.push(`${label.yards} YD`);
    if (cfg.show_date && label.date) parts.push(label.date);
    if (parts.length) text('info', parts.join('   '), FONTS.lg, 8);
  }
  if (cfg.show_supplier && label.supplier) text('supplier', label.supplier, FONTS.sm, 2);

  // Buang elemen prioritas terendah sampai muat.
  let kept = [...rows];
  const total = (list) => list.reduce((s, r) => s + r.height, 0);
  while (total(kept) > H - 2 * m && kept.length > 1) {
    const victim = kept.filter((r) => r.key !== 'barcode').sort((a, b) => a.priority - b.priority)[0];
    if (!victim) break;
    kept = kept.filter((r) => r !== victim);
  }

  let y = m;
  const elements = kept.map((r) => {
    const el = r.build(y);
    y += r.height;
    return el;
  });
  return { width: W, height: H, elements, narrow };
}

const CRLF = '\r\n';

function tsplHeader(cfg) {
  const lines = [`SIZE ${cfg.label_width_mm} mm,${cfg.label_height_mm} mm`];
  if (cfg.media === 'gap') lines.push(`GAP ${cfg.gap_mm} mm,0 mm`);
  else if (cfg.media === 'continuous') lines.push('GAP 0 mm,0 mm');
  else lines.push(`BLINE ${cfg.gap_mm} mm,0 mm`);
  lines.push(`DIRECTION ${cfg.direction},0`, 'REFERENCE 0,0', `DENSITY ${cfg.darkness}`, `SPEED ${cfg.speed}`, 'SET TEAR ON');
  return lines;
}

/** TSPL (TSC / Xprinter / Gprinter / Argox PPLB-kompatibel TSPL). */
export function toTSPL(cfg, labels, copies = cfg.copies) {
  const out = [];
  for (const label of labels) {
    const layout = buildLayout(cfg, label);
    out.push(...tsplHeader(cfg), 'CLS');
    for (const el of layout.elements) {
      if (el.type === 'text') {
        out.push(`TEXT ${el.x},${el.y},"${el.font.id}",0,${el.font.mul},${el.font.mul},"${el.text}"`);
      } else {
        out.push(`BARCODE ${el.x},${el.y},"128",${el.height},0,0,${el.narrow},${el.narrow * 2},"${el.data}"`);
      }
    }
    out.push(`PRINT ${copies},1`);
  }
  return out.join(CRLF) + CRLF;
}

/** ZPL II (Zebra dan kompatibel). */
export function toZPL(cfg, labels, copies = cfg.copies) {
  const out = [];
  const media = { gap: '^MNY', continuous: '^MNN', blackmark: '^MNM' }[cfg.media];
  for (const label of labels) {
    const layout = buildLayout(cfg, label);
    out.push(`~SD${Math.round((cfg.darkness / 15) * 30)}`, '^XA', `^PW${layout.width}`, `^LL${layout.height}`, '^LH0,0', media, `^PR${cfg.speed}`);
    if (cfg.direction === 1) out.push('^POI');
    for (const el of layout.elements) {
      if (el.type === 'text') {
        out.push(`^FO${el.x},${el.y}^A0N,${el.font.h},${el.font.w}^FD${el.text}^FS`);
      } else {
        out.push(`^FO${el.x},${el.y}^BY${el.narrow},3,${el.height}^BCN,${el.height},N,N,N,A^FD${el.data}^FS`);
      }
    }
    out.push(`^PQ${copies},0,1,N`, '^XZ');
  }
  return out.join(CRLF) + CRLF;
}

export function buildPrintData(cfg, labels, copies) {
  const n = copies ?? cfg.copies;
  return cfg.language === 'ZPL' ? toZPL(cfg, labels, n) : toTSPL(cfg, labels, n);
}
