# Tahapan Deployment ke VPS dengan Docker (wh.delova.id)

Panduan langkah demi langkah, ditulis untuk **VPS Hostinger (Ubuntu 24.04 + Docker)**. Berlaku juga untuk VPS lain dengan Ubuntu/Debian. **Bila VPS sudah berisi ecommerce, baca bagian "VPS yang sudah ada ecommerce" dulu.**
Hasil akhir: aplikasi jalan di **https://wh.delova.id** dengan HTTPS otomatis, database MySQL internal, dan backup harian.

> Perintah bertanda `# di server` dijalankan lewat SSH di VPS. Ganti tulisan `GANTI-...` dengan nilai Anda.

> ## ⚠ VPS yang sudah berisi ecommerce delova.id → pakai **MODE BERBAGI**
> Port 80/443 di VPS itu sudah dipakai web server ecommerce, jadi paket standar (dengan Caddy sendiri) akan **bentrok**.
> Di mode berbagi, aplikasi gudang hanya mendengarkan di `127.0.0.1:3100` dan MySQL-nya container terpisah
> (tidak menyentuh database ecommerce). Anda cukup menambah **satu vhost** `wh.delova.id` di web server yang sudah ada.
> Langkah lengkapnya ada di bagian **"Deploy di VPS yang sudah ada ecommerce"** di bawah. Tahap 2 (update server, user, firewall) **dilewati**.

## Cara cepat — VPS BARU/kosong (terminal, ±10 menit)

Prasyarat: VPS Ubuntu 24.04 + Docker, dan record DNS `A` **`wh` → IP VPS** sudah dibuat (lihat Tahap 1).

```bash
# 1) dari komputer Anda
ssh root@IP-VPS

# 2) di server: update + user deploy + firewall (satu blok, salin semua)
apt update && apt -y upgrade
adduser --disabled-password --gecos "" deploy && usermod -aG sudo,docker deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
exit

# 3) masuk lagi sebagai deploy, ambil kode, jalankan skrip deploy
ssh deploy@IP-VPS
git clone https://github.com/Rzzkan/dlv-warehouse.git && cd dlv-warehouse
./scripts/setup-vps.sh wh.delova.id
```

Skrip `setup-vps.sh` akan: memeriksa Docker → membuat `.env` (password database acak, Anda diminta password admin awal) → memeriksa DNS → build & jalankan → menunggu aplikasi sehat dan HTTPS aktif → memasang backup harian. Aman dijalankan ulang (`.env` tidak ditimpa). Setelah selesai, lanjut ke **Tahap 5** (verifikasi & ganti password admin).

> Repo privat? Lihat catatan *deploy key* di Tahap 3 sebelum `git clone`.

---

## Deploy di VPS yang sudah ada ecommerce (mode berbagi)

**Aturan main supaya ecommerce tidak terganggu:** jangan jalankan `apt upgrade`, `ufw enable/reset`, atau `docker system prune`; jangan ubah DNS `delova.id`/`www` (hanya **tambah** record `wh`); jangan menyentuh database ecommerce.

**A. Persiapan (hanya membaca / aman)**

```bash
ssh USER@IP-VPS                                   # user yang biasa Anda pakai di VPS ini
sudo ss -ltnp | grep -E ':(80|443) '              # siapa web server-nya? nginx / caddy / apache / docker-proxy
docker --version; docker compose version          # sudah ada Docker?
docker ps --format '{{.Names}}\t{{.Ports}}'       # ecommerce berjalan di Docker atau langsung di server?
free -h; df -h /                                  # butuh ±1 GB RAM bebas & ±5 GB disk
```

- Buat **snapshot VPS** di hPanel dulu (jaring pengaman).
- Belum ada Docker? Pasang dari panduan resmi Docker (`get.docker.com`) pada jam sepi. Pemasangan Docker mengubah aturan iptables; umumnya aman, tetapi itu alasan snapshot di atas penting. Bila tidak ingin menambah Docker di server produksi, pakai jalur **"Tanpa Docker"** di README (systemd + vhost, memakai MySQL yang ada dengan database & user terpisah).
- DNS: tambahkan record `A` **`wh` → IP VPS** saja.

