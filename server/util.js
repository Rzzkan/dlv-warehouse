export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Data tidak ditemukan') => new HttpError(404, msg);

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Validasi angka yard: > 0, maksimum 100.000, dibulatkan 2 desimal. */
export function parseYards(value, label = 'Yard') {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw bad(`${label} harus berupa angka lebih dari 0`);
  if (n > 100000) throw bad(`${label} terlalu besar`);
  return round2(n);
}

export function cleanStr(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

export function reqStr(value, label, max = 200) {
  const s = cleanStr(value, max);
  if (!s) throw bad(`${label} wajib diisi`);
  return s;
}

/** Waktu sekarang sebagai Date (disimpan UTC di kolom DATETIME). */
export const now = () => new Date();

/** Tanggal lokal (YYYY-MM-DD) dari waktu sekarang dengan offset menit. */
export function localDate(offsetMinutes, date = new Date()) {
  return new Date(date.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * Rentang UTC [mulai, akhir) untuk satu tanggal lokal (YYYY-MM-DD).
 * Dipakai agar filter harian bisa memakai indeks pada created_at.
 */
export function dayRangeUtc(day, offsetMinutes) {
  const start = new Date(Date.parse(`${day}T00:00:00.000Z`) - offsetMinutes * 60000);
  return [start, new Date(start.getTime() + 86400000)];
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
