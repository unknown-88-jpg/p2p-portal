# RISK REGISTER & DEBUG REPORT — Migrasi P2P Finance Portal ke Vercel (Sheets + Drive)

**Status:** DRAFT untuk review · **Tanggal:** 2026-10-05
**Dokumen terkait:** `claude/vercel-migration-design.md`, `claude/adr-001-vercel-sheets-drive.md`

## Cara baca dokumen ini

Format mengikuti alur debug: **Reproduksi → Akar masalah → Perbaikan → Pencegahan**. Tiap risiko diberi **dasar bukti**:

- **[KODE]** = terlihat langsung di kode Apps Script yang dibaca ulang hari ini (fungsi disebut). Ini analisis statis — **belum dijalankan** di produksi; "reproduksi" adalah skenario yang menurut kode pasti terjadi, bukan hasil uji.
- **[DOK]** = dari dokumentasi resmi Google/Vercel/Upstash yang diambil 2026-10-05 (sumber di design doc 2.3).
- **[ASUMSI]** = inferensi/asumsi yang perlu dibuktikan (terkait spike S1–S8).

Dua kelompok:
**A.** Risiko yang **muncul karena migrasi** (R-01 … R-13, R-15, R-20, R-22 … R-29, R-33).
**B.** **Cacat laten di sistem lama** yang ketemu saat membaca kode — **jangan disalin ke sistem baru** (R-14, R-16 … R-19, R-21, R-30 … R-32). Beberapa menyentuh kontrol keuangan → **tidak diubah diam-diam**; butuh keputusan lo (O4/O5 di design doc).

---

## Ringkasan (urut keparahan)

| ID | Sev | Risiko | Kelompok | Bukti |
|---|---|---|---|---|
| R-02 | **Kritis** | Tanpa `LockService`: race pada plafon PO, invoice unik, rekening vendor, ID, overpay | A | KODE+DOK |
| R-01 | Tinggi | Kuota Sheets 60 baca/60 tulis per menit (service account = 1 user) | A | DOK |
| R-03 | Tinggi | Tulis sel-per-sel → data setengah berubah saat gagal/timeout/429 | A (pola lama) | KODE |
| R-04 | Tinggi | Pembayaran ganda: tanpa idempotency, retry/klik ganda lolos | A+B | KODE |
| R-06 | Tinggi | Korupsi tipe data (nol di depan, tanggal serial, apostrof, float) | A | KODE |
| R-08 | Tinggi | Batas body 4,5 MB memutus upload/preview/cetak invoice | A | DOK+KODE |
| R-09 | Tinggi | Service account tak punya storage; approver tak punya akses Drive | A | DOK+KODE |
| R-10 | Tinggi | Hobby = non-komersial; data produksi tidak boleh di trial | A | DOK |
| R-14 | Tinggi | Auth: tanpa lockout, oracle enumerasi nomor, hash lemah | B+A | KODE |
| R-15 | Sedang-Tinggi | Webhook WA: format terjawab (S6); sisa replay tanpa batas & pesan hilang (tanpa retry) | A | S6 2026-10-07 |
| R-17 | Tinggi | Approval L4/L5 dicatat atas nama **pengunggah**, bukan penandatangan; CFO gate = centang | B | KODE |
| R-21 | Tinggi | `approveVendor(rowIdx)` rawan salah sasaran kalau sheet di-sort | B | KODE |
| R-24 | Tinggi | Kredensial service account: key diblokir org policy / bocor | A | ASUMSI+DOK |
| R-27 | Tinggi | Cutover: counter ID, hash password, webhook, drift data | A | KODE |
| R-05 | Sedang-Tinggi | Zona waktu UTC vs WIB (tanggal geser 1 hari, export salah rentang) | A | KODE |
| R-18 | Sedang-Tinggi | Manager yang juga PIC bisa menyetujui dokumennya sendiri | B | KODE |
| R-22 | Sedang-Tinggi | Edit manual di Sheet / header berubah → tulis ke kolom salah | A | KODE |
| R-26 | Sedang-Tinggi | Redis mati / lock salah → fail-closed vs celah | A | ASUMSI |
| R-07 | Sedang | Cache basi vs edit manual & keputusan uang | A | ASUMSI |
| R-11 | Sedang | Cron Hobby maks 1×/hari → digest WA tidak jalan sesuai jadwal | A | DOK |
| R-12 | Sedang | Runtime log Hobby 1 jam → insiden sulit diselidiki | A | DOK |
| R-16 | Sedang | OTP: `Math.random`, plaintext, tanpa batas percobaan; email via MailApp hilang | B+A | KODE |
| R-19 | Sedang | Satu orang Finance bisa menjalankan 4 tahap berturut-turut | B | KODE |
| R-20 | Sedang | Scan penuh 48 kolom tiap panggilan tidak skala lewat REST | A | KODE |
| R-25 | Sedang | Vercel/Google outage; ketergantungan baru | A | ASUMSI |
| R-29 | Sedang | Semantik bulk: sebagian berhasil vs atomik | A | KODE |
| R-30 | Sedang | Gateway WA tidak resmi (risiko blokir nomor), laju kirim | B | KODE |
| R-31 | Rendah-Sedang | Approval lama tak dibatalkan setelah revisi | B | KODE (perlu uji) |
| R-32 | Sedang | `writeAudit` menelan error → celah audit | B | KODE |
| R-33 | Rendah | Upstash free 500K command/bulan | A | DOK |
| R-34 | Sedang | Asal pemetaan LID→nomor belum jelas (I14); sampel webhook mentah memuat PII | A+B | S6 2026-10-07 |
| R-13 | Rendah | Hobby: 100 deploy/hari, 1 build concurrent, repo org GitHub tidak bisa | A | DOK |
| R-23 | Rendah | Timeout/latensi region Vercel↔Google/Redis | A | ASUMSI |
| R-28 | Rendah | Paritas cetak A4/PDF lintas browser | A | KODE |

