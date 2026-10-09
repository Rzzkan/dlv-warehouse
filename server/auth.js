import crypto from 'node:crypto';
import { HttpError, nowIso } from './util.js';

const COOKIE = 'dlv_sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, userId, days) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)').run(sha256(token), userId, expires);
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSessionCookie(res, token, { days, secure }) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${days * 86400}`];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Middleware: isi req.user dari cookie sesi bila valid. */
export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const token = readCookie(req);
    req.sessionToken = token;
    req.user = null;
    if (token) {
      const row = db
        .prepare(
          `SELECT u.id, u.username, u.name, u.role, u.must_change
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
        )
        .get(sha256(token), nowIso());
      if (row) req.user = { ...row, must_change: !!row.must_change };
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Silakan login terlebih dahulu'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Silakan login terlebih dahulu'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Hanya admin yang boleh melakukan ini'));
  next();
}

/** Pembatas percobaan login sederhana (in-memory). */
export function createLoginLimiter({ max = 8, windowMs = 5 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const rec = hits.get(key);
      if (rec && rec.until > Date.now() && rec.count >= max) {
        throw new HttpError(429, 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.');
      }
    },
    fail(key) {
      const rec = hits.get(key);
      if (!rec || rec.until <= Date.now()) hits.set(key, { count: 1, until: Date.now() + windowMs });
      else rec.count += 1;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/** Buat admin awal bila belum ada user. Mengembalikan info bila memakai password bawaan. */
export function bootstrapAdmin(db, config) {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return null;
  const password = config.adminPassword || 'admin123';
  const defaulted = !config.adminPassword;
  db.prepare(
    `INSERT INTO users(username, name, role, password_hash, must_change, active, created_at)
     VALUES(?, ?, 'admin', ?, ?, 1, ?)`,
  ).run(config.adminUsername, 'Administrator', hashPassword(password), defaulted ? 1 : 0, nowIso());
  return { username: config.adminUsername, defaulted };
}
