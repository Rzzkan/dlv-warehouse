import path from 'node:path';

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dbFile: env.DB_FILE || path.join('data', 'warehouse.db'),
    // Offset zona waktu lokal dalam menit (WIB = 420). Dipakai untuk "hari ini" & kode label.
    tzOffsetMinutes: env.TZ_OFFSET_MINUTES !== undefined ? Number(env.TZ_OFFSET_MINUTES) : 420,
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    cookieSecure: env.COOKIE_SECURE === '1',
    sessionDays: Number(env.SESSION_DAYS) || 14,
  };
}