---

## A. Risiko akibat migrasi

### R-02 — Race condition tanpa lock global  · **Kritis**  · [KODE+DOK + TERBUKTI S2b 2026-10-06]

- **Bukti (Sheets + Upstash asli, dummy):** 20 pengaju bersamaan, tanpa lock → 18 diterima, plafon PO bocor Rp 8 jt; dengan lock Redis → tepat 10 diterima, total persis Rp 90 jt, 0 kelebihan (`claude/spike-results.md`).

- **Reproduksi (skenario):** PO senilai Rp 100 jt, plafon bebas 90 jt, sudah diajukan Rp 80 jt. Dua PIC berbeda submit invoice Rp 8 jt masing-masing **bersamaan**. Di Vercel dua fungsi jalan paralel; keduanya menjalankan `assertPOTidakOverbilling_` → `getPOBillingHistory` → masing-masing melihat total 80 jt + (dokumen sendiri sudah tercatat sebagai draft) ≤ 90 jt, keduanya lolos → total 96 jt melewati plafon. Pola sama untuk: dua invoice sama dari vendor yang sama (`assertNoDuplicateInvoice_`), dua pendaftaran rekening sama (`submitNewVendor`), dua `generateTransactionID_` (ID ganda), dua pembayaran sisa kecil (`executePaymentCore_`), dua approve dokumen yang sama.
- **Akar masalah:** sistem lama dilindungi **satu lock global** `LockService.getScriptLock()` di `withLock` (Utils.gs) — semua aksi tulis berbaris satu-satu. Itu menyembunyikan bahwa pemeriksaan "baca lalu tulis" tidak atomik. Vercel tidak punya padanannya; fungsi serverless berjalan paralel di banyak instance.
- **Perbaikan:** lock terdistribusi Redis per-sumber-daya, **kunci diurutkan** (`trx:`, `po:`, `inv:`, `vendor-rek:`, `seq:`), `SET NX PX` + token + pelepasan Lua, baca segar di dalam lock, flush atomik (design doc 4.3). Mode aman cadangan: satu kunci `global:write` (meniru lama) lewat feature flag.
- **Pencegahan:** race test 20 request paralel untuk lima skenario di atas (design doc 4.7) sebagai gerbang CI; kode review wajib memeriksa "kunci apa yang diambil aksi ini?" untuk tiap route tulis; fail-closed saat Redis tak tersedia (R-26).

### R-01 — Kuota Sheets API  · Tinggi  · [DOK + S1 2026-10-06]

- **Hasil S1 (dummy, 20 user):** 0× 429 di 4 variasi; tanpa cache puncak baca 54/60 (margin ±10%), dengan cache 19–41/60. Kuota bukan hambatan di skala asumsi, tapi cache wajib untuk ruang gerak. **Uji patah (60 user, tanpa cache): 70,8% percobaan kena 429, 7,7% aksi gagal, p95 58 dtk; retry memperbesar beban.** Mitigasi: stale-if-error, pembatas laju global + antrean, retry budget kecil, multi service account (lihat `claude/spike-results.md`).

- **Reproduksi:** 21 baca/detik tidak perlu — cukup 1 request/detik terus-menerus untuk menghabiskan 60/menit. Sistem lama membaca **seluruh 48 kolom** pada tiap `getFinanceQueues`, `getUserDraftsAndHistory`, `getHomeContext`, `getPOBillingHistory`, `getPrintData` lewat `getRange(...).getValues()` (cepat in-process di Apps Script, tapi satu *request REST* per panggilan di Vercel). 10 user membuka dashboard dalam satu menit sudah mendekati batas; satu klik "bayar massal" 30 baris (di pola lama: banyak `setValue` + `appendRow`) melanggar batas tulis.
- **Akar masalah:** kuota **60/menit/user/project**, dan service account dihitung satu user; edisi Workspace **tidak** menaikkannya (design doc 2.5).
- **Perbaikan:** cache Redis + `batchGet` + baca kolom terbatas + indeks `id→baris`; semua tulis jadi **1 `batchUpdate` per aksi/bulk**; backoff eksponensial+jitter sesuai rumus resmi; metrik 429; tuas cadangan: ajukan kenaikan kuota, TTL master lebih panjang, pre-warm, beberapa service account.
- **Pencegahan:** spike S1 (beban 20 user) sebelum Fase 1; alarm 429 > 5%/10 mnt; uji beban ulang tiap fase.

### R-03 — Tulis sel-per-sel / tidak atomik  · Tinggi  · [KODE]

