# Tahapan Deployment ke VPS dengan Docker (wh.delova.id)

Panduan langkah demi langkah, ditulis untuk **VPS Hostinger (Ubuntu 24.04 + Docker)**. Berlaku juga untuk VPS lain dengan Ubuntu/Debian.
Hasil akhir: aplikasi jalan di **https://wh.delova.id** dengan HTTPS otomatis, database MySQL internal, dan backup harian.

> Perintah bertanda `# di server` dijalankan lewat SSH di VPS. Ganti tulisan `GANTI-...` dengan nilai Anda.

## Gambaran

```
Internet ──443──▶ Caddy (HTTPS otomatis) ──▶ app (Node.js :3000) ──▶ db (MySQL, hanya jaringan internal)
```

Tiga container: `caddy`, `app`, `db`. Data MySQL & sertifikat disimpan di Docker volume, jadi aman saat container di-build ulang.

---

## Tahap 0 — Persiapan (±10 menit)

- [ ] VPS aktif (Hostinger **KVM 1** cukup), template **Ubuntu 24.04 with Docker**.
- [ ] Catat **IP publik VPS** (hPanel → VPS → Overview).
- [ ] Akses ke pengaturan **DNS domain `delova.id`**.
- [ ] Akses ke repo GitHub `Rzzkan/dlv-warehouse`.

## Tahap 1 — Arahkan DNS

Di pengaturan DNS `delova.id`, tambah record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `wh` | IP VPS Anda | 300 |

Tunggu beberapa menit, lalu cek dari komputer Anda:

```bash
nslookup wh.delova.id        # harus menampilkan IP VPS
```

**Jangan lanjut ke Tahap 4 sebelum DNS benar** — kalau tidak, sertifikat HTTPS gagal dibuat. (Bila DNS-nya di Cloudflare: awalnya set ke **DNS only** (awan abu-abu); setelah jalan, boleh dihidupkan proxy dengan SSL mode **Full (strict)**.)

## Tahap 2 — Masuk & amankan server

```bash
ssh root@IP-VPS                          # di komputer Anda
```

```bash
# di server
apt update && apt -y upgrade
adduser --disabled-password --gecos "" deploy
usermod -aG sudo,docker deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy     # opsional: sudo tanpa password
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# firewall: hanya SSH, HTTP, HTTPS
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Buka sesi SSH baru sebagai `deploy` untuk memastikan bisa masuk (`ssh deploy@IP-VPS`) **sebelum** menutup sesi root. Selanjutnya semua perintah dijalankan sebagai `deploy`.
Di hPanel → VPS → **Firewall**, pastikan port 22, 80, 443 juga diizinkan.

Cek Docker:

```bash
docker --version && docker compose version
sudo systemctl is-enabled docker         # harus: enabled (otomatis hidup setelah reboot)
```

## Tahap 3 — Ambil kode & isi konfigurasi

```bash
# di server (user deploy)
git clone https://github.com/Rzzkan/dlv-warehouse.git ~/dlv-warehouse
cd ~/dlv-warehouse
```

> **Repo privat?** Pilih salah satu:
> - *Deploy key (disarankan):* `ssh-keygen -t ed25519 -f ~/.ssh/dlv_deploy -N ""`, lalu `cat ~/.ssh/dlv_deploy.pub` → tempel di GitHub repo → **Settings → Deploy keys → Add** (read-only). Clone dengan `GIT_SSH_COMMAND='ssh -i ~/.ssh/dlv_deploy' git clone git@github.com:Rzzkan/dlv-warehouse.git`, dan simpan agar permanen: `git config core.sshCommand 'ssh -i ~/.ssh/dlv_deploy'`.
> - *Token:* buat fine-grained Personal Access Token (Contents: read-only) dan clone dengan `https://TOKEN@github.com/Rzzkan/dlv-warehouse.git`.

Buat file konfigurasi dengan password acak:

```bash
cp .env.production.example .env
sed -i "s|^DB_ROOT_PASSWORD=.*|DB_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')|" .env
nano .env                                  # isi ADMIN_PASSWORD (password admin awal), cek APP_DOMAIN=wh.delova.id
chmod 600 .env
```

> **Simpan isi `.env` di password manager** (terutama `DB_ROOT_PASSWORD` & `DB_PASSWORD`). File ini tidak ada di GitHub. Hindari karakter `$` di password yang Anda ketik sendiri.

