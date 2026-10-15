# STATUSX DOWNLOADER — v1.1.0 TANPA LOGIN

Dashboard langsung terbuka di `/`. **Tidak ada username, password, halaman login, atau setup akun website.** Variabel lama `APP_USERNAME`, `APP_PASSWORD_HASH`, dan `SESSION_SECRET` diabaikan dan boleh dihapus.

> **Akses terbuka:** siapa pun yang dapat menjangkau URL dapat melihat, mengunduh, mengunggah, menghapus media, mengubah pengaturan, serta mengendalikan koneksi WhatsApp. Jangan hubungkan akun atau simpan media sensitif pada deployment publik tanpa pembatasan jaringan. CSRF, cookie, dan rate limit bukan kontrol akses.

## Memperbarui deployment lama

1. Ganti source lama dengan isi ZIP versi ini, termasuk `package.json`, `package-lock.json`, `public`, dan `src`. Hapus file source lama yang tidak terdapat di ZIP; jangan menghapus Volume/data Anda.
2. Deploy ulang. Start Command: `npm start`. Build/install: `npm ci`.
3. Pertahankan Volume dan `DATA_DIR` yang sebelumnya digunakan. Tidak perlu mengisi ulang username/password atau membuat secret.
4. Buka domain utama. Badge **TANPA LOGIN · v1.1** menandai versi baru. `/login` dan `/login.html` otomatis mengarah ke dashboard. Jika masih terlihat halaman lama, refresh keras dan pastikan deployment aktif adalah versi baru.

## Menjalankan lokal

Node.js 22 disarankan; minimum 20.19, npm, dan Git untuk dependency Baileys.

```sh
npm ci
npm start
```

Buka `http://localhost:3000`. `.env` opsional; konfigurasi default dapat langsung dijalankan. `npm run dev` mengaktifkan watch. Tidak ada perintah setup/hash-password lagi.

## Railway

- Source harus berada di Root Directory service, tempat `package.json` berada.
- `railway.json` memakai Nixpacks; tidak memerlukan Docker atau database.
- Build: `npm ci`; Start: `npm start`; healthcheck: `/health`.
- Server menerima `PORT` Railway dan bind `0.0.0.0`.
- Buat Volume, misalnya mount `/app/data`, dan set `DATA_DIR=/app/data`.
- Set `NODE_ENV=production`, `TRUST_PROXY=1`; gunakan **satu replica**.
- `PUBLIC_ORIGIN` opsional. Jika kosong, `RAILWAY_PUBLIC_DOMAIN` digunakan otomatis. Jika memakai domain kustom, isi origin lengkap, misalnya `https://status.example.com`, tanpa path. Hapus nilai lama yang menunjuk domain berbeda untuk menghindari penolakan origin.
- Jangan mengganti DATA_DIR/mount yang sudah berisi media atau sesi WhatsApp. Volume bukan backup; buat backup sendiri saat aplikasi dihentikan.
- `/health` menampilkan `version: "1.1.0"` dan `accessMode: "open"`.

**Domain publik berarti fitur terbuka bagi publik.** Bila diperlukan, batasi akses melalui jaringan privat, VPN atau aturan ingress yang Anda kelola, bukan mengandalkan URL yang sulit ditebak.

## Fitur

- Dashboard, koneksi WhatsApp, galeri, unduhan, riwayat, pengaturan, dan bantuan.
- Impor foto/video lokal milik sendiri atau berizin; tetap berfungsi tanpa koneksi WhatsApp.
- Validasi signature file, pencarian/filter/urut, preview, seleksi, penghapusan, unduh individual dan ZIP.
- Progres upload/download, pembatalan, retry, riwayat/ekspor, retensi dan quota penyimpanan.
- Badge “Diterima browser” berarti data diserahkan ke browser, bukan bukti file tersimpan ke disk. Disarankan ZIP di bawah 50 MB pada ponsel; Blob memakai memori perangkat.
- Tidak ada seed galeri, status contoh, QR palsu, atau kode pairing buatan.

## WhatsApp opsional — penting

Baileys adalah integrasi **tidak resmi**, tidak berafiliasi dengan WhatsApp/Meta. Ada risiko pembatasan akun, perubahan protokol, pairing gagal, dan status tidak tersedia lengkap. Tidak ada jaminan seluruh status akan muncul atau integrasi akan terus kompatibel.

1. Buka Koneksi WhatsApp dan berikan persetujuan untuk akun milik sendiri/yang Anda berwenang kelola.
2. Pilih QR atau pairing code. Lakukan penautan di aplikasi WhatsApp resmi; nomor saja tidak memberi akses akun.
3. Aktifkan koleksi otomatis hanya untuk konten yang Anda berhak simpan. Aplikasi hanya memproses media gambar/video baru dari `status@broadcast`, bukan percakapan pribadi, view-once, atau status lama/yang tidak tersedia.
4. Sesi disimpan di DATA_DIR. Setelah restart, lanjutkan sesi secara eksplisit dari halaman koneksi. Menutup tab tidak memutus koneksi; tombol “Putuskan & hapus sesi” menghapus sesi WhatsApp lokal.

