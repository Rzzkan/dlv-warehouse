import { put } from './api.js';
import { esc, openModal } from './ui.js';

const MAX_SIDE = 1280;
const QUALITY = 0.8;

/** Baca file gambar (kamera/galeri) -> perkecil (sisi terpanjang 1280px) -> data URL JPEG. Foto HP 4-8 MB jadi ±150-300 KB. */
export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/jpeg')) throw new Error('File harus berupa gambar');
  let src;
  let w;
  let h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width;
    h = src.height;
  } catch {
    // Fallback untuk browser tanpa createImageBitmap/opsi orientasi
    const url = URL.createObjectURL(file);
    try {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Gambar tidak dapat dibaca'));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    w = src.naturalWidth;
    h = src.naturalHeight;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG transparan -> latar putih
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  return canvas.toDataURL('image/jpeg', QUALITY);
}

export const uploadRollPhoto = (code, dataUrl) => put(`/api/rolls/${encodeURIComponent(code)}/photo`, { image: dataUrl });

export const photoUrl = (code, photoAt) => `/api/rolls/${encodeURIComponent(code)}/photo?v=${encodeURIComponent(photoAt || '')}`;

/** Tombol kamera + galeri. onPick(dataUrl) dipanggil setelah gambar dikompres. */
export function photoButtons(idPrefix) {
  return `<span class="photo-btns">
    <label class="btn secondary sm" title="Foto dengan kamera">📷<input type="file" accept="image/*" capture="environment" data-photo-in="${esc(idPrefix)}" hidden></label>
    <label class="btn secondary sm" title="Pilih dari galeri">🖼<input type="file" accept="image/*" data-photo-in="${esc(idPrefix)}" hidden></label>
  </span>`;
}

export function showPhoto(src, title) {
  openModal({
    title: title || 'Foto roll',
    body: `<img src="${esc(src)}" alt="Foto roll" style="width:100%;border-radius:8px;display:block">`,
    actions: [{ label: 'Tutup', cls: 'secondary', onClick: (c) => c() }],
  });
}
