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

## Deployment

Pasang di komputer/mini-PC di gudang yang satu jaringan dengan printer (mode jaringan). Bila diakses lewat HTTPS (disarankan untuk scan kamera), set `COOKIE_SECURE=1` dan letakkan di belakang reverse proxy. Server di cloud **tidak** bisa menjangkau printer di LAN — pakai mode Browser, atau jalankan server di gudang.

## Struktur

```
server/   Express API, MySQL (mysql2), layanan inventori, pembuat perintah TSPL/ZPL
public/   Antarmuka web (tanpa build step), halaman cetak label
test/     Tes unit & API (node --test)
```

Catatan teknis: stok dilindungi kunci baris (`SELECT … FOR UPDATE`) sehingga barang keluar yang bersamaan tidak bisa membuat stok minus, dan penomoran kode roll/dokumen memakai penghitung atomik di database (aman dengan banyak pengguna/proses). kode roll ditempel di label dan di-scan sebagai teks Code 128; stok dihitung dari buku mutasi (`movements`) sehingga setiap perubahan yard dapat ditelusuri. Autentikasi memakai sesi cookie `HttpOnly`/`SameSite=Lax`, password di-hash scrypt, dan request pengubah data wajib JSON.
