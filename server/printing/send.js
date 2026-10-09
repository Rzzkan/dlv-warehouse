import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { HttpError } from '../util.js';

function netError(err, cfg) {
  const where = `${cfg.host}:${cfg.port}`;
  const map = {
    ECONNREFUSED: `Printer ${where} menolak koneksi. Pastikan printer menyala dan port raw (biasanya 9100) aktif.`,
    ETIMEDOUT: `Koneksi ke printer ${where} timeout. Periksa alamat IP dan jaringan.`,
    EHOSTUNREACH: `Printer ${where} tidak terjangkau. Periksa jaringan/IP.`,
    ENETUNREACH: `Jaringan ke ${where} tidak terjangkau.`,
    ENOTFOUND: `Hostname ${cfg.host} tidak ditemukan.`,
  };
  return new HttpError(502, map[err.code] || `Gagal terhubung ke printer ${where}: ${err.message}`);
}

/** Kirim data mentah (TSPL/ZPL) ke printer jaringan lewat TCP (port raw 9100). */
export function sendToNetwork(cfg, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(cfg.timeout_ms, () => done(new HttpError(504, `Printer ${cfg.host}:${cfg.port} tidak merespons (timeout)`)));
    socket.once('error', (err) => done(netError(err, cfg)));
    socket.connect(cfg.port, cfg.host, () => {
      socket.write(Buffer.from(data, 'latin1'), (err) => {
        if (err) return done(netError(err, cfg));
        socket.end();
      });
    });
    socket.once('close', () => done());
  });
}

/** Cek apakah port printer bisa dihubungi (tanpa mengirim data). */
export function pingNetwork(cfg) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const started = Date.now();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve({ ok: true, ms: Date.now() - started });
    };
    socket.setTimeout(cfg.timeout_ms, () => done(new HttpError(504, `Printer ${cfg.host}:${cfg.port} tidak merespons (timeout)`)));
    socket.once('error', (err) => done(netError(err, cfg)));
    socket.connect(cfg.port, cfg.host, () => done());
  });
}

/**
 * Kirim ke antrian printer sistem (USB / terpasang di OS) sebagai data mentah.
 * Linux/macOS: `lp -d <antrian> -o raw`. Windows: copy /b ke printer yang di-share (\\localhost\<nama-share>).
 */
export async function sendToSystem(cfg, data) {
  const tmp = path.join(os.tmpdir(), `delova-label-${process.pid}-${Date.now()}.prn`);
  fs.writeFileSync(tmp, Buffer.from(data, 'latin1'));
  try {
    await new Promise((resolve, reject) => {
      const cb = (err, _stdout, stderr) => {
        if (err) return reject(new HttpError(502, `Gagal mencetak ke antrian "${cfg.queue}": ${(stderr || err.message).toString().trim()}`));
        resolve();
      };
      if (process.platform === 'win32') {
        execFile('cmd.exe', ['/c', 'copy', '/b', tmp, `\\\\localhost\\${cfg.queue}`], { timeout: cfg.timeout_ms, windowsHide: true }, cb);
      } else {
        execFile('lp', ['-d', cfg.queue, '-o', 'raw', tmp], { timeout: cfg.timeout_ms }, cb);
      }
    });
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

export async function dispatchPrint(cfg, data) {
  if (cfg.mode === 'network') return sendToNetwork(cfg, data);
  if (cfg.mode === 'system') return sendToSystem(cfg, data);
  throw new HttpError(400, 'Mode browser dicetak dari browser, bukan dari server');
}
