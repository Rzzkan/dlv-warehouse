export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    db: {
      host: env.DB_HOST || '127.0.0.1',
      port: Number(env.DB_PORT) || 3306,
      user: env.DB_USER || 'delova',
      password: env.DB_PASSWORD ?? '',
      database: env.DB_NAME || 'delova_warehouse',
      poolSize: Number(env.DB_POOL_SIZE) || 10,
      // true = buat database otomatis bila belum ada (butuh hak CREATE)
      autoCreate: env.DB_AUTO_CREATE !== '0',
    },
    // Offset zona waktu lokal dalam menit (WIB = 420). Dipakai untuk "hari ini" & kode label.
    tzOffsetMinutes: env.TZ_OFFSET_MINUTES !== undefined ? Number(env.TZ_OFFSET_MINUTES) : 420,
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    cookieSecure: env.COOKIE_SECURE === '1',
    // Proxy mana yang dipercaya untuk header X-Forwarded-*. Nilai Express: 'loopback', 'uniquelocal' (jaringan Docker), jumlah hop, atau daftar IP. Penting agar IP asli pengunjung terbaca (pembatas login).
    trustProxy: env.TRUST_PROXY || 'loopback',
    sessionDays: Number(env.SESSION_DAYS) || 14,
  };
}
