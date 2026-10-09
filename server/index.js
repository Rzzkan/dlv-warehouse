import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { bootstrapAdmin } from './auth.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbFile);
const boot = bootstrapAdmin(db, config);
const app = createApp({ db, config });

app.listen(config.port, config.host, () => {
  console.log(`Delova Warehouse berjalan di http://localhost:${config.port}`);
  if (boot) {
    console.log(`Akun admin dibuat: username "${boot.username}"`);
    if (boot.defaulted) console.log('PERINGATAN: password bawaan "admin123" dipakai. Segera ganti setelah login pertama.');
  }
});
