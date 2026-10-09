import { esc } from './ui.js';
import { post } from './api.js';

/**
 * HTML satu label (ukuran fisik dalam mm). Dipakai untuk pratinjau admin dan cetak via browser.
 * `label.narrow` = lebar bar (dot) dari server supaya barcode kelipatan dot printer.
 */
export function labelHtml(cfg, label) {
  const name = cfg.show_color && label.color ? `${label.material} - ${label.color}` : label.material;
  const narrow = label.narrow || cfg.barcode_module;
  const bar = `/api/barcode/${encodeURIComponent(label.code)}.svg?m=${narrow}&dpi=${cfg.dpi}&h=${cfg.barcode_height_mm}`;
  const info = [];
  if (cfg.show_yards) info.push(`<span>${esc(label.yards)} YD</span>`);
  if (cfg.show_date && label.date) info.push(`<span>${esc(label.date)}</span>`);
  return `<div class="label-frame" style="width:${cfg.label_width_mm}mm;height:${cfg.label_height_mm}mm;padding:${cfg.margin_mm}mm">
    ${cfg.show_title && cfg.title ? `<div class="lb-title">${esc(cfg.title.toUpperCase())}</div>` : ''}
    ${cfg.show_material ? `<div class="lb-mat${name.length * 1.5 > cfg.label_width_mm - 2 * cfg.margin_mm ? ' sm' : ''}">${esc(name)}</div>` : ''}
    <img class="lb-bar" alt="Barcode ${esc(label.code)}" src="${bar}">
    ${cfg.show_code_text ? `<div class="lb-code">${esc(label.code)}</div>` : ''}
    ${info.length ? `<div class="lb-info">${info.join('')}</div>` : ''}
    ${cfg.show_supplier && label.supplier ? `<div class="lb-sup">${esc(label.supplier)}</div>` : ''}
  </div>`;
}

/**
 * Cetak label untuk daftar kode. Mode jaringan/sistem: dikirim server ke printer.
 * Mode browser: membuka halaman cetak (jendela dibuka dulu secara sinkron agar tidak diblokir pop-up blocker).
 */
export async function printLabels(codes, copies) {
  const win = window.open('', '_blank');
  try {
    const res = await post('/api/print/labels', { codes, ...(copies ? { copies } : {}) });
    if (res.mode === 'browser') {
      if (win) win.location.href = res.url;
      else window.location.href = res.url;
      return { mode: 'browser' };
    }
    if (win) win.close();
    return res;
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}
