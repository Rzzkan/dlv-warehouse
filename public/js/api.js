export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi/jaringan.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* body kosong / bukan JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data?.error || `Permintaan gagal (${res.status})`, res.status);
  }
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}) => api('PUT', url, body);
export const del = (url) => api('DELETE', url, {});
export const patch = (url, body = {}) => api('PATCH', url, body);

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
