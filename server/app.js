import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { sessionMiddleware } from './auth.js';
import { HttpError } from './util.js';
import { authRoutes } from './routes/auth.js';
import { masterRoutes } from './routes/master.js';
import { stockRoutes } from './routes/stock.js';
import { printingRoutes } from './routes/printing.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  // Unggah foto roll membawa gambar base64 (hasil kompres dari browser) -> batas lebih besar hanya untuk rute ini
  app.use('/api/rolls/:code/photo', express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Perlindungan CSRF: request yang mengubah data wajib JSON (tidak bisa dikirim lintas-situs tanpa CORS preflight)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Content-Type harus application/json'));
    }
    next();
  });
  app.use('/api', sessionMiddleware(db));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes({ db, config }));
  app.use('/api', masterRoutes({ db, config }));
  app.use('/api', stockRoutes({ db, config }));
  app.use('/api', printingRoutes({ db, config }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan')));

  app.use(express.static(publicDir, { extensions: ['html'], maxAge: 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Data terlalu besar' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid' });
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Data sudah ada (duplikat)' });
    if (err?.code === 'ER_DATA_TOO_LONG') return res.status(400).json({ error: 'Salah satu isian terlalu panjang' });
    if (err?.code === 'ECONNREFUSED' || err?.code === 'PROTOCOL_CONNECTION_LOST') return res.status(503).json({ error: 'Database tidak tersedia, coba lagi sebentar lagi' });
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  });

  return app;
}
