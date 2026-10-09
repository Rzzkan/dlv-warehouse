import { Router } from 'express';
import {
  verifyPassword, hashPassword, createSession, destroySession, destroyUserSessions,
  setSessionCookie, clearSessionCookie, requireAuth, createLoginLimiter,
} from '../auth.js';
import { asyncHandler, HttpError, bad, cleanStr } from '../util.js';

export function authRoutes({ db, config }) {
  const r = Router();
  const limiter = createLoginLimiter();

  r.post('/login', asyncHandler(async (req, res) => {
    const username = cleanStr(req.body?.username, 60).toLowerCase();
    const password = String(req.body?.password ?? '');
    const key = `${req.ip}|${username}`;
    limiter.check(key);
    const row = db.prepare('SELECT * FROM users WHERE lower(username) = ? AND active = 1').get(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      limiter.fail(key);
      throw new HttpError(401, 'Username atau password salah');
    }
    limiter.reset(key);
    const token = createSession(db, row.id, config.sessionDays);
    setSessionCookie(res, token, { days: config.sessionDays, secure: config.cookieSecure });
    res.json({ user: { id: row.id, username: row.username, name: row.name, role: row.role, must_change: !!row.must_change } });
  }));

  r.post('/logout', (req, res) => {
    destroySession(db, req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => res.json({ user: req.user }));

  r.post('/password', requireAuth, asyncHandler(async (req, res) => {
    const current = String(req.body?.current ?? '');
    const next = String(req.body?.next ?? '');
    if (next.length < 8) throw bad('Password baru minimal 8 karakter');
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current, row.password_hash)) throw bad('Password saat ini salah');
    db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), req.user.id);
    destroyUserSessions(db, req.user.id);
    const token = createSession(db, req.user.id, config.sessionDays);
    setSessionCookie(res, token, { days: config.sessionDays, secure: config.cookieSecure });
    res.json({ ok: true });
  }));

  return r;
}