**B. Jalankan aplikasi**

```bash
git clone https://github.com/Rzzkan/dlv-warehouse.git && cd dlv-warehouse
./scripts/setup-vps.sh --shared wh.delova.id      # port bentrok? APP_PORT=3110 ./scripts/setup-vps.sh --shared wh.delova.id
```

Skrip menolak jalan bila ada bentrok port, tidak memakai port 80/443, dan menulis `COMPOSE_FILE=docker-compose.shared.yml` ke `.env`.
**Di mode berbagi cukup `docker compose ...` tanpa `-f`** (contoh: `docker compose ps`, `docker compose logs -f app`, `docker compose up -d --build`).
RAM dibatasi: MySQL 512 MB, aplikasi 384 MB (praktisnya memakai jauh lebih kecil).

**C. Tambah vhost di web server yang sudah ada** (pilih satu sesuai hasil `ss` di atas)

| Web server Anda | Caranya |
|---|---|
| **Nginx** | Salin `deploy/nginx-shared.conf` ke `sites-available`, aktifkan, `nginx -t && reload`, lalu `sudo certbot --nginx -d wh.delova.id` |
| **Caddy** | Tambahkan blok dari `deploy/Caddyfile.shared` ke Caddyfile lama, lalu reload Caddy (sertifikat otomatis) |
| **CloudPanel** (template Hostinger) | *Add Site → Reverse Proxy*; domain `wh.delova.id`, URL `http://127.0.0.1:3100`; lalu terbitkan Let's Encrypt di tab SSL/TLS (nama menu bisa sedikit beda antar versi) |
| **Apache** | VirtualHost `wh.delova.id` dengan `ProxyPass / http://127.0.0.1:3100/` + `ProxyPassReverse` + `RequestHeader set X-Forwarded-Proto https` + `RequestHeader set X-Forwarded-For` bila belum otomatis, lalu certbot |
| **Caddy di dalam Docker** (stack ecommerce `delova`) | Jalur khusus di bawah: `setup-vps.sh --shared --proxy-net <jaringan>` lalu `add-caddy-vhost.sh` |
| Web server lain **di dalam Docker** (Nginx Proxy Manager, Traefik, Coolify) | `127.0.0.1` dari dalam container itu bukan host; gunakan `--proxy-net` agar app ikut jaringan proxy, lalu arahkan vhost ke `dlv-warehouse:3000` |
| Cloudflare di depan | SSL/TLS mode **Full (strict)**; pastikan vhost sudah memiliki sertifikat |

### Jalur khusus: Caddy yang berjalan di Docker (stack ecommerce `delova`)

Ciri-cirinya: `sudo ss -ltnp` menunjukkan `docker-proxy` di port 80/443 dan `docker ps` menampilkan container `caddy`.

```bash
docker network ls                                  # catat jaringan stack ecommerce, mis. delova_default
git clone https://github.com/Rzzkan/dlv-warehouse.git && cd dlv-warehouse
./scripts/setup-vps.sh --shared --proxy-net delova_default wh.delova.id   # app ikut jaringan itu (alias: dlv-warehouse)
./scripts/add-caddy-vhost.sh                       # tambah blok wh.delova.id ke Caddy yang ada
curl -I https://wh.delova.id/api/health            # 200
curl -I https://delova.id                          # ecommerce tetap normal
```

`add-caddy-vhost.sh` bekerja dengan pengaman: mencari file Caddyfile lewat mount container → **backup** (`Caddyfile.bak-<waktu>`) → **menambah** blok di akhir file (isi lama tidak diubah) → `caddy validate` → `caddy reload` (tanpa downtime) → **rollback otomatis** bila validasi/reload gagal. Skrip berhenti tanpa mengubah apa pun bila Caddyfile tidak berasal dari file di server atau container Caddy tidak tunggal.

