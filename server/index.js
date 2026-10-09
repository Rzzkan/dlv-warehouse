import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { bootstrapAdmin } from './auth.js';
import { createApp } from './app.js';

const config = loadConfig();

let db;
try {
  db = await openDb(config);
} catch (err) {
  console.error(`Gagal terhubung ke MySQL (${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}): ${err.code || ''} ${err.message}`);
  console.error('Periksa DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME di file .env dan pastikan server MySQL berjalan.');
  process.exit(1);
}

const boot = await bootstrapAdmin(db, config);
const app = createApp({ db, config });

const server = app.listen(config.port, config.host, () => {
  console.log(`Delova Warehouse berjalan di http://localhost:${config.port}`);
  console.log(`Database MySQL: ${config.db.host}:${config.db.port}/${config.db.database}`);
  if (boot) {
    console.log(`Akun admin dibuat: username "${boot.username}"`);
    if (boot.defaulted) console.log('PERINGATAN: password bawaan "admin123" dipakai. Segera ganti setelah login pertama.');
  }
});

async function shutdown() {
  server.close();
  await db.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
