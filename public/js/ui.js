const TZ = 'Asia/Jakarta';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Angka yard dengan format Indonesia (koma desimal), maksimal 2 desimal. */
export const fmtYd = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
export const toMeters = (yd) => Number(yd || 0) * 0.9144;
export const fmtM = (yd) => toMeters(yd).toLocaleString('id-ID', { maximumFractionDigits: 2 });

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00+07:00`) : new Date(iso);
  return d.toLocaleDateString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
};
export const todayLocal = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

export const STATUS_LABEL = { in_stock: 'Tersedia', depleted: 'Habis', void: 'Void' };
export const TYPE_LABEL = { IN: 'Masuk', OUT: 'Keluar', ADJUST: 'Penyesuaian' };
export const statusBadge = (s) => `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
export const typeBadge = (t) => `<span class="badge ${esc(t)}">${esc(TYPE_LABEL[t] || t)}</span>`;
export const materialName = (r) => [r.material_name, r.material_color].filter(Boolean).join(' · ');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function toast(message, type = '') {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
}

/**
 * Modal sederhana. body: HTML string. actions: [{label, cls, onClick(close, modalEl)}]
 * Mengembalikan fungsi close.
 */
export function openModal({ title, body, actions = [], onClose }) {
  const root = $('#modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2><div class="modal-body">${body}</div><div class="actions"></div></div>`;
  const box = $('.modal', bg);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bg.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => e.target === bg && close());
  const bar = $('.actions', bg);
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.cls || ''}`;
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await a.onClick(close, box);
      } finally {
        b.disabled = false;
      }
    });
    bar.appendChild(b);
  }
  root.appendChild(bg);
  const first = $('input,select,textarea', box);
  if (first) first.focus();
  return close;
}

export const confirmBox = (title, message, okLabel = 'Ya, lanjutkan', cls = '') =>
  new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      body: `<p>${message}</p>`,
      onClose: () => resolve(result), // Esc / klik latar = batal
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (close) => close() },
        { label: okLabel, cls, onClick: (close) => { result = true; close(); } },
      ],
    });
  });

/** Scan barcode lewat kamera (BarcodeDetector). Memanggil onCode(kode) sekali lalu menutup. */
export async function scanWithCamera(onCode) {
  if (!('BarcodeDetector' in window)) {
    toast('Scan kamera belum didukung browser ini. Gunakan scanner USB/Bluetooth atau ketik kode.', 'err');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    toast('Akses kamera ditolak atau tidak tersedia (butuh HTTPS atau localhost).', 'err');
    return;
  }
  const detector = new BarcodeDetector({ formats: ['code_128'] });
  const wrap = document.createElement('div');
  wrap.className = 'cam';
  wrap.innerHTML = '<video playsinline muted></video><div class="cam-bar"><span>Arahkan ke barcode label</span><button type="button" class="btn secondary">Tutup</button></div>';
  const video = $('video', wrap);
  video.srcObject = stream;
  document.body.appendChild(wrap);
  await video.play();
  let alive = true;
  const stop = () => {
    alive = false;
    stream.getTracks().forEach((t) => t.stop());
    wrap.remove();
  };
  $('button', wrap).addEventListener('click', stop);
  const tick = async () => {
    if (!alive) return;
    try {
      const found = await detector.detect(video);
      if (found.length) {
        stop();
        onCode(found[0].rawValue);
        return;
      }
    } catch {
      /* frame belum siap */
    }
    setTimeout(tick, 150);
  };
  tick();
}

export const CAM_SUPPORTED = () => 'BarcodeDetector' in window && !!navigator.mediaDevices;