## Tahap 4 — Build & jalankan

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps          # db: healthy, app: running/healthy, caddy: running
docker compose -f docker-compose.prod.yml logs -f app # tunggu "Delova Warehouse berjalan di ..." lalu Ctrl+C
docker compose -f docker-compose.prod.yml logs caddy | tail -20   # cari "certificate obtained"
```

Build pertama memakan 1–3 menit. Tabel database dibuat otomatis saat aplikasi pertama jalan.

## Tahap 5 — Verifikasi

```bash
curl -sI https://wh.delova.id/api/health | head -3     # HTTP/2 200
```

Lalu di HP/komputer:

- [ ] Buka **https://wh.delova.id** (ada ikon gembok, tanpa peringatan).
- [ ] Login: `admin` + `ADMIN_PASSWORD` dari `.env`.
- [ ] **Admin → Pengguna / Ganti password**: ganti password admin sekarang.
- [ ] Buat pengguna staf (role *staf*) untuk petugas gudang — jangan pakai akun admin untuk operasional harian.
- [ ] Tes kamera: buka **Barang Masuk** di HP → tombol 📷 harus membuka kamera.

Setelah login berhasil, `ADMIN_PASSWORD` di `.env` tidak dipakai lagi (hanya untuk database kosong). Boleh dikosongkan:
`sed -i 's|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=|' .env && docker compose -f docker-compose.prod.yml up -d`.

## Tahap 6 — Isi data awal & atur printer

1. **Jenis Kain**: tambah kain (kode, nama, warna, lebar, stok minimum).
2. **Admin → Printer & Label**: pilih mode **Browser / driver sistem**, atur ukuran label (mm), DPI, lalu **Cetak label tes**.
   Server di internet **tidak bisa** menjangkau printer di LAN gudang, jadi mode *Jaringan (TCP 9100)* tidak dipakai. Cetak dari HP/PC di gudang yang tersambung ke printer.
3. Uji alur lengkap: Barang Masuk → foto → cetak label → scan di Lacak → Barang Keluar sebagian.

## Tahap 7 — Backup otomatis

```bash
cd ~/dlv-warehouse
./scripts/backup.sh                         # uji manual: harus tampil "OK backups/delova-....sql.gz"
crontab -e                                  # tambahkan baris di bawah
```

```cron
30 1 * * * /home/deploy/dlv-warehouse/scripts/backup.sh >> /home/deploy/backup.log 2>&1
```

- Backup berisi seluruh data **termasuk foto roll**; disimpan 14 hari di `~/dlv-warehouse/backups/`.
- **Salin keluar server** (backup di VPS yang sama tidak menolong bila VPS rusak). Contoh ke komputer Anda: `scp deploy@IP-VPS:~/dlv-warehouse/backups/*.sql.gz ./backup-delova/`. Atau pakai `rclone` ke Google Drive.
- Aktifkan juga **Backup/Snapshot** VPS di hPanel.
- **Uji pemulihan** sekali (misal di VPS/komputer lain) agar Anda yakin backup bisa dipakai: `./scripts/restore.sh backups/<file>.sql.gz`.

## Tahap 8 — Update ke versi baru

```bash
cd ~/dlv-warehouse
./scripts/backup.sh                         # selalu backup dulu
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs --tail 30 app
```

**Rollback** bila ada masalah: `git log --oneline` → `git checkout <commit-lama>` → `docker compose -f docker-compose.prod.yml up -d --build`. Bila perubahan melibatkan struktur database, rilis akan menyertakan catatan migrasi; sebelum itu selalu backup.

---

## Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Browser: "tidak aman" / sertifikat gagal | DNS belum mengarah ke VPS, atau port 80/443 tertutup | Cek `nslookup wh.delova.id`, firewall `ufw status` & hPanel; lalu `docker compose -f docker-compose.prod.yml restart caddy` |
| `502 Bad Gateway` | Container `app` mati/belum siap | `docker compose -f docker-compose.prod.yml logs app` |
| App log: "Gagal terhubung ke MySQL" | Password di `.env` berubah setelah database terbentuk | MySQL hanya memakai password saat **pertama kali** dibuat. Kembalikan password lama, atau ubah di MySQL (`ALTER USER`). |
| Login terkunci "Terlalu banyak percobaan" | 8× salah dalam 5 menit | Tunggu 5 menit, atau `docker compose -f docker-compose.prod.yml restart app` |
| Kamera tidak terbuka di HP | Membuka lewat `http://` / IP | Pakai `https://wh.delova.id` |
| Disk penuh | Backup/log/image lama menumpuk | `df -h`, `docker system prune -f`, hapus backup lama |
| Setelah reboot VPS aplikasi mati | Docker tidak otomatis hidup | `sudo systemctl enable docker` (container sudah `restart: unless-stopped`) |

Perintah berguna:

```bash
docker compose -f docker-compose.prod.yml ps            # status
docker compose -f docker-compose.prod.yml logs -f app   # log aplikasi
docker compose -f docker-compose.prod.yml restart app   # restart aplikasi
docker compose -f docker-compose.prod.yml down          # matikan (data tetap aman di volume)
# JANGAN pakai "down -v": itu menghapus volume database!
```

## Daftar periksa akhir

- [ ] https://wh.delova.id terbuka dengan gembok HTTPS
- [ ] Password admin sudah diganti; akun staf dibuat
- [ ] `.env` tersimpan di password manager & `chmod 600`
- [ ] Alur masuk → label → scan → keluar sudah dicoba dari HP
- [ ] Backup harian berjalan & salinannya ada di luar VPS
- [ ] Snapshot VPS aktif