- **Reproduksi:** `verifyTax` memanggil `set(...)` 12 kali berurutan, lalu `transitionStatus`, `recordApproval`, `writeAudit`. `updatePengajuanRow_` ±25 `set`. Kalau terputus di tengah (timeout, 429, crash) → baris punya Final Amount baru tapi status lama, atau status `COA Posted` tanpa Sub COA. `executePaymentCore_` menulis payment log **lalu** ringkasan **lalu** status — putus di antaranya = log tercatat tapi `TOTAL_PAID` belum naik. Di Apps Script risikonya kecil karena eksekusi cepat & satu proses; di REST tiap langkah adalah request jaringan terpisah yang bisa gagal sendiri-sendiri.
- **Akar masalah:** model tulis lama mengandalkan eksekusi in-process, tidak dirancang untuk gagal sebagian.
- **Perbaikan:** Unit-of-Work → **satu `spreadsheets.batchUpdate`** berisi semua mutasi (baris + approval + audit + payment log) — atomik **[terverifikasi S2, 2026-10-06, untuk kegagalan validasi — lihat `claude/spike-results.md`; kegagalan transport/timeout tetap butuh idempotency + rekonsiliasi]**; seandainya kelak terbukti tidak atomik: urutan tulis terdefinisi + penanda `PENDING` + job rekonsiliasi.
- **Pencegahan:** fault-injection test (gagalkan request ke-N); rekonsiliasi terjadwal `TOTAL_PAID` vs payment log (sumber kebenaran, I5) dengan alarm.

### R-04 — Pembayaran ganda  · Tinggi  · [KODE]  (juga kelompok B)

- **Reproduksi:** dokumen sisa Rp 10.000.000. Finance menekan "Cairkan pembayaran" Rp 5.000.000, jaringan lambat, klik lagi (atau UI me-retry setelah 429). Dua request terpisah: masing-masing lolos `nominal ≤ sisa + toleransi` karena yang kedua dihitung setelah yang pertama ter-append → hasil: **dua pembayaran 5 jt** (secara sistem sah, tapi secara niat user cuma satu). Pada bulk (`executePaymentBulk`) ID yang sama dua kali dalam list juga diproses dua kali.
- **Akar masalah:** `executePaymentCore_` tidak punya konsep identitas niat/aksi; satu-satunya pengaman adalah batas overpay. Di sistem lama, klik ganda dibatasi lock global + UI yang menonaktifkan tombol (`pySubmit`), tapi tidak ada jaminan server-side.
- **Perbaikan:** `Idempotency-Key` wajib pada pay/pay-bulk/approve/verify/journal (Redis 24 jam); **fingerprint duplikat** `(idTrx, tgl, nominal, ref)` dalam 10 menit → peringatan keras + butuh konfirmasi; tombol dikunci setelah klik; bulk menolak ID duplikat di dalam list.
- **Pencegahan:** test "kirim request yang sama 2×" harus menghasilkan satu pembayaran; test retry setelah 429 buatan.

### R-05 — Zona waktu  · Sedang-Tinggi  · [KODE]

- **Reproduksi:** `fmtDate` memakai `Session.getScriptTimeZone()`; `exportJurnalOdoo` memakai `new Date(tglMulai)` dan `to.setHours(23,59,59)`. Di Vercel (UTC) `new Date("2026-10-31")` = 00:00 UTC = 07:00 WIB, `setHours` bekerja di UTC → transaksi tanggal 31 Oktober malam WIB hilang dari export atau masuk bulan salah; tanggal invoice bisa tampil mundur satu hari.
- **Akar masalah:** perilaku tanggal implisit mengikuti zona skrip di Apps Script, dan zona server di Vercel.
- **Perbaikan:** satu helper `wib()`; semua batas hari dihitung WIB; tanggal bisnis diperlakukan sebagai "tanggal kalender" (string `yyyy-MM-dd`), bukan instant.
- **Pencegahan:** unit test di sekitar 23:30–00:30 WIB dan batas bulan; CI dijalankan dengan `TZ=UTC` *dan* `TZ=Asia/Jakarta`.

### R-06 — Korupsi tipe data Sheets  · Tinggi  · [KODE + TERBUKTI S2 2026-10-06]

- **Reproduksi:** `Repair.gs` (`repairNoRekening`, `auditDataIntegrity` bagian A "NOL DI DEPAN HILANG") membuktikan masalah ini sudah pernah terjadi: nomor rekening yang diketik sebagai angka kehilangan nol awal. Lewat API, `valueInputOption=USER_ENTERED` akan memperlakukan "0123456" sebagai angka; tanggal dibaca sebagai serial number; angka besar bisa berubah notasi; string diawali `=` dieksekusi sebagai formula.
- **Akar masalah:** Sheets menebak tipe saat memasukkan nilai; sistem lama menutupinya dengan apostrof `'` + `setNumberFormat("@")`.
- **Bukti (S2, spreadsheet dummy):** `USER_ENTERED` mengubah `0123456789012→123456789012`, `0012→12`, `1E5→100000`, `=1+1→2`, `'abc→abc`; `RAW`/`stringValue` mengembalikan semuanya persis sebagai teks.
- **Perbaikan:** `RAW` untuk teks (rekening, NPWP, ID, no invoice, no PO), kolom diformat teks, coercer per tipe di schema registry, tanggal sebagai serial yang dikonversi WIB, escape formula untuk teks bebas (design doc 4.5).
- **Pencegahan:** round-trip test (tulis→baca→bandingkan) untuk 50 nilai jebakan (`0012`, `1E5`, `=1+1`, `'abc`, tanggal 29 Feb, Rp 12.345.678,5…); `/admin/health` menjalankan `auditDataIntegrity` terjadwal.

### R-08 — Batas body 4,5 MB  · Tinggi  · [DOK+KODE]

