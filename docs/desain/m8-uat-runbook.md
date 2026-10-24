# M8 — Runbook UAT Fase 1 (data DUMMY, deploy Vercel Hobby trial)

Tujuan: membuktikan exit Fase 1 — **3 PIC + 2 Manager**, approval via **web dan WhatsApp pada dokumen yang sama** tanpa bentrok, semua invarian Fase 1 terlihat benar di aplikasi nyata. Yang diuji di sini = yang TIDAK bisa dibuktikan tes otomatis (Sheets/Drive/Redis/WA nyata, perangkat nyata).

## 0. Prasyarat (centang sebelum mulai)
- [ ] Deploy trial hidup, `/api/health` (header `x-health-token`) hijau; banner "ENVIRONMENT TRIAL — DATA DUMMY" tampil.
- [ ] Env WA terisi: `WA_GATEWAY_URL`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`, `WA_TRIAL_ALLOWLIST` (nomor WA uji milik sendiri), webhook URL terpasang di Ops Panel gateway.
- [ ] GitHub Actions secrets `APP_URL`, `CRON_SECRET` terisi; `CRON_SECRET` di Vercel sama.
- [ ] Peserta: PIC-1, PIC-2, PIC-3 (brand/dept boleh berbeda), Manager-A (berwenang atas dept PIC-1 & PIC-2), Manager-B (dept PIC-3, atau Manager kedua di dept PIC-1 untuk uji bentrok). Semua punya password. **Nomor WA Manager-A = nomor uji yang ada di allowlist.**
- [ ] 1 vendor Approved tipe Trade dan 1 Non-Trade, 1 PO di DB_PO dengan SJ parsial.
- [ ] Siapkan 2 file invoice (JPG ≤ 2 MB, PDF ≤ 2 MB) dan 1 file palsu (rename `.exe` → `.pdf`).
- [ ] Rotasi token Upstash sudah dilakukan (konfirmasi).

## 1. Skenario (isi kolom Hasil: ✅ / ❌ + catatan)

| # | Pelaku | Langkah | Yang harus terjadi | Invarian | Hasil |
|---|---|---|---|---|---|
| U1 | PIC-1 | Login pertama (link set-password dari WA / `issue-setpass`), buat password, login ulang | Link sekali pakai; link yang sama kedua kali ditolak | auth | |
| U2 | PIC-1 | Salah password 5× lalu benar | Terkunci (429), pesan beda dari salah biasa; setelah jendela lewat bisa masuk | auth | |
| U3 | PIC-1 | Wizard Non-Trade < Rp 5 jt: isi, upload JPG, submit | Status Submitted; badge CFO tidak ada; audit `STATUS_CHANGE` | I1 I2 | |
| U4 | PIC-1 | Upload file `.exe` dipalsukan jadi `.pdf` | Ditolak (magic bytes) | M4b | |
| U5 | PIC-1 | Buat pengajuan kedua dengan vendor + no. invoice yang sama | Peringatan duplikat inline; submit ditolak | I9 | |
| U6 | PIC-2 | Wizard **Trade** dengan PO yang SJ-nya parsial; nominal melebihi plafon retensi | Ditolak dengan pesan plafon; nominal ≤ plafon lolos | I10 I11 | |
| U7 | PIC-2 & PIC-3 | Buat dokumen ≥ Rp 5 jt (mis. 7.500.000) lalu submit | Badge "Butuh TTD CFO"; muncul di inbox Manager berwenang saja | I1 | |
| U8 | PIC-3 | Buka URL `/pengajuan/<ID milik PIC-1>` | **404** (bukan 403, bukan detail) | I13 | |
| U9 | Manager-A | Beranda: hitung antrean, buka `/persetujuan`, deep link dari digest WA | Hanya dokumen dept berwenang; angka dashboard = jumlah inbox | I13 | |
| U10 | Manager-A | Setujui dokumen < 5 jt lewat web | Status Manager Approved; baris Trx_Approval L2 `Method=E-SIGN`, catatan `[Portal-HP]`; PIC dapat notif WA | I3 I15 | |
| U11 | Manager-A | Setujui dokumen ≥ 5 jt | Diminta password ulang (step-up); password salah ditolak; benar → berhasil | I14 | |
| U12 | Manager-A (WA) | Tunggu digest (atau picu `GET /api/cron/digest` dengan Bearer) lalu balas `SETUJU <kode>` untuk dokumen < 5 jt | Dokumen Manager Approved, `Method=WA`, catatan `[via WhatsApp]`, balasan konfirmasi diterima | I14 | |
| U13 | Manager-A (WA) | Balas `SETUJU <kode>` untuk dokumen ≥ 5 jt (kode dipaksa/ditebak) | Ditolak, balasan mengarahkan ke web; status tak berubah | I14 | |
| U14 | Manager-A (WA) | Balas kode yang sama dua kali; balas kode salah 10× | Kedua kali: ditolak (sekali pakai); 10 salah: terkunci 1 jam | I14 | |
| U15 | Manager-A **web** + Manager-B **web** | Buka dokumen yang sama; A setujui, lalu B setujui dari tampilan lama | B mendapat pesan "sudah berubah/diproses" (409), inbox B menyegarkan; hanya 1 baris L2 | I3 | |
| U16 | Manager-A **web** & Manager-A **WA** | Dokumen yang sama: setujui via WA, lalu klik setujui di web dari tampilan lama | Web menolak (409); hanya 1 baris L2 (Method=WA) | I3 I14 | |
| U17 | Manager-A | Tolak dokumen dengan alasan | Status Revision Needed; PIC dapat notif; alasan tampil di detail PIC | I3 | |
| U18 | PIC-1 | Revisi dokumen yang ditolak, submit ulang | Kembali Submitted; nilai pajak lama dikosongkan | I12 | |
| U19 | Manager-A | Dokumen buatan Manager-A sendiri (dia juga PIC) | Tidak bisa disetujui sendiri (SoD), pesan jelas; tidak ada di digest-nya | O5a | |
| U20 | Finance (Level 3) | Buka detail & voucher dokumen mana pun | Boleh; voucher memuat kotak TTD sesuai level | I13 | |
| U21 | PIC-1 | Voucher: Cetak voucher / invoice / keduanya (Chrome desktop, Safari iOS, Android) | A4 rapi, tanpa banner/nav, kotak TTD lengkap | M7 | |
| U22 | PIC-1 | Ctrl+K cari: ID, vendor, no. invoice | Hanya dokumen yang boleh dilihat; ketik cepat tidak memicu error 429 | I13 | |
| U23 | PIC-1 | Upload besar (~2 MB) di HP lalu matikan Wi-Fi di tengah, nyalakan lagi | Upload lanjut / pesan jelas untuk coba lagi; tidak ada file yatim permanen | M4c | |
| U24 | Admin | Jalankan `npm run load-test` (lihat §2) selama UAT berjalan atau sesudahnya | Fase A & B lulus | M8 | |

## 2. Uji beban dari luar (ulang S1, dari Vercel)
```
APP_URL=https://<deploy-trial>.vercel.app \
LOAD_USERS="<hp-PIC1>:<pw>,<hp-PIC2>:<pw>" LOAD_MANAGER="<hp-ManagerA>:<pw>" \
LOAD_DOCS="<ID Submitted < 5 jt>,<ID lain>" LOAD_DURATION=60 LOAD_CONC=10 npm run load-test
```
Sebelum fase B, pastikan `LOAD_DOCS` berstatus Submitted dan **bukan buatan Manager yang dipakai** (SoD). Catat: p95 per endpoint, jumlah 429/503, grafik Vercel (durasi fungsi, error), Upstash (commands/s), dan kuota Sheets (Cloud Console → Quotas). Target: tidak ada 5xx selain 503 anggun; fase B lulus; p95 baca < 2 dtk dengan cache hangat.
Ulangi dengan `LOAD_CONC=30` (≈ 10× pengguna tipikal). Kalau 503 > 20%: laporkan, jangan naikkan kuota dulu.

## 3. Ukuran bundle (sisa S8)
Dashboard Vercel → Deployment → Functions: catat ukuran tiap fungsi (batas Hobby 250 MB unzipped; ukuran besar memperlambat cold start). Tempel angka di tabel temuan.

## 4. Log temuan UAT
| ID | Skenario | Temuan | Dampak (uang/keamanan/UX) | Tindakan | Status |
|---|---|---|---|---|---|
| F-01 | | | | | |

Aturan penutupan: temuan dampak uang/keamanan wajib ditutup sebelum M8 dinyatakan selesai; UX boleh dijadwalkan ke Fase 2 dengan alasan tertulis.

## 5. Kriteria selesai Fase 1
Semua U1–U24 ✅ (atau ❌ dengan temuan terjadwal), fase A & B load test lulus, bundle tercatat, token Upstash dirotasi, daftar ❌ ditinjau bersama.
