# M8 — Hasil UAT manual (berjalan) — 2026-10-21/22, localhost:3100 + Vercel Hobby, data DUMMY

Penguji: Heylocal. Akun: Dummy 001 (PIC, Incognito), Dummy 002 (Manager, Chrome profil Work), Dummy 003 (Finance Ops, sesi ketiga). Status: SEDANG BERJALAN (belum final). Bukti kinerja/kapasitas Fase 1 sudah lengkap (lihat "Bukti kapasitas").

## Deploy Vercel (trial, 2026-10-22)
- Repo GitHub privat `unknown-88-jpg/p2p-portal` (commit 391fd47 = Fase 1 M0–M8 patch 1). Vercel team FAT (Hobby), project `p2p-portal`, URL produksi `https://p2p-portal-flax.vercel.app`, region sin1 (vercel.json).
- Env diisi dengan menempel isi `.env.local` (rahasia tidak lewat chat); `APP_BASE_URL` diubah ke URL Vercel lalu redeploy. `GET /login` → 200; login Dummy 001 berhasil; beranda memuat data Sheets dummy; banner "ENVIRONMENT TRIAL — DATA DUMMY" tampil.
- Buat pengajuan + upload lampiran ke Drive + submit dari Vercel: NTR-00009 (Rp 1.000.000) dan NTR-00010 (Rp 1.500.000) → Menunggu Manager.
- ⚠️ **Insiden rahasia (2026-10-22):** user mengirim screenshot `cat .env.local` ke chat; terlihat kunci privat service account (p2p-spike), JWT_SECRET, token Upstash, CRON_SECRET, HEALTH_TOKEN. Semua dianggap bocor → rotasi. **Status: SELESAI 2026-10-22** (lihat F-10).

## Perubahan data uji di sheet DUMMY (harus dibereskan sebelum UAT final / Fase 2)
- Master_User_TTD: baris tambahan Dummy 002 **Level 1** (HEYLOCAL/Brand) — untuk uji SoD (U19).
- Master_User_TTD: baris tambahan Dummy 003 **Level 2** (HEYLOCAL/Brand, Jabatan masih "Finance Ops") — Manager kedua untuk U15/U19/load-test (dipakai Fase B).
- Dummy 003 diberi password lewat `npm run issue-setpass` (U1).
- DB_SJ: **SJ-002 Total_Qty_Received diubah 250→100 untuk U6 — KEMBALIKAN ke 250.** Dokumen uji U6: TRD-00001 (Rp 70.000.000, Menunggu Manager) + draft INV-U6-B (Rp 9.000.000).
- Dummy 007 (nomor …5006) diberi password lewat `issue-setpass` (U8).
- Dokumen uji: NTR-00001..00010 (NTR-00008 Draft sisa uji U4/U5; NTR-00009/10 disetujui Fase B Vercel).
- Password Dummy 001 sempat tertulis di chat (akun dummy); atur ulang lewat issue-setpass bila perlu.