- **Reproduksi:** `siapkanFile` lama mengirim PDF sampai 10 MB; `getInvoiceFileData` mengirim sampai 8 MB lewat `google.script.run`. Di Vercel request/response > 4,5 MB → `413 FUNCTION_PAYLOAD_TOO_LARGE`. Gambar dari kamera dikompres (±150–400 KB) sehingga aman; **PDF invoice besar** tidak.
- **Perbaikan:** batas file 4 MB + pesan jelas, kompres sisi klien; PDF besar: opsi upload resumable langsung ke Drive (S3); stream download (S4) atau pratinjau halaman pertama + unduh.
- **Pencegahan:** tanya/ukur ukuran PDF nyata (O1); test E2E dengan file 3,9 MB dan 4,1 MB; pesan error spesifik, bukan 413 mentah.

### R-09 — Drive: service account & akses user  · Tinggi  · [DOK+KODE]

- **Reproduksi (a):** `uploadToDrive` lama memakai identitas pemilik script (My Drive). Service account di Vercel mencoba `files.create` ke folder My Drive → gagal (service account tak punya storage quota dan tak bisa memiliki file). **Reproduksi (b):** `Approval_Portal.html` merender `<a href="${it.fileUrl}">Berkas</a>` — link Drive mentah; approver tanpa akun Google (justru tujuan D5) tidak bisa membukanya.
- **Perbaikan:** Shared Drive organisasi (Workspace Enterprise) dengan service account sebagai member peran minimum, `supportsAllDrives=true`; semua akses file lewat proxy aplikasi yang memeriksa I13 (design doc 4.6). Konfirmasi tenant: S7.
- **Pencegahan:** E2E "approver tanpa akun Google membuka lampiran"; audit izin Shared Drive berkala; DLP pada folder.

### R-10 — Hobby = non-komersial  · Tinggi  · [DOK]

- **Risiko:** memakai Hobby untuk sistem perusahaan melanggar ToS (dijawab 2026-09-23) → akun bisa ditangguhkan, atau tanpa sengaja data produksi hidup di Hobby.
- **Perbaikan:** trial **hanya** data dummy (D6) + banner lingkungan di UI; variabel `APP_ENV=trial` memblokir koneksi ke ID spreadsheet produksi (daftar-putih ID); checklist upgrade Pro sebagai gerbang Fase 4.
- **Pencegahan:** CI menolak deploy produksi bila `APP_ENV≠prod`; review manual sebelum "Production" diarahkan ke data nyata.

### R-11 — Cron Hobby harian  · Sedang  · [DOK]

- **Reproduksi:** `kirimSemuaDigest` di sistem lama dijalankan beberapa kali sehari (trigger jam). Vercel Hobby menolak jadwal lebih sering dari 1×/hari saat deploy, dan presisinya ±59 menit.
- **Perbaikan:** selama trial pakai GitHub Actions `schedule` atau cron-job.org memanggil `/api/cron/digest` dengan `CRON_SECRET`; di Pro pindah ke Vercel Cron per-menit. Kode route tidak berubah.
- **Pencegahan:** alarm "cron tak jalan > 25 jam"; endpoint idempotent (digest dobel tidak membuat kode baru: `buatKodeApproval_` sudah memakai ulang kode aktif).

### R-12 — Log runtime Hobby 1 jam  · Sedang  · [DOK]

- **Risiko:** insiden yang ketahuan besok paginya tidak punya jejak teknis.
- **Perbaikan:** log drain/Sentry sejak hari pertama; `requestId` di setiap error; Audit_Log tetap catatan bisnis utama.

### R-13 — Batas Hobby lain  · Rendah  · [DOK]

100 deployment/hari, 1 build concurrent, repo GitHub milik **organisasi** tidak bisa disambungkan ke project Hobby (pakai repo personal/CLI untuk trial). Dampak: friksi alur kerja, bukan risiko data.

### R-15 — Webhook WhatsApp  · Tinggi  · [DOK gap]

- **S6 (jawaban vendor 2026-10-07):** format sudah jelas — header `X-Gateway-Signature`, **hex** HMAC-SHA256 atas **raw body saja**, secret = "Webhook Secret" per consumer; **tanpa timestamp, tanpa anti-replay, tanpa retry**, status respons tidak diperiksa; signature hanya di header. Sisa risiko berpindah dari "format tidak diketahui" ke: (1) **replay tanpa batas** (signature valid bisa diputar ulang) → dedup `message.key.id` + batas umur `messageTimestamp` + kode sekali pakai; (2) **pesan hilang diam-diam** bila endpoint gagal (fire-and-forget) → balasan eksplisit ke pengirim, dead-letter + alarm, dashboard/digest sebagai sumber kebenaran, ganti URL webhook di jam sepi saat cutover (R-27); (3) kesalahan implementasi (hitung atas hasil parse, bukan raw string) → uji dengan request asli dari consumer uji + vektor uji unit di `claude/spike-results.md`. Sistem lama (Apps Script) tetap tak bisa membaca header → tetap `?wh=` sampai cutover.
- **Risiko:** (a) algoritma/encoding/timestamp `X-Gateway-Signature` belum terverifikasi (halaman docs butuh PIN; sebelumnya hanya terkonfirmasi header-nya) → implementasi HMAC salah = menolak semua webhook atau menerima semua; (b) HMAC harus dihitung atas **raw body**, bukan hasil parse; (c) gateway bisa mengirim ulang (retry) → aksi ganda; (d) replay pesan lama.
- **Perbaikan:** S6; verifikasi raw body + perbandingan konstan-waktu + fail-closed + dedup `message.key.id` di Redis + `STATUS_FLOW`/kode sekali pakai sebagai lapis kedua; fallback sementara shared-secret query string (seperti sekarang).
- **Pencegahan:** test dengan payload bertanda tangan benar/salah/kadaluarsa/dobel; alarm webhook ditolak berulang.

