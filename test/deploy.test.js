import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

const servers = [];
const start = async (env) => { const t = await startTestServer(env); servers.push(t); return t; };
after(async () => { for (const t of servers) await t.close(); });

const login = (t, password, ip) => fetch(`${t.base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
  body: JSON.stringify({ username: 'admin', password }),
});

test('header keamanan dan kamera diizinkan hanya untuk situs sendiri', async () => {
  const t = await start({});
  const res = await fetch(`${t.base}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('permissions-policy'), /camera=\(self\)/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('COOKIE_SECURE=1: cookie sesi bertanda Secure + HttpOnly + SameSite', async () => {
  const t = await start({ COOKIE_SECURE: '1' });
  const res = await login(t, 'rahasia123');
  const c = res.headers.get('set-cookie');
  assert.match(c, /Secure/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
});

test('di belakang proxy tepercaya: pembatas login memakai IP pengunjung asli (X-Forwarded-For)', async () => {
  const t = await start({ TRUST_PROXY: 'loopback' });
  for (let i = 0; i < 8; i++) assert.equal((await login(t, 'salah', '203.0.113.9')).status, 401);
  assert.equal((await login(t, 'salah', '203.0.113.9')).status, 429, 'pengunjung A terkunci');
  assert.equal((await login(t, 'rahasia123', '203.0.113.10')).status, 200, 'pengunjung B tidak ikut terkunci');
});

test('TRUST_PROXY=false: X-Forwarded-For palsu diabaikan (tidak bisa menghindari pembatas)', async () => {
  const t = await start({ TRUST_PROXY: 'false' });
  for (let i = 0; i < 8; i++) await login(t, 'salah', `198.51.100.${i}`);
  assert.equal((await login(t, 'rahasia123', '198.51.100.99')).status, 429);
});
