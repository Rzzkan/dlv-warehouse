import { bad, notFound, now } from '../util.js';
import { getRollOrThrow } from './inventory.js';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// Cek isi file (bukan hanya header data-URL) agar yang tersimpan benar-benar gambar
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function decodeImage(input) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(input || ''));
  if (!m) throw bad('Format gambar tidak valid (harus JPEG/PNG/WebP)');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length === 0) throw bad('Gambar kosong');
  if (buf.length > MAX_PHOTO_BYTES) throw bad('Foto terlalu besar (maks 2 MB)');
  const mime = sniff(buf);
  if (!mime) throw bad('Isi file bukan gambar yang didukung');
  return { buf, mime };
}

export async function setRollPhoto(db, user, code, image) {
  const roll = await getRollOrThrow(db, code);
  const { buf, mime } = decodeImage(image);
  const at = now();
  await db.run(
    `INSERT INTO roll_photos(roll_id, mime, size_bytes, data, user_id, updated_at) VALUES(?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE mime = VALUES(mime), size_bytes = VALUES(size_bytes), data = VALUES(data),
                             user_id = VALUES(user_id), updated_at = VALUES(updated_at)`,
    [roll.id, mime, buf.length, buf, user?.id ?? null, at],
  );
  return { code: roll.code, photo_at: at, size: buf.length };
}

export async function getRollPhoto(db, code) {
  const roll = await getRollOrThrow(db, code);
  const p = await db.get('SELECT mime, data FROM roll_photos WHERE roll_id = ?', [roll.id]);
  if (!p) throw notFound('Roll ini belum punya foto');
  return p;
}

export async function deleteRollPhoto(db, code) {
  const roll = await getRollOrThrow(db, code);
  await db.run('DELETE FROM roll_photos WHERE roll_id = ?', [roll.id]);
  return { code: roll.code, photo_at: null };
}