### R-20 — Scan penuh & skala baca  · Sedang  · [KODE]

`findRowByIdTrx` (TextFinder), `getPOBillingHistory`, `getTotalPaidFromLog`, `getUserDraftsAndHistory`, `getFinanceQueues`, `getHomeContext` semuanya O(n) atas seluruh sheet. Cepat in-process, tetapi di REST = payload besar + kuota. **Perbaikan:** indeks Redis (`id→baris`, `po→dokumen`, `id→total bayar`), baca kolom terbatas, arsip tahunan. **Pencegahan:** metrik ukuran payload & waktu baca per route; budget p95.

### R-22 — Edit manual di Sheet & drift header  · Sedang-Tinggi  · [KODE]

- **Reproduksi:** tim Finance menyisipkan kolom di Trx_Pengajuan, mengubah urutan, men-sort sheet, atau mengganti nama header (di sistem lama: `COL` konstan 1-based tanpa validasi header; `setupDatabase` bahkan menulis ulang header). Di aplikasi baru, tulisan ke "kolom 31" mendarat di kolom yang salah.
- **Perbaikan:** validasi header vs schema registry saat cold start + `/admin/health` → mode read-only + alarm; **proteksi range** (sheet protection) pada tab milik aplikasi, edit manual hanya Admin; akses Sheet hanya service account + admin (2.5); instruksi: kolom baru hanya di kanan.
- **Pencegahan:** test dengan sheet yang headernya sengaja diacak; review akses Sheet berkala (audit log Workspace).

### R-24 — Kredensial service account  · Tinggi  · [ASUMSI+DOK]

- **Risiko:** (a) org policy Enterprise memblokir pembuatan JSON key → pipeline auth tak bisa dibuat sesuai rencana; (b) JSON key bocor (env var terbaca, log, repo) = akses penuh ke Sheet + Shared Drive; (c) key tak dirotasi.
- **Perbaikan:** cek S7; jalur utama = **Workload Identity Federation** (token OIDC Vercel) bila key diblokir; jika key dipakai: peran minimum (Editor di satu Sheet + Content manager di satu Shared Drive, bukan project-wide), env var terenkripsi per lingkungan, rotasi 90 hari, redaksi log, secret scanning di repo. Pisahkan service account trial vs produksi.
- **Pencegahan:** pre-commit secret scan; alarm untuk akses Sheet dari luar IP/pola aplikasi (audit log Workspace).
- **S7 (2026-10-06):** pembuatan key diizinkan; log Workspace hanya disimpan **6 bulan** → tanpa review bulanan/ekspor, jejak akses mentah hilang. DWD (bila email via Gmail API) = kemampuan menyamar sebagai user: pakai service account terpisah dengan scope `gmail.send` saja dan mailbox khusus, bukan service account data.

### R-26 — Redis mati / lock salah  · Sedang-Tinggi  · [ASUMSI + S1 2026-10-06]

- **S5 (2026-10-06):** primitif lock (SET NX PX, release Lua cek token, TTL, INCR) berfungsi di Upstash asli; polling waiter di bawah kontensi ≈ 81 command/aksi (pakai jeda lebih panjang atau gagal cepat).
- **Bukti S1:** latensi panggilan Sheets punya ekor 3–6 dtk (±5% panggilan) dan satu kasus 64 dtk, tanpa 429 — TTL lock 15 dtk terbukti tidak aman sendirian. Usulan: timeout per panggilan + deadline guard sebelum `batchUpdate` + TTL ±30 dtk + baca-ulang berdasar Idempotency-Key setelah timeout tulis (lihat `claude/spike-results.md`). **Sudah diterapkan di design doc 4.3/4.3b (2026-10-06).**

- **Bukti dari Vercel `sin1` (2026-10-06):** lock cycle p50 5 ms, p95 ≤ 22 ms, max 34 ms (3 run × 30); Sheets baca p50 365 / p95 509 ms (n=75), tulis p50 364 ms (n=15), tidak ada panggilan > 1,5 dtk → ekor laptop kemungkinan besar jaringan, bukan Google; tetap dipertahankan timeout & deadline guard karena ekor ≈1% belum terukur. **Vercel berganti instance antar request** (S8) → tidak boleh ada state lock/cache di memori proses; semua di Redis. Rencana: gagal cepat saat kontensi lock pada aksi uang (design doc 4.3, O12).

- **Risiko:** Redis down → tidak ada lock; instance mati menahan lock; lock kedaluwarsa saat fungsi masih menulis (TTL 15 dtk) → dua penulis; clock skew.
- **Perbaikan:** fail-closed untuk tulis uang; token lock + cek kepemilikan sebelum flush; TTL dengan margin dan batas waktu fungsi lebih kecil dari TTL; lock berurutan; health check Redis; opsi `global:write` darurat.
- **Pencegahan:** chaos test (matikan Redis di tengah aksi; tahan lock; paksa kedaluwarsa).

### R-27 — Cutover  · Tinggi  · [KODE]

- **Risiko:** (a) `SEQ_TRD/NTR/VND` di Script Properties vs counter baru → ID ganda; (b) hash password lama (SHA-256 3000×) tidak terbaca → semua orang harus reset; (c) webhook WA masih menunjuk Apps Script; (d) data dummy di trial menyimpang dari produksi; (e) dua sistem menulis ke sheet yang sama bersamaan.
- **Perbaikan:** counter dari `max(sheet)`; verifikasi hash lama + rehash lazy (design doc 5.2); freeze tulis Apps Script sebelum cutover; satu sistem menulis pada satu waktu; rollback terdokumentasi (design doc 10.2); backup penuh sebelum cutover.
- **Pencegahan:** gladi cutover di salinan; checklist go-live; rekonsiliasi sesudah cutover.