## Hasil per skenario
| # | Hasil | Catatan |
|---|---|---|
| U1 | ✅ | Dummy 003: link issue-setpass → set password OK. Pemakaian ke-2 link yang sama (2026-10-22 01:09, localhost) → ditolak "Link sudah kedaluwarsa atau tidak valid. Minta link baru." Audit: 4× ISSUE_SETPASS_LINK, 3× SET_PASSWORD, tiap SET_PASSWORD didahului penerbitan link baru (tak ada pemakaian ganda). Halaman /set-password tidak mengecek token saat dimuat (form tetap tampil) → F-12. Audit memakai nomor ter-mask; tak ada token/password di log. |
| U2 | ✅ | Uji di Vercel (Dummy 002, IP publik, Incognito) 2026-10-22 00:55: percobaan salah → "Nomor HP atau password salah…"; setelah kunci → "Terlalu banyak percobaan. Coba lagi beberapa menit lagi." Aturan (kode `LOGIN_RULE`): 5 gagal / 15 mnt per (nomor, IP), lepas otomatis. Audit: 1× LOGIN_FAILED (00:55:21) + 1× LOGIN_LOCKED (00:55:49). Audit kegagalan SENGAJA disampel (1 baris per nomor per aksi per 15 mnt, maks 10/mnt global; lindungi kuota tulis Sheets) → jumlah baris ≠ jumlah percobaan; penghitung kunci di Redis. Belum difoto: password benar tetap ditolak saat terkunci (terbukti di tes otomatis: `assertOpen` sebelum cek password); urutan tepat percobaan ke-5 tidak terfoto manual. |
| U3 | ✅ | NTR-00004 Rp 1.110.000, Submitted, tanpa badge CFO. Cek baris audit dokumen di sheet belum. |
| U4 | ✅ | File teks berlabel `.pdf` (16 B) ditolak server; NTR-00008 tetap Draft dan FILE_URL kosong. Pesan alasan tertutup → F-07 (diperbaiki patch 1). |
| U5 | ✅ | Peringatan duplikat inline menyebut NTR-00003 + saran pakai menu Bayar. Penolakan submit sisi server terbukti di M4a. |
| U6 | ✅ (aturan lama) → **uji ulang** | ⚠️ Diuji dengan aturan LAMA (retensi 90/10 + I11). Keputusan pemilik 2026-10-24 menghapus keduanya: untuk PO ini plafon kini = grand total Rp 86.874.645 dan "Pelunasan" dengan SJ 350/500 tidak lagi ditolak. Lihat ekspektasi baru di runbook U6. Catatan asli: PO-HL-23042026-002 (Grand Total Rp 86.874.645, qty PO 500, Non PPN). DB_SJ diubah sementara: SJ-002 250→100 (total SJ 350 < 500). Plafon retensi = 90% = Rp 78.187.181 (cocok hitungan `hitungPlafonSJ`). Rp 79.000.000: wizard memperingatkan di langkah Tagihan; di Tinjau banner merah + tombol "Ajukan ke Manager" nonaktif. Rp 70.000.000: lolos → TRD-00001, Menunggu Manager. Plafon KUMULATIF: tagihan ke-2 Rp 9.000.000 → "Sisa plafon P.O saat ini Rp 8.187.181" + ditolak; plus aturan terpisah "Barang belum diterima penuh (SJ 350 dari PO 500). Pembayaran 'Pelunasan' tidak bisa diajukan. Gunakan jenis 'DP'…". Penolakan sisi SERVER (bukan hanya tombol) terbukti di M4a (tes otomatis); belum diuji manual via API. |
| U7 | ✅ | NTR-00005 (Rp 7.770.000) & NTR-00006 (Rp 7.000.000): badge "Butuh TTD CFO", muncul di inbox Manager. |
| U8 | ✅ | Login nomor …5006 (ternyata Dummy 007 = Manager L2 dept FATS, bukan PIC Dummy 006) → buka /pengajuan/NTR-00009 (milik Dummy 001, Brand) → **404** "This page could not be found". Aturan `canViewDocument`: pemilik | Manager berwenang atas brand/dept | level ≥ 3; PIC murni lebih sempit (hanya pemilik). Varian PIC murni tak diuji manual. |
| U9 | ✅ | Angka antrean di beranda = isi inbox. |
| U10 | ✅ | NTR-00004 → Menunggu Verifikasi Pajak; timeline & stepper benar; PIC (sesi lain) melihat perubahan. Notif WA belum (M6). |
| U11 | ✅ | Dialog step-up; password salah → "Password salah."; benar → disetujui. Jendela 5 menit per sesi terbukti. |
| U12 | ✅ | WA gateway nyata (consumer `p2p-portal-trial`). Digest → WA "Ringkasan Approval" ke nomor penguji (Dummy 002); balas `SETUJU 9925` (NTR-00012, Rp 1.000.000) → balasan "berhasil disetujui via WhatsApp"; linimasa: Menunggu Manager → Menunggu Verifikasi Pajak, badge **WA**, satu baris persetujuan Manager. |
| U13 | ✅ (by design) | Digest TIDAK menerbitkan kode untuk ≥ Rp 5 jt (TRD-00001 Rp 70 jt hanya berisi link web); server menolak jalur `wa` untuk ≥ Rp 5 jt (`approval.ts:100`, RULE_VIOLATION); tes otomatis repo. Tidak diuji dengan kode karangan (akan menambah hitungan salah). |
| U14 | ✅ | Kode dipakai ulang → "Kode 9925 sudah dipakai sebelumnya." Kuncian: 10 kode salah beruntun (1001×2, 1003–1010) → pesan ke-11 (1011) dibalas "Terlalu banyak kode salah. Coba lagi nanti atau gunakan portal web." Kuncian WA nomor penguji ±1 jam (web tak terpengaruh). |
| U16 | ✅ | NTR-00013 (Rp 1.200.000): tab Dummy 003 dibuka (tampilan basi) → Dummy 002 setuju lewat WA (`SETUJU 2641`) → klik Setujui di tab basi → banner "Dokumen ini sudah tidak menunggu persetujuan Manager (status: Manager Approved). Daftar sudah dimuat ulang." Linimasa: tepat SATU baris persetujuan Manager (WA), tidak ada baris dari Dummy 003. |
| U15 | ✅ | NTR-00001: 003 setuju, 002 setuju dari tampilan lama → ditolak (status sudah Manager Approved), tepat 1 baris L2. Diperkuat Fase B Vercel di bawah. |
| U17 | ✅ | Tombol Kembalikan nonaktif tanpa alasan; chip alasan; NTR-00003 → Revision Needed; PIC melihat alasan. Notif WA belum. |
| U18 | ✅ | PIC submit ulang NTR-00003 → Menunggu Manager. "Nilai pajak lama dikosongkan" belum diverifikasi di sheet. |
| U19 | ✅ | Submit Manager tanpa Manager lain → ditolak di muka. Setelah ada Manager kedua: NTR-00007 masuk; inbox pembuat: banner SoD, tombol Setujui nonaktif. |
| U20 | ✅ | Finance (003) melihat detail & voucher dokumen PIC lain; rekening penuh untuk Finance (ter-mask untuk PIC). |
| U21 | ✅ sebagian | Chrome desktop OK. **Safari iPhone** (2026-10-22, p2p-portal-flax.vercel.app, NTR-00009): isi voucher benar, tanpa banner trial/nav, 4 kotak TTD lengkap (E-Signed Dummy 001 & 003, Menunggu verifikasi, TTD Basah), catatan CFO benar; footer URL/tanggal/"Page 1 of 2" = bawaan iOS. **Cacat:** cetak jadi 2 halaman, halaman 2 kosong kecuali "Dicetak … WIB" → F-13. Android belum diuji. |
| U22 | ✅ sebagian | Ctrl+K berfungsi; pembatas 40/menit bekerja (429). |
| U23 | ditunda | Upload dengan jaringan putus di perangkat nyata belum diuji (butuh PDF 3–10 MB di HP; user menunda 2026-10-22). Resume setelah putus juga belum terbukti (M4c). |
| U24 | ✅ lokal + Vercel (Fase A & B) | **Lokal:** run 1 CONC=5: p95 295 ms; Fase B NTR-00003/00007: 200×1+409×9, replay 409×5. Run 2 CONC=10 (sebelum patch): vendors p95 3,6 dtk, /api/pengajuan 3,4 dtk, 503×4 → F-09. Run 3 CONC=10 (setelah patch 1): 432 req, p50 190/p95 436/p99 1285 ms, 503×0, vendors p95 734 ms, pengajuan 567 ms. **Vercel (sin1) Fase A CONC=10, 30 dtk:** 358 req (11,9 rps), p50 61/p95 576/p99 1594 ms; 200×301, 429×57, 5xx 0; pengajuan p95 616, vendors 589. **CONC=30:** 979 req (32,6 rps), p50 58/p95 522/p99 937 ms; 200×804, 429×175, 5xx 0; pengajuan p95 567, vendors 836. **Fase B Vercel (CONC=10, 2 sesi):** NTR-00009 paralel 200×1 + 409×9, replay [200×5], persetujuan L2 di timeline = 1; NTR-00010 paralel 200×1 + 409×9, replay [409×5], persetujuan L2 = 1 → LULUS, tak ada persetujuan ganda/hilang. Bukti grafik/kapasitas: lihat bagian "Bukti kapasitas". |

