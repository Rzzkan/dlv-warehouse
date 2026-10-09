# Delova Gudang

Sistem pergudangan kain roll untuk Delova Wardrobe: pencatatan **barang masuk / keluar dalam yard**, **label barcode per roll**, **pelacakan lewat scan**, dan **integrasi printer thermal** (konfigurasi di halaman Admin).

## Fitur

- **Barang masuk**: satu dokumen penerimaan (supplier, no. surat jalan) → banyak roll. Tiap roll otomatis mendapat kode unik `DLV` + `YYMMDD` + urut 4 digit (mis. `DLV2610090001`, Code 128). Ada input cepat (Enter = baris baru) dan "tambah banyak roll sekaligus".
- **Foto roll dari kamera**: tiap baris barang masuk punya tombol 📷 (membuka kamera HP; di komputer membuka pemilih file) dan 🖼 (galeri). Foto otomatis diperkecil di browser (maks 1280 px, JPEG ±100–300 KB) lalu disimpan di database, sehingga ikut ter-backup `mysqldump`. Foto bisa ditambah/diganti belakangan di halaman Lacak (hapus: admin). Roll yang berfoto ditandai 📷 di daftar Stok. Kamera HP butuh HTTPS (atau localhost).
- **Barang keluar**: scan barcode → isi yard yang diambil. **Bisa sebagian roll**; sisa tercatat otomatis, roll yang sisanya 0 berstatus *Habis*. Satu dokumen bisa banyak roll, dan bersifat atomik (satu baris gagal = tidak ada yang berubah).
- **Lacak**: scan/ketik kode → sisa yard, lokasi, supplier, dan seluruh riwayat pergerakan. Ada penyesuaian stok (opname) berikut alasan, dan void (admin).
- **Stok, Riwayat mutasi (+ ekspor CSV), Jenis kain (stok minimum + peringatan), Pengguna (admin/staf).**
- **Scan**: scanner USB/Bluetooth (bekerja sebagai keyboard, akhiri dengan Enter) atau kamera HP (Chrome Android; butuh HTTPS/localhost).
- **Ramah HP & tablet**: di HP, menu pindah ke bar bawah (Beranda, Masuk, Keluar, Stok, Lacak, + "Lainnya"), tabel otomatis jadi kartu, tombol ≥44 px, font input 16 px (iPhone tidak zoom saat mengetik), dan mendukung area aman (notch). Tablet memakai tata letak lebar. Sudah diuji di 360/390 px (HP) dan 768/1024 px (tablet).
- Satuan **yard**, dengan konversi meter ditampilkan.

## Menjalankan

Butuh **Node.js ≥ 22.9** dan **MySQL 8+ (atau MariaDB 10.6+)**. Data disimpan di MySQL.

```bash
docker compose up -d      # opsional: MySQL lokal; atau pakai server MySQL Anda sendiri
npm install
cp .env.example .env      # isi DB_HOST/DB_USER/DB_PASSWORD/DB_NAME, dan ADMIN_PASSWORD
npm start                 # http://localhost:3000 (tabel dibuat otomatis saat pertama jalan)
npm test                  # tes unit + API + konkurensi (butuh MySQL, lihat bawah)
```

Siapkan database & user (jika tidak memakai docker compose):

```sql
CREATE DATABASE delova_warehouse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'delova'@'%' IDENTIFIED BY 'password-kuat';
GRANT ALL ON delova_warehouse.* TO 'delova'@'%';
```

**Tes** membuat database sementara (`delova_test_*`) lalu menghapusnya, jadi akun tes harus boleh `CREATE/DROP DATABASE`:
`TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER` (default `root`), `TEST_DB_PASSWORD`.

Login awal: `admin` / password dari `ADMIN_PASSWORD` (bila kosong: `admin123`, dan aplikasi menampilkan peringatan wajib ganti). **Backup rutin** dengan `mysqldump --single-transaction -u delova -p delova_warehouse | gzip > backup-$(date +%F).sql.gz` (jadwalkan harian lewat cron).

## Printer thermal (Admin → Printer & Label)

| Mode | Cocok untuk | Cara kerja |
|---|---|---|
| **Browser / driver sistem** | Printer USB dengan driver terpasang (paling mudah) | Membuka halaman cetak; ukuran kertas otomatis mengikuti label. Di dialog cetak pilih printer, skala 100%, tanpa margin. Lebar bar barcode dibuat kelipatan dot printer agar tajam. |
| **Jaringan (TCP/IP 9100)** | Printer LAN/Wi-Fi, cetak massal tanpa dialog | Server mengirim TSPL/ZPL langsung ke `IP:9100`. Server harus satu jaringan dengan printer. |
| **Antrian sistem** | Printer USB di komputer server | Kirim data mentah: Linux/macOS `lp -d <antrian> -o raw`; Windows `copy /b` ke printer yang di-share (`\\localhost\NAMA`). |

Bahasa printer: **TSPL** (TSC, Xprinter, Gprinter, Argox, dll.) atau **ZPL** (Zebra). Yang dapat diatur: ukuran label (mm), DPI (203/300), jenis media (gap / kontinu / black mark), gap, margin, arah, kegelapan, kecepatan, salinan, judul, tinggi & lebar barcode, serta elemen yang ditampilkan di label. Ada **pratinjau langsung**, **Tes koneksi**, **Cetak label tes**, dan **Lihat perintah printer** untuk diagnosis.