### R-07 — Cache basi vs edit manual & keputusan uang  · Sedang  · [ASUMSI]

- **Reproduksi:** Finance mengoreksi nominal / status langsung di Google Sheet (jalur edit manual yang selama ini lazim). Dashboard di app masih menampilkan angka lama dari cache Redis (TTL puluhan detik–menit). Finance lain menekan "Bayar" berdasarkan angka lama.
- **Akar masalah:** cache dipakai untuk baca daftar/dashboard; edit di luar aplikasi tidak melewati invalidasi.
- **Perbaikan:** **aksi uang/status tidak pernah memakai cache** — baca segar di dalam lock (design doc 4.3); cache hanya untuk tampilan dan selalu diberi label "data per HH:MM" + tombol refresh; TTL pendek untuk transaksi, panjang untuk master; opsional `onEdit` Apps Script → `/api/cache/bust` (design doc 2.5); etag/`If-Match` menolak aksi atas data yang sudah berubah.
- **Pencegahan:** test "edit manual lalu aksi → ditolak/dihitung ulang"; kebijakan: edit manual hanya Admin (R-22).

### R-23 / R-25 / R-28 / R-29 / R-33 — Risiko lebih ringan

- **R-23 Latensi region** [ASUMSI]: fungsi Vercel default `iad1` (AS timur) → ke Google/Redis dari Indonesia menambah ratusan ms. Pilih region fungsi terdekat (mis. Singapura) dan Redis di region sama (S5, S8).
- **R-25 Outage** [ASUMSI]: Vercel, Upstash, Google API bisa gangguan; sistem baru menambah 2 dependensi vs Apps Script. Mode read-only dari cache, Apps Script lama tetap read-only sebagai cadangan beberapa minggu, jalur WA approve tetap (berhenti bila app mati — didokumentasikan).
- **R-28 Paritas cetak** [KODE]: `Print_Form.html` memakai `@media print`, `page-break`, `<embed>` PDF. Uji Chrome/Edge/Safari; rencana PDF server-side Fase 3.
- **R-29 Semantik bulk** [KODE]: sistem lama sebagian-berhasil per item (`postJournalBulk`, `executePaymentBulk`). Baru: validasi semua, terapkan yang valid dalam satu batch, laporkan yang gagal per item — **perilaku pelaporan sama**, implementasi atomik. Tulis kontrak ini eksplisit supaya tidak ada yang mengira "semua atau tidak sama sekali".
- **R-33 Upstash free tier** [DOK]: 500K command/bulan; lock+cache+rate-limit bisa mendekati. Pantau; PAYG murah ($0,2/100K).

---

## B. Cacat laten di sistem lama (jangan disalin; sebagian butuh keputusan lo)

### R-17 — Approval Level 4/5 dicatat atas nama pengunggah; CFO gate = centang  · Tinggi  · [KODE]

- **Reproduksi:** di `submitWetSignature`, `recordApproval(..., LEVEL.FINANCE_MGR, "APPROVED", "TTD oleh <nama>", url)` dan (bila CFO wajib) `LEVEL.CFO`. `recordApproval` **tanpa `identityOverride`** mengambil identitas dari `getUserProfile()` = **orang yang sedang login (Finance Staff L3)**. Hasil di `Trx_Approval`: kolom `APPROVER_NAME/EMAIL` = staff yang mengunggah; nama penandatangan hanya ada di kolom `NOTES` sebagai teks bebas yang diketik uploader. Gate `bolehDibayar` hanya mengecek **keberadaan** record L4/L5. Artinya satu Finance Staff yang mencentang "CFO sudah menandatangani" + mengunggah file apa pun (mis. foto kosong) bisa menghasilkan record L5 APPROVED dan membuka pembayaran ≥ Rp 5 jt. Kontrol ini bersandar pada kejujuran uploader — itu **kontrol atestasi**, bukan kontrol teknis.
- **Akar masalah:** TTD basah tidak bisa diverifikasi sistem; identitas approver L4/L5 tidak pernah login.
- **Perbaikan (Fase 2, butuh O4):** e-approve oleh Fin Mgr/CFO sendiri — login, step-up, identitas dari sesi, record atas nama mereka; periode transisi jalur scan tetap ada tapi **identitas pencatat tetap dicatat benar** (“diinput oleh X atas TTD Y”) dan dibatasi (mis. wajib dua orang berbeda: pengunggah ≠ verifikator pajak).
- **Pencegahan:** test "L4/L5 hanya bisa dicatat oleh akun dengan level itu"; laporan audit bulanan dokumen ≥ Rp 5 jt dengan metode WET vs E-SIGN. **Tidak diubah tanpa persetujuan eksplisit lo.**

### R-18 — Approver menyetujui dokumennya sendiri  · Sedang-Tinggi  · [KODE]

