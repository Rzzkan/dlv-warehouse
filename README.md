# Delova Gudang

Sistem pergudangan kain roll untuk Delova Wardrobe: pencatatan **barang masuk / keluar dalam yard**, **label barcode per roll**, **pelacakan lewat scan**, dan **integrasi printer thermal** (konfigurasi di halaman Admin).

## Fitur

- **Barang masuk**: satu dokumen penerimaan (supplier, no. surat jalan) → banyak roll. Tiap roll otomatis mendapat kode unik `DLV` + `YYMMDD` + urut 4 digit (mis. `DLV2610090001`, Code 128). Ada input cepat (Enter = baris baru) dan "tambah banyak roll sekaligus".
- **Barang keluar**: scan barcode → isi yard yang diambil. **Bisa sebagian roll**; sisa tercatat otomatis, roll yang sisanya 0 berstatus *Habis*. Satu dokumen bisa banyak roll, dan bersifat atomik (satu baris gagal = tidak ada yang berubah).
- **Lacak**: scan/ketik kode → sisa yard, lokasi, supplier, dan seluruh riwayat pergerakan. Ada penyesuaian stok (opname) berikut alasan, dan void (admin).
- **Stok, Riwayat mutasi (+ ekspor CSV), Jenis kain (stok minimum + peringatan), Pengguna (admin/staf).**
- **Scan**: scanner USB/Bluetooth (bekerja sebagai keyboard, akhiri dengan Enter) atau kamera HP (Chrome Android; butuh HTTPS/localhost).
- Satuan **yard**, dengan konversi meter ditampilkan.

## Menjalankan

Butuh Node.js ≥ 22.13 (memakai `node:sqlite` bawaan, tanpa kompilasi native).

```bash
npm install
cp .env.example .env      # opsional; atur ADMIN_PASSWORD
npm start                 # http://localhost:3000
npm test                  # tes unit + API
```

Login awal: `admin` / password dari `ADMIN_PASSWORD` (bila kosong: `admin123`, dan aplikasi menampilkan peringatan wajib ganti). Data tersimpan di `data/warehouse.db` (SQLite) — **backup file ini secara berkala**.

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
server/   Express API, SQLite, layanan inventori, pembuat perintah TSPL/ZPL
public/   Antarmuka web (tanpa build step), halaman cetak label
test/     Tes unit & API (node --test)
```

Catatan teknis: kode roll ditempel di label dan di-scan sebagai teks Code 128; stok dihitung dari buku mutasi (`movements`) sehingga setiap perubahan yard dapat ditelusuri. Autentikasi memakai sesi cookie `HttpOnly`/`SameSite=Lax`, password di-hash scrypt, dan request pengubah data wajib JSON.
