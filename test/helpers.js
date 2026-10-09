import mysql from 'mysql2/promise';
import { openDb } from '../server/db.js';
import { bootstrapAdmin } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

// Koneksi MySQL untuk tes. Atur lewat TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD.
// Akun harus boleh CREATE/DROP DATABASE; tiap server tes memakai database sementara sendiri.
const conn = () => ({
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT) || 3306,
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD ?? '',
});

/** Jalankan app dengan database MySQL sementara di port acak; kembalikan klien HTTP sederhana dengan cookie. */
export async function startTestServer(extraEnv = {}) {
  const c = conn();
  const dbName = `delova_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const config = loadConfig({
    DB_HOST: c.host, DB_PORT: String(c.port), DB_USER: c.user, DB_PASSWORD: c.password, DB_NAME: dbName,
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'rahasia123', TZ_OFFSET_MINUTES: '420', ...extraEnv,
  });
  let db;
  try {
    db = await openDb(config);
  } catch (err) {
    throw new Error(`Tes butuh server MySQL/MariaDB (${c.user}@${c.host}:${c.port}). Atur TEST_DB_* bila perlu. Detail: ${err.message}`);
  }
  await bootstrapAdmin(db, config);
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

  return {
    base, db, config, client, admin,
    async close() {
      await new Promise((r) => server.close(r));
      await db.close();
      const drop = await mysql.createConnection(c);
      await drop.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await drop.end();
    },
  };
}