- **Reproduksi:** orang X punya baris Master_User_TTD Level 1 *dan* Level 2 pada brand/dept yang sama (kombinasi yang diperbolehkan struktur sheet). X submit pengajuan (`CREATED_BY=X`). X login ke portal approval (atau membalas WA `SETUJU <kode>`): `managerApprove`/`approveViaWA_` hanya memeriksa `hasAuthority(roles, brand, dept, LEVEL.MANAGER)` — **tidak ada pemeriksaan approver ≠ `CREATED_BY`** → lolos. Kebalikan dari I6 (pengaju ≠ verifikator pajak) yang sudah ada untuk Finance.
- **Perbaikan:** aturan "approver ≠ pembuat" di service layer untuk jalur web dan WA; kalau tidak ada manager lain berwenang → dokumen tertahan dengan pesan jelas (atau eskalasi ke manager ALL).
- **Pencegahan:** test dua-peran; `validateStruktur` mendeteksi orang ber-L1+L2 di divisi yang sama dan melaporkannya. **Perubahan perilaku → butuh O5(a).**

### R-19 — Satu Finance memegang seluruh rantai  · Sedang  · [KODE]

- **Reproduksi:** `requireLevel(LEVEL.FINANCE_STAFF)` dipakai di `verifyTax`, `submitWetSignature`, `postJournalBulk`, `executePayment*`, `financeReject`. Satu orang L3 (bukan pengaju) dapat memverifikasi pajak, mengonfirmasi TTD, memposting jurnal, **dan** membayar dokumen yang sama; SoD hanya ada di langkah pajak (I6) dan vendor (I7).
- **Perbaikan:** opsi pemisahan tugas bertahap (pembayar ≠ verifikator pajak; peringatan atau blokir) — keputusan O5(b); minimal tampilkan di audit viewer "satu orang memegang N tahap".
- **Pencegahan:** laporan rutin SoD; kebijakan tertulis bila tim Finance kecil sehingga blokir keras tidak praktis.

### R-21 — `approveVendor`/`rejectVendor` berdasarkan nomor baris  · Tinggi  · [KODE]

- **Reproduksi:** UI vendor pending menyimpan `rowIdx` (`getPendingVendors` → `data-row`). Antara render dan klik, seseorang men-sort/menyisip baris di `Master_Vendor` (atau vendor lain ditambahkan di atas lewat sort). `approveVendor(rowIdx)` membaca `kode`, `nama`, pendaftar **dari baris itu** lalu menulis `"Approved"` tanpa membandingkan dengan yang user lihat → **vendor yang salah (mis. yang rekeningnya belum diperiksa) bisa disahkan**. Selain itu `approveVendor` tidak memeriksa status saat ini = `Pending` (baris `Rejected` bisa "dihidupkan" lagi), dan `rejectVendor` tidak memeriksa pendaftar (aman, arah menolak).
- **Perbaikan:** endpoint berdasarkan **kode vendor** (`/api/vendors/:kode/approve`), cari baris lewat indeks + verifikasi `kode` & `status==Pending` di dalam lock, kirim ringkasan (bank+rekening) yang divalidasi ulang di server.
- **Pencegahan:** test "sort sheet di tengah" ; test approve ulang vendor Rejected → ditolak.

### R-14 — Auth lama: tanpa lockout, oracle enumerasi, hash lemah  · Tinggi  · [KODE]

- **Reproduksi:** (a) `loginApprover` tidak membatasi percobaan → password bisa ditebak tanpa henti; (b) kode mengomentari "sengaja tidak membedakan pesan", tetapi cabang `approver && aktif && !hash` mengembalikan pesan **"Akun ini belum mengatur password…"** vs pesan generik untuk lainnya → penyerang bisa mengetahui nomor mana yang terdaftar & aktif tanpa password; (c) `hashPassword_` = SHA-256 ber-salt diulang 3000× (diakui di komentar: bukan bcrypt/argon2); hash+salt ada di sheet yang dibaca banyak orang.
- **Perbaikan:** rate-limit + lockout per (nomor, IP) di Redis; pesan selalu generik (kasus "belum set password" hanya ditampilkan setelah **link set-password** yang sah); scrypt + migrasi lazy; hash disimpan dengan versi/parameter; sesi revoke saat ganti password/nonaktif (design doc 5.2–5.3).
- **Pencegahan:** test brute-force (6 percobaan → terkunci); test enumerasi (respons & waktu sama untuk nomor ada/tidak ada).

### R-16 — OTP WA/email  · Sedang  · [KODE]

- `otp6_()` dan `kodeAcak4_()` memakai `Math.random` (bukan CSPRNG); OTP disimpan **plaintext** di tab `WA_Pending_Approval` (terbaca siapa pun yang punya akses Sheet) dan aksi tertunda di Script Properties; **tidak ada batas percobaan** OTP; pengiriman OTP lewat `MailApp` (hilang di Vercel). **Perbaikan:** `crypto.randomInt`, simpan hash, TTL & maks 5 percobaan, state di Redis, penyedia email (Resend/SMTP/Gmail API — S7) atau keputusan O8. **Pencegahan:** unit test panjang/distribusi, test percobaan > 5, test kedaluwarsa.
- **Keputusan 2026-10-07 (D9):** tanpa email OTP; approval via WA nominal ≥ Rp 5 jt dimatikan (wajib web + konfirmasi ulang password). Risiko "faktor kedua di saluran yang sama dengan WA" dihindari dengan tidak memakai WA sebagai jalur uang besar. Sisa: kode `Math.random`/plaintext/tanpa batas percobaan tetap diperbaiki di implementasi baru (CSPRNG, hash, TTL, maks 5 percobaan); lockout percobaan password di modal konfirmasi web wajib.

### R-30 — Gateway WA tidak resmi  · Sedang  · [KODE]