## Bukti kapasitas (jendela uji 2026-10-22, Vercel Hobby sin1)
- **Google Sheets API (grafik "Read requests per minute", 6 jam):** puncak 15% dari batas 300/mnt (~45 read/mnt), selaras dengan limiter global ~45 read/mnt; saat dicek 1%. Belum tertangkap: grafik kuota per-user (60/mnt) dan hitungan 429 dari Google (limiter internal menahan lebih dulu).
- **Vercel Observability (Production, 6 jam):** Functions Error 0%, Timeout 0%; Active CPU total 27 dtk (puncak ~10 dtk); Fast Data Transfer ~2 MB keluar / 2 MB masuk; puncak CDN ~800 request, porsi 4XX = 429 pembatas pencarian dan 409 Fase B (sesuai desain). Observability Plus butuh Pro (tidak dipakai).
- **Upstash Redis (database `p2p-spike`, Free, Singapore):** 19K dari 500K command/bulan (~4%; write 8.732, read 10.134); hari uji berat ≈ 15.373 command (UTC); bandwidth 2 MB dari 10 GB; storage 11 KB dari 250 MB; biaya $0. Cukup untuk fase trial; hitung ulang berdasarkan jumlah user nyata saat go-live (cek rate limit, lock, tabver per request mendominasi). Pertimbangkan database terpisah/berganti nama sebelum go-live.
- **Bundle client (build lokal):** `.next/static/chunks` total 748 KB; 5 chunk terbesar 228/184/112/44/32 KB (mentah, belum gzip). Build Next 16 tidak mencetak First Load JS per rute. Cold start belum diukur terpisah (tidak ada Function Error/Timeout; p99 ≤ 1,6 dtk pada load test).