Hal yang perlu diketahui:
- Hanya container `app` gudang yang bergabung ke jaringan ecommerce; **MySQL gudang tetap terpisah** dan tidak terjangkau dari ecommerce.
- Jika stack ecommerce di-`docker compose down`, Docker akan memberi pesan bahwa jaringan masih dipakai (container gudang). Itu hanya peringatan; jaringan dipakai ulang saat `up`.
- Batalkan: `cat Caddyfile.bak-<waktu> > <Caddyfile> && docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, lalu `docker compose down` di folder `dlv-warehouse`.

**D. Verifikasi**

```bash
curl -I https://wh.delova.id/api/health           # HTTP/2 200
curl -I https://delova.id                         # situs ecommerce tetap normal (cek juga di browser)
```

Lalu lanjut ke **Tahap 5** (login, ganti password admin, akun staf), **Tahap 6**, dan **Tahap 7** (backup).
Cookie login aplikasi ini bernama `dlv_sid` dan hanya berlaku untuk `wh.delova.id` (tidak dibagi ke `delova.id`), jadi tidak bentrok dengan sesi ecommerce.

**Batalkan / hapus total bila perlu** (tidak menyentuh ecommerce): `docker compose down` (data tetap) — atau `docker compose down -v` untuk menghapus juga data gudang (**tidak bisa dikembalikan**; backup dulu). Hapus vhost `wh.delova.id` di web server.

---

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

## Tahap 2 — Masuk & amankan server *(hanya VPS BARU/kosong — lewati bila VPS sudah berisi ecommerce)*

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

> Perintah `docker compose` di panduan ini tanpa `-f` karena file compose dibaca dari `COMPOSE_FILE` di `.env` (standalone: `docker-compose.prod.yml`, berbagi VPS: `docker-compose.shared.yml`). Jalankan dari folder `dlv-warehouse`.

```bash
docker compose up -d --build
docker compose ps          # db: healthy, app: running/healthy, caddy: running
docker compose logs -f app # tunggu "Delova Warehouse berjalan di ..." lalu Ctrl+C
docker compose logs caddy | tail -20   # cari "certificate obtained"
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
`sed -i 's|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=|' .env && docker compose up -d`.

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
docker compose up -d --build
docker compose logs --tail 30 app
```

**Rollback** bila ada masalah: `git log --oneline` → `git checkout <commit-lama>` → `docker compose up -d --build`. Bila perubahan melibatkan struktur database, rilis akan menyertakan catatan migrasi; sebelum itu selalu backup.

---

## Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Browser: "tidak aman" / sertifikat gagal | DNS belum mengarah ke VPS, atau port 80/443 tertutup | Cek `nslookup wh.delova.id`, firewall `ufw status` & hPanel; lalu `docker compose restart caddy` |
| `502 Bad Gateway` | Container `app` mati/belum siap | `docker compose logs app` |
| App log: "Gagal terhubung ke MySQL" | Password di `.env` berubah setelah database terbentuk | MySQL hanya memakai password saat **pertama kali** dibuat. Kembalikan password lama, atau ubah di MySQL (`ALTER USER`). |
| Login terkunci "Terlalu banyak percobaan" | 8× salah dalam 5 menit | Tunggu 5 menit, atau `docker compose restart app` |
| Kamera tidak terbuka di HP | Membuka lewat `http://` / IP | Pakai `https://wh.delova.id` |
| Disk penuh | Backup/log/image lama menumpuk | `df -h`, `docker image prune -f` (aman), hapus backup lama. **Jangan** `docker system prune` di VPS yang juga berisi ecommerce |
| Setelah reboot VPS aplikasi mati | Docker tidak otomatis hidup | `sudo systemctl enable docker` (container sudah `restart: unless-stopped`) |

Perintah berguna:

```bash
docker compose ps            # status
docker compose logs -f app   # log aplikasi
docker compose restart app   # restart aplikasi
docker compose down          # matikan (data tetap aman di volume)
# JANGAN pakai "down -v": itu menghapus volume database!
```

## Daftar periksa akhir

- [ ] https://wh.delova.id terbuka dengan gembok HTTPS
- [ ] Password admin sudah diganti; akun staf dibuat
- [ ] `.env` tersimpan di password manager & `chmod 600`
- [ ] Alur masuk → label → scan → keluar sudah dicoba dari HP
- [ ] Backup harian berjalan & salinannya ada di luar VPS
- [ ] Snapshot VPS aktif