`WA_Approval.gs` mem-parse payload gaya **Baileys** (`message.key.remoteJid`, `extendedTextMessage`) — gateway berbasis klien WhatsApp Web **tidak resmi**: ada risiko nomor diblokir WhatsApp, sesi putus (503 "scan QR ulang" sudah ditangani di `kirimWA_`), dan laju kirim massal (digest) bisa memicu pembatasan. **Mitigasi:** batasi laju kirim, jeda antar pesan, jangan kirim di luar jam kerja, siapkan jalur cadangan (approval via web tetap ada — alasan utama jalur web tetap lengkap), pertimbangkan WhatsApp Business API resmi di Pro.

### R-31 — Approval lama tidak dibatalkan setelah revisi  · Rendah-Sedang  · [KODE, perlu uji]

`getApprovalMap` mengumpulkan semua record `APPROVED` per level dan yang terakhir menang; record dari siklus sebelum **Revision Needed** tidak ditandai batal. Karena `STATUS_FLOW` memaksa tiap tahap diulang, jalur biasa aman; yang perlu diuji adalah kasus nominal berubah melewati ambang CFO setelah revisi. **Perbaikan:** ikat approval ke nomor revisi (`REVISION_NO`, kolom baru di kanan) atau tandai record lama `SUPERSEDED` saat kembali ke Revision. **Pencegahan:** test siklus revisi lengkap dengan perubahan nominal lintas ambang.

### R-32 — Audit bisa bolong  · Sedang  · [KODE]

`writeAudit` membungkus `appendRow` dengan `try/catch` yang hanya `console.error` — kalau gagal, transaksi tetap sukses tanpa jejak (I17 tidak terjamin). **Perbaikan:** audit ikut **dalam batch atomik yang sama** (gagal = aksi gagal); `Audit_Log` append-only dengan penomoran urut + (opsional) hash-chain; alarm bila jumlah audit per aksi tidak sesuai. **Pencegahan:** test "aksi sukses ⇒ ada baris audit" (property test).

---

### R-34 — Identitas pengirim WA (`@lid`) & PII di debug log  · Sedang  · [S6 2026-10-07]

- **Status setelah jawaban vendor:** jalur normal tidak membawa `@lid` — gateway menimpa `remoteJid` dengan `<phone>@s.whatsapp.net` bila LID dikenali, atau **menahan webhook** (`skipWebhook`) dan menanyakan nomor telepon lewat bot bila belum. Risiko turun dari Sedang-Tinggi ke Sedang.
- **Risiko tersisa:** (a) **asal pemetaan LID→nomor tidak diketahui.** Bila berasal dari nomor yang **diketik pengguna** tanpa verifikasi, pihak yang berbicara lewat LID bisa mengaku sebagai nomor approver dan webhook yang sampai ke kita sudah bernomor approver → pengikatan kode↔nomor (I14) tampak benar padahal pengirimnya bukan approver (inferensi dari deskripsi vendor, belum terbukti). Perlindungan yang ada: kode `SETUJU <4 digit>` hanya dikirim ke approver lewat digest; untuk ≥ Rp 5 jt WA tidak dipakai sama sekali (D9), jadi dampak pemalsuan nomor via LID dibatasi ke dokumen < Rp 5 jt; (b) sampel webhook mentah dari `WA_WEBHOOK_DEBUG` memuat nomor asli dan `messageSecret` dan tersimpan di `Sys_AuditLog` (potongan 500 karakter) → kebocoran PII ke siapa pun yang bisa membuka sheet.
- **Perbaikan:** tanyakan ke Lixus sumber & verifikasi pemetaan LID, serta apakah payload menandai nomor hasil pemetaan; sampai jelas, **jangan** menjadikan nomor pengirim satu-satunya bukti identitas untuk aksi uang — kode sekali pakai + OTP wajib (sudah di I14); pengirim yang bukan `<digit>@s.whatsapp.net` → ditolak; logger meredaksi nomor & `messageSecret`, tidak menyimpan payload mentah. **Tindakan segera di sistem lama:** matikan `WA_WEBHOOK_DEBUG`, hapus baris sampel dari `Sys_AuditLog`.
- **Pencegahan:** test dengan payload `@lid` dan `@s.whatsapp.net`; test bahwa log tidak memuat nomor penuh; uji `SETUJU` dari nomor approver asli.

## Gerbang keputusan sebelum membangun

| Sebelum… | Wajib ada |
|---|---|
| Fase 1 | Hasil S1, S2, S6 (selesai; sisa pertanyaan pemetaan LID), S7 (selesai untuk desain); jawaban O1–O3, O7–O8 (**terpenuhi 2026-10-07**); daftar kunci lock lengkap per route; race test kerangka |
| Fase 2 | **O4** (e-approve L4/L5) dan **O5** (SoD) — dijawab 2026-10-07 lewat delegasi (ikut rekomendasi: e-approve menggantikan TTD basah; approver L2 ≠ pembuat dokumen; pembayar/verifikator/pengunggah minimal peringatan); **konfirmasi eksplisit final dari user sebelum Fase 2**; idempotency dan batch bayar teruji |
| Fase 3 | Rancangan arsip & kebijakan retensi (O10); proteksi range Sheet terpasang |
| Fase 4 (go-live) | Upgrade **Pro**; gladi cutover; pen-test ringan; rotasi kredensial; backup terjadwal berjalan; alarm aktif |

> Catatan metodologi: risiko B diperoleh dengan membaca kode, bukan mengeksekusinya. Sebelum dianggap "bug terkonfirmasi", tiap item B sebaiknya direproduksi di salinan spreadsheet dummy (Fase 0). Tidak ada kode produksi yang diubah oleh dokumen ini.