> **Catatan jujur tentang pengujian:** perintah TSPL/ZPL, pengiriman TCP, dan halaman cetak diuji otomatis (termasuk printer TCP tiruan dan Chromium headless), tetapi **belum diuji dengan perangkat printer fisik**. Cetak satu label tes dulu, lalu sesuaikan ukuran, gap, dan kegelapan. Mode "Antrian sistem" khususnya bergantung pada konfigurasi OS Anda.

## Deployment (wh.delova.id)

Paket produksi: aplikasi + MySQL + Caddy (HTTPS otomatis dari Let's Encrypt), semuanya lewat Docker. MySQL tidak dibuka ke internet.

**Kebutuhan:** VPS Linux (1 vCPU / 1–2 GB RAM cukup) dengan Docker + Docker Compose, port 80 & 443 terbuka.

1. **DNS:** buat record `A` untuk `wh.delova.id` → IP VPS. (Bila memakai Cloudflare: mode SSL/TLS "Full (strict)".)
2. **Ambil kode & isi password:**
   ```bash
   git clone https://github.com/Rzzkan/dlv-warehouse && cd dlv-warehouse
   cp .env.production.example .env && nano .env      # GANTI semua password
   ```
3. **Jalankan:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml logs -f app    # pastikan "Delova Warehouse berjalan"
   ```
   Buka https://wh.delova.id, login dengan `ADMIN_USERNAME`/`ADMIN_PASSWORD`, lalu **ganti password** di Admin.
4. **Backup harian** (termasuk foto roll): `crontab -e` lalu tambah
   `30 1 * * * /path/ke/dlv-warehouse/scripts/backup.sh >> /var/log/delova-backup.log 2>&1`.
   Backup tersimpan di `backups/` (14 hari). Pulihkan dengan `scripts/restore.sh backups/<file>.sql.gz`. Salin folder `backups/` ke tempat lain (mis. Google Drive) secara berkala.
5. **Update versi baru:** `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

Yang sudah diatur untuk produksi: cookie sesi `Secure`, HSTS, `TRUST_PROXY` (IP pengunjung asli terbaca di belakang Caddy sehingga pembatas login adil), header keamanan, kamera hanya untuk situs sendiri, dan DB hanya bisa diakses dari jaringan internal Docker.

**Soal printer:** server di internet **tidak bisa** menjangkau printer di LAN gudang. Pakai mode **Browser / driver sistem** (cetak dari HP/PC di gudang yang tersambung ke printer) atau mode **Antrian sistem** di PC gudang. Mode *Jaringan (TCP 9100)* hanya bila server berada satu jaringan dengan printer.

### Tanpa Docker (Ubuntu/Debian)

Cukup Node.js 22, MySQL/MariaDB, dan Caddy (atau Nginx). Contoh di Ubuntu:

```bash
# 1) Paket dasar
sudo apt update && sudo apt install -y mysql-server git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo apt install -y caddy            # atau: nginx certbot python3-certbot-nginx

# 2) Database
sudo mysql -e "CREATE DATABASE delova_warehouse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'delova'@'localhost' IDENTIFIED BY 'PASSWORD-KUAT';
GRANT ALL ON delova_warehouse.* TO 'delova'@'localhost';"

# 3) Aplikasi
sudo useradd -r -m -d /opt/dlv-warehouse -s /usr/sbin/nologin delova
sudo git clone https://github.com/Rzzkan/dlv-warehouse /opt/dlv-warehouse
cd /opt/dlv-warehouse && sudo npm ci --omit=dev
sudo cp .env.native.example .env && sudo nano .env          # isi password
sudo chown -R delova:delova /opt/dlv-warehouse && sudo chmod 600 .env

# 4) Jalan otomatis (systemd)
sudo cp deploy/dlv-warehouse.service /etc/systemd/system/
sudo systemctl enable --now dlv-warehouse && sudo journalctl -u dlv-warehouse -f

# 5) HTTPS: Caddy (sertifikat otomatis)
sudo cp deploy/Caddyfile.native /etc/caddy/Caddyfile && sudo systemctl reload caddy
#    (Nginx: pakai deploy/nginx-wh.delova.id.conf lalu `sudo certbot --nginx -d wh.delova.id`)
```

Backup harian: `30 1 * * * /opt/dlv-warehouse/scripts/backup-native.sh` (di crontab user `delova`). Update versi: `cd /opt/dlv-warehouse && sudo -u delova git pull && sudo npm ci --omit=dev && sudo systemctl restart dlv-warehouse`.

**Hosting bersama (cPanel/Niagahoster dsb.):** bisa bila ada fitur *Setup Node.js App* dengan **Node 22** dan database MySQL. Isi variabel `.env` lewat panel, arahkan startup file ke `server/index.js`, dan aktifkan HTTPS/SSL untuk subdomain. Bila hanya tersedia Node < 22 atau tanpa Node, pakai VPS.

## Struktur

```
server/   Express API, MySQL (mysql2), layanan inventori, pembuat perintah TSPL/ZPL
public/   Antarmuka web (tanpa build step), halaman cetak label
test/     Tes unit & API (node --test)
```

Catatan teknis: stok dilindungi kunci baris (`SELECT … FOR UPDATE`) sehingga barang keluar yang bersamaan tidak bisa membuat stok minus, dan penomoran kode roll/dokumen memakai penghitung atomik di database (aman dengan banyak pengguna/proses). kode roll ditempel di label dan di-scan sebagai teks Code 128; stok dihitung dari buku mutasi (`movements`) sehingga setiap perubahan yard dapat ditelusuri. Autentikasi memakai sesi cookie `HttpOnly`/`SameSite=Lax`, password di-hash scrypt, dan request pengubah data wajib JSON.
