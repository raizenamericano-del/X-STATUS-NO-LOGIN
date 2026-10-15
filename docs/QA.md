# QA — STATUSX v1.1.0 TANPA LOGIN

Diperiksa 15 Oktober 2026. Laporan ini untuk source v1.1.0, bukan hasil pengujian login versi lama.

## Otomatis — 22/22 lulus

`npm test` menjalankan regresi HTTP/filesystem dengan Supertest, file media sungguhan, server lokal, serta subprocess startup/shutdown.

Cakupan:

- `/` langsung dashboard; `/login` mengarah ke `/`; tidak ada form password website.
- Config kosong valid; nilai lama APP_USERNAME/APP_PASSWORD_HASH/SESSION_SECRET yang invalid diabaikan.
- Overview, galeri, pengaturan, riwayat dan status koneksi dapat dibaca tanpa autentikasi.
- Konten media bisa diakses tanpa cookie. Raw `.env`, source, metadata, dan file sesi WhatsApp tidak disajikan sebagai file statis.
- Cookie CSRF anonim HttpOnly/SameSite; Secure di belakang proxy HTTPS produksi. Mutasi tanpa token atau dari origin berbeda ditolak.
- JSON terserialisasi; JSON rusak tidak ditimpa diam-diam.
- Upload PNG sebenarnya, nama aman, Range preview, penolakan MIME palsu/HTML/SVG, batas ukuran dan persetujuan; temporary file dibersihkan.
- Download individual, ZIP valid, riwayat, penghapusan, lease file, cancel/retry serta pelepasan temporary archive.
- ID/path palsu ditolak; pengaturan tersimpan, retensi, dan pembersihan riwayat bekerja.
- Integrasi WhatsApp nonaktif memberi error jujur tanpa pairing palsu.
- Filter status menolak chat pribadi, view-once, konten kedaluwarsa/tanpa otorisasi; normalisasi nomor dan atomic auth-state adapter diuji.
- Proses mendengarkan PORT yang diberikan, menerima variabel login lama tanpa memakainya, dan berhenti bersih pada SIGTERM tanpa membocorkan sentinel rahasia.
- Domain Railway otomatis, default angka kosong, signing key internal persisten/permission 0600/pemulihan key rusak, diagnostik tanpa isi error rahasia.

## Browser nyata — Chromium headless

Server dijalankan tanpa variabel login, dengan DATA_DIR sementara dan `BAILEYS_ENABLED=false`. Pemeriksaan lewat UI:

- Dashboard langsung terbuka, peringatan akses terbuka terlihat, tidak ada field password.
- Upload PNG melalui dialog beserta persetujuan; preview muncul; unduhan diterima browser dengan nama file benar.
- Cookie dihapus saat tab masih terbuka untuk mensimulasikan kedaluwarsa: simpan pengaturan mengambil token baru otomatis dan berhasil tanpa login.
- Penghapusan media melalui konfirmasi; galeri kembali kosong.
- Navigasi ketujuh halaman; `/login` redirect ke dashboard.
- Desktop 1440 px; viewport mobile 390 dan 320 px tanpa overflow horizontal. Animasi dimatikan saat screenshot agar tidak merekam transisi sidebar.
- Tidak ada JavaScript page error.

Screenshot: `screenshots/dashboard-no-login.jpg` dan `screenshots/mobile-no-login.jpg`. Nama workspace pada screenshot adalah fixture pemeriksaan, bukan akun atau data bawaan aplikasi. Harness browser sementara tidak dibundel; suite regresi yang disertakan dijalankan dengan `npm test`.

## Dependency dan paket

- Clean install menggunakan lockfile, tanpa bcrypt atau perintah setup/password website.
- `npm audit --omit=dev`: 0 kerentanan yang dilaporkan saat pemeriksaan. Ini bukan jaminan bebas semua celah.
- ZIP tidak memuat node_modules, `.env` aktif, data runtime, signing key, sesi WhatsApp, atau media pengguna.

## Batas verifikasi

- Tidak mengakses deployment atau log Railway milik pengguna; redeploy di akun pengguna belum diverifikasi.
- Tidak menautkan akun WhatsApp nyata. QR/pairing/status live dan kompatibilitas protokol saat deployment belum diverifikasi. Tidak ada klaim berhasil pairing dan tidak ada data pairing buatan.
- Tidak melakukan penetration test menyeluruh atau load test produksi. Safari/iOS/Android native belum diuji; mobile di atas adalah viewport Chromium.
- Aplikasi sengaja **tanpa autentikasi**: siapa pun yang dapat mencapai URL bisa menggunakan semua fitur, termasuk mengontrol WhatsApp dan menghapus media. CSRF, origin checking, cookie dan rate limit tidak mengubah kenyataan tersebut.