Set `BAILEYS_ENABLED=false` untuk mode impor lokal saja. Antarmuka akan menjelaskan integrasi dinonaktifkan, bukan menampilkan pairing palsu. Dependency Baileys tetap di-install agar source mendukung kedua mode. Penautan WhatsApp tetap membutuhkan otorisasi pemilik akun—yang dihapus adalah login **website**.

## Konfigurasi opsional

| Variabel              | Default / fungsi                                               |
| --------------------- | -------------------------------------------------------------- |
| `PORT`                | `3000`; Railway menyediakan sendiri                            |
| `DATA_DIR`            | `./data`; gunakan mount Volume di produksi                     |
| `NODE_ENV`            | mode development jika tidak diisi; set `production` di Railway |
| `TRUST_PROXY`         | `1` di produksi, `0` di development                            |
| `PUBLIC_ORIGIN`       | kosong; domain Railway otomatis bila tersedia                  |
| `BAILEYS_ENABLED`     | `true`                                                         |
| `MAX_FILE_MB`         | `40` per file                                                  |
| `MAX_STORAGE_MB`      | `512` total media                                              |
| `MAX_ZIP_MB`          | `200` per paket                                                |
| `SESSION_HOURS`       | `12`; umur cookie anonim CSRF, bukan login                     |
| `ALLOW_EMBED_PREVIEW` | `false`; jangan aktifkan di produksi                           |

Maksimal 10 file per impor, 100 pilihan/paket, 2.000 media, satu download aktif dan antrean terbatas. Nilai numerik kosong memakai default; nilai invalid/di luar rentang gagal dengan pesan konfigurasi. Tidak ada ORM, migration, database eksternal, atau cloud storage wajib.

## Penyimpanan dan proteksi yang tetap ada

- JSON/file lokal dengan atomic write terserialisasi; file permission 0600 dan direktori 0700. Metadata, media, riwayat, sesi WhatsApp, cookie CSRF, dan audit berada di DATA_DIR, tidak disajikan langsung sebagai folder statis.
- Media disajikan melalui API yang **terbuka**. File lokal tidak terenkripsi at rest; lindungi akses filesystem, Volume dan backup.
- Cookie HttpOnly/SameSite dan token CSRF otomatis; cookie Secure mengikuti HTTPS melalui proxy pada mode produksi. Kunci penandatanganan internal dibuat sendiri di `data/secrets/session.key`—jangan isi `SESSION_SECRET` manual.
- Origin checking dan CSRF mengurangi permintaan lintas-situs dari browser, tetapi **siapa pun dapat meminta token sendiri** dan menggunakan fitur. Rate limit, quota, ID aman, MIME/signature checks, dan CSP tetap aktif.
- Respons media/API tidak di-cache; aset frontend diberi versi untuk menghindari JavaScript login lama setelah upgrade.
- Worker WhatsApp dipisahkan; stdout/stderr library tidak diteruskan untuk mencegah kebocoran materi sesi ke log.
- Pembersihan berkala menangani file sementara dan retensi. JSON rusak tidak diam-diam ditimpa; startup mengeluarkan kode diagnostik yang aman.

## Struktur

```text
src/server/       konfigurasi, HTTP, startup/shutdown
src/routes/       API terbuka, media, unduhan, WhatsApp
src/middleware/   CSRF, origin, rate limit
src/services/     JSON, media, unduhan, cookie, audit, WhatsApp manager/worker
public/           UI responsif HTML/CSS/JavaScript
test/            pengujian regresi (jalankan npm test)
docs/QA.md        hasil verifikasi dan keterbatasan
```

## Diagnostik

- `SERVER_READY` berarti server sudah mendengarkan; `accessMode: open` menandai edisi tanpa login.
- `CSRF_REJECTED`: klien memperbarui token otomatis satu kali; untuk upload, token baru diambil sebelum kirim. Jika cookie diblokir, buka domain langsung di browser, bukan iframe.
- Origin ditolak: periksa `PUBLIC_ORIGIN`, domain aktif, dan `TRUST_PROXY`.
- `EACCES`/izin Volume, `ENOSPC`/disk penuh, JSON invalid, atau port terpakai ditampilkan sebagai diagnostik startup yang aman. Perbaiki penyebabnya; jangan menghapus data tanpa backup.
- Status WhatsApp kosong bukan berarti bug login: penautan, akses akun, pengiriman status, dan protokol WhatsApp adalah hal terpisah.

## Pemeriksaan dan lisensi

```sh
npm test
npm audit --omit=dev
```

Lihat `docs/QA.md` untuk yang benar-benar diuji. Deployment Railway milik pengguna dan pairing akun WhatsApp nyata belum diverifikasi dalam lingkungan ini. Dependency memiliki lisensinya masing-masing; khususnya libsignal yang digunakan Baileys memakai GPL-3.0—tinjau kewajiban sebelum mendistribusikan atau mengubah aplikasi.
