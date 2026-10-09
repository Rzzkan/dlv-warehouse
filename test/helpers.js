import { openDb } from '../server/db.js';
import { bootstrapAdmin } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

/** Jalankan app dengan DB in-memory di port acak; kembalikan klien HTTP sederhana dengan cookie. */
export async function startTestServer() {
  const config = loadConfig({ DB_FILE: ':memory:', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'rahasia123', TZ_OFFSET_MINUTES: '420' });
  const db = openDb(':memory:');
  bootstrapAdmin(db, config);
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data, headers: res.headers };
    };
    return {
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b = {}) => call('PUT', u, b),
      patch: (u, b = {}) => call('PATCH', u, b),
    };
  }

  const admin = client();
  const login = await admin.post('/api/auth/login', { username: 'admin', password: 'rahasia123' });
  if (login.status !== 200) throw new Error('login admin gagal');

  return { base, db, config, client, admin, close: () => new Promise((r) => server.close(r)) };
}