## WhatsApp gateway (trial, 2026-10-22/23)
- Consumer baru `p2p-portal-trial` di Ops Panel Lixus (gateway produksi `wa-we-store.lixus.id`, nomor produksi; consumer lain `Procurement Approval` & `payment-approval-we` TIDAK disentuh). Webhook URL = `https://p2p-portal-flax.vercel.app/api/webhooks/wa`.
- Env Vercel: `WA_GATEWAY_URL`, `WA_API_KEY`, `WA_WEBHOOK_SECRET` (Production), `WA_TRIAL_ALLOWLIST` (Production+Preview, hanya nomor penguji). Nilai dipindah lewat clipboard, tidak lewat chat. Redeploy, lalu Dummy 002 di Master_User_TTD (2 baris, L1 & L2) diganti sementara ke nomor WA penguji.
- Temuan perilaku: **WA ke Manager hanya lewat digest** (tidak ada notif otomatis saat submit; notif langsung hanya ke PIC setelah approve/kembalikan). Digest dipicu `GET /api/cron/digest` (Bearer CRON_SECRET); dipicu manual dari WSL. Delay "3 menit" bukan dari pengiriman WA (WA tiba beberapa detik setelah digest), tapi dari jeda submit→digest. Jadwal otomatis = GitHub Actions `.github/workflows/digest.yml` (**aktif per 2026-10-24**: secrets `APP_URL` & `CRON_SECRET` terpasang, run manual #5 sukses; lihat `docs/STATUS-DAN-ROADMAP.md`).
- Digest hasil: `{"dokumen":2,"manager":2,"terkirim":1,"gagal":1}` — 1 gagal = akun Manager lain bernomor dummy (`…5002`, di luar allowlist trial → diblokir; diharapkan). Log: `digest_gagal_kirim to 6280****5002`. Perlu dicek saat pembersihan: kenapa ada akun Manager yang masih memakai nomor lama `08000005002` (kemungkinan baris Dummy 002 lain/brand lain).
- Webhook nyata terbukti: event gema pesan keluar (`pesan sendiri`, `bukan message.received`) dilewati; pesan masuk valid diproses; `messageTimestamp` terbaca (tak dianggap basi); pengirim dikenali (format nomor OK). Tidak ada balasan aneh dari sistem lama (Apps Script) → tidak terlihat fan-out merugikan.

## Temuan
| ID | Skenario | Temuan | Dampak | Tindakan / status |
|---|---|---|---|---|
| F-01 | U17 | Banner revisi menampilkan penanda internal mentah `[DITOLAK MANAGER]` | UX | **Patch 1**: `catatanTampil()` → "Dikembalikan Manager: <alasan>" |
| F-02 | M7 | Invoice PDF tidak bisa dicetak gabungan dengan voucher (CSP object-src none) | UX | jadwalkan Fase 2; bandingkan dgn sistem lama |
| F-03 | M4b | Lampiran NTR-00003 = PDF stub uji | data uji | abaikan |
| F-04 | U19 | Label "menunggu persetujuan X" tidak memperhitungkan SoD | UX | **Patch 1**: `picOptions(..., pengaju)`; terlihat benar di Vercel ("menunggu persetujuan Pengguna Dummy 002" untuk dokumen Dummy 001) |
| F-05 | U19 | Dokumen buatan sendiri ikut dihitung di antrean Manager | UX | **Keputusan user: sembunyikan.** Patch 1 |
| F-06 | beranda | "Pengajuan divisi bulan ini" menghitung Draft | UX | **Keputusan user: hanya yang sudah diajukan.** Patch 1 |
| F-07 | U4 | Alasan penolakan upload tertutup pesan umum | UX | **Patch 1** |
| F-08 | U24 | Skrip load-test memanggil `/api/master/vendors?q=ga` → 400 | skrip uji | diperbaiki di repo (commit 391fd47) |
| F-09 | U24 | `/api/master/vendors` baca Sheets segar tiap request; CONC=10 p95 ≈ 3,6 dtk, 503×4 | performa | **Patch 1** (cache 15 dtk + single-flight; submit tetap validasi vendor SEGAR, I8). **Terbukti lokal & di Vercel** (p95 < 0,9 dtk, 0×503). |
| F-11 | U2 | Pesan terkunci tak menyebut durasi, padahal server menghitung sisa detik (`Retry-After`) | UX rendah | **Patch 2 (PR #18, di `main`)**: "Coba lagi dalam ±N menit" (`durasiTunggu`) |
| F-12 | U1 | Halaman /set-password tak memeriksa token saat dimuat; user baru tahu link mati setelah mengetik password | UX rendah | **Patch 2 (PR #18, di `main`)**: `POST /api/auth/set-password/cek` (intip saja), form menampilkan "Link tidak berlaku" |
| F-13 | U21 | Cetak voucher di Safari iPhone → 2 halaman; halaman 2 kosong hanya berisi "Dicetak … WIB". Isi tersusun 1 kolom di iOS (aturan `@media (max-width:640px)` ikut aktif saat cetak) sehingga lebih tinggi dari A4 | UX rendah-sedang (boros kertas) | **Patch 2 di `main` (PR #18); masih harus diverifikasi ulang di iPhone.** Rencana (CSS saja): paksa `.vc-grid` 2 kolom di `@media print`, rapatkan `.vc-sign`/padding, pindahkan "Dicetak" ke header, `break-inside: avoid` pada kotak TTD; verifikasi ulang di iPhone yang sama |
| F-10 | deploy | Rahasia `.env.local` (kunci SA, JWT_SECRET, token Upstash, CRON_SECRET, HEALTH_TOKEN) tertampil di screenshot chat | keamanan (kredensial dummy tetapi nyata) | **DITUTUP 2026-10-22.** Rotasi selesai: kunci SA baru (ID berakhiran 41af02) di Vercel & `.env.local`, kunci lama DIHAPUS di Google Cloud; JWT_SECRET, CRON_SECRET, HEALTH_TOKEN dibuat ulang (`openssl rand -hex 32`); kredensial Upstash di-reset, token baru dipasang; redeploy; login & Pengajuan saya diverifikasi setelah rotasi dan setelah kunci lama dihapus. Sisa kebersihan: hapus `~/p2p-portal/.env.local.bak` (rahasia LAMA, sudah tidak valid); CRON_SECRET baru belum dipasang di GitHub Actions. Pelajaran: salin ke clipboard (`clip.exe`), jangan `cat` di layar. |
| F-14 | U12 | Balasan teks tebal hasil copy dari WA (`*SETUJU 2641*`) dibalas "Format tidak dikenali" (hanya yang diketik polos berhasil) | UX rendah | **Patch 2 (PR #18, di `main`)**: `parsePerintah` abaikan penanda format `*`, `_`, `~` |
| F-15 | U12 | WA ke Manager hanya lewat digest terjadwal, bukan otomatis saat submit | desain / ekspektasi | **Selesai 2026-10-24 (keputusan pemilik):** digest terjadwal tetap + tombol **Kirim WA** untuk PIC di beranda (maks. 1x/hari WIB per dokumen). Sebelumnya: catat; aktifkan GitHub Actions (secrets `APP_URL` + `CRON_SECRET`, interval ditentukan user); pertimbangkan notif langsung saat submit di fase berikut |
| F-16 | U12 | Ada akun Manager lain yang masih bernomor lama `08000005002` (digest `gagal:1` → `digest_gagal_kirim to 6280****5002`, ditolak allowlist trial) | data uji | cek saat pembersihan Master_User_TTD (baris Dummy 002 lain/brand lain?) |

## Patch 2 — status (2026-10-24)
Sudah di `main` lewat PR #18 (`npm run check` hijau). Sisa: pastikan ter-deploy, verifikasi F-13 di iPhone asli. Isi: F-11 (durasi kunci login), F-12 (cek token saat load /set-password), F-13 (cetak voucher 1 halaman di iOS), F-14 (parser WA abaikan `*`/`_`/`~`). Semua UX rendah, tanpa menyentuh kontrol uang/keamanan.

## Patch 1 (M8) — status
Diterapkan user 2026-10-21; `npm run check` hijau di mesin user (565 test). Load test lokal & Vercel lulus.

## Sisa menuju penutupan Fase 1
1. ~~Rotasi rahasia (F-10)~~ selesai. 2. ~~Bukti Vercel/Upstash/bundle/Sheets~~ selesai. 3. UAT tersisa: U21 Android, U23 (ditunda), cek baris audit dokumen di sheet (U3/U18). **U12–U14/U16 (WA) SELESAI 2026-10-23.** (U1, U2 selesai 2026-10-22.) 4. Bereskan data dummy (**kembalikan nomor Dummy 002 (2 baris) ke 08000005002**, baris role tambahan, dokumen uji NTR-00001..00013 + TRD-00001 + draft INV-U6-B, hapus allowlist/cabut consumer `p2p-portal-trial` bila tak dipakai lagi, reset password Dummy 001; Dummy 002 sempat terkunci, lepas sendiri; password Dummy 003 sekarang = yang dipilih penguji). `.env.local.bak` sudah dihapus. 5. Update m8-hasil.md & phase1-status.md. 6. Konfirmasi eksplisit O4/O5 sebelum Fase 2.

Temuan uang/keamanan terbuka: tidak ada. Tidak ada temuan kontrol uang terbuka.

## Pembaruan 2026-10-24 (dicocokkan dengan kode `main`)
- **Keputusan pemilik (final):** #16 retensi 10% dihapus (plafon = grand total P.O penuh); #17 I11 dihapus (Trade non-DP tetap bisa diajukan walau SJ belum lengkap; Tinjau hanya menampilkan info) + klik Full Payment mengisi nilai invoice = sisa tagihan P.O. Tercatat di README §M3, design doc I10/I11, runbook U6.
- Patch 1 (F-01, F-04–F-07, F-09) dan Patch 2 (F-11–F-14) terverifikasi ada di kode `main`.
- F-15 selesai: tombol Kirim WA (1x/hari/dokumen) + digest terjadwal.
- Masih terbuka: F-02 (cetak gabungan PDF), F-16 (data uji), throttle `setpass` global, U6 uji ulang, U21 Android, U23, audit U3/U18, verifikasi F-13 di iPhone, pembersihan data dummy, konfirmasi O4/O5.
