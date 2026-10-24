# Hasil Spike Fase 0 — Migrasi P2P Finance Portal ke Vercel

**Status:** berjalan; Fase 0 selesai, Fase 0b hampir selesai (diperbarui tiap spike selesai) · **Sumber:** output terminal yang ditempel user (script: `claude/spike-kit-fase0.md`, kode: `claude/spike-kit-source.md`). File `results/*.json` asli ada di mesin user, belum dikirim.
Semua hasil di bawah diukur terhadap **spreadsheet salinan DUMMY** ("P2P DUMMY – SPIKE") dan service account `p2p-spike` di project GCP `p2p-spike`. Ini hasil **nyata** (bukan mock).

## Ringkasan

| Spike | Tanggal | Hasil | Dampak ke desain |
|---|---|---|---|
| S0 (koneksi) | 2026-10-06 | LOLOS 3/3 | Auth JSON key ke Sheets berjalan |
| S2 (atomisitas + tipe data) | 2026-10-06 | LOLOS 18/18 | Desain "satu `batchUpdate` per aksi" sah; RAW/`stringValue` wajib |
| S7 (sebagian) | 2026-10-06 | Key diizinkan; Shared Drive aktif + upload/download LOLOS; audit log, delegasi, email OTP belum | Jalur auth utama = JSON key (WIF cadangan); lampiran lewat Shared Drive |
| S1 (kuota) | 2026-10-06 | SELESAI. Beban target lolos (0× 429); beban 10× kena 429 (baca tanpa cache; tulis dengan cache) | Cache dibutuhkan untuk latensi (bukan kuota); ekor lambat sampai 64 dtk → TTL lock & timeout per panggilan harus didesain ulang |
| S2b (race PO) | 2026-10-06 | LOLOS 4/4 | R-02 TERBUKTI nyata; lock Redis memperbaikinya |
| S5 (Redis) | 2026-10-06 | 8 PASS, 1 FAIL (ambang p95 lock 300 ms, terlampaui 30 ms) | Semua primitif lock berfungsi di Upstash; latensi dari laptop OK |
| S5/S1 dari Vercel (`sin1`) | 2026-10-06 | SELESAI (sampel kecil). Redis lock p50 5 ms; Sheets baca p50 365 / p95 509 ms, tulis p50 364 ms; 0× 429 | Aksi tulis ±0,8 dtk; ekor lambat laptop bukan dari Google; angka dipakai menggantikan asumsi 1,5–3 dtk |
| S4 (stream/body) | 2026-10-06 | LOLOS: stream sintetis 50 MB utuh; POST 3 MB lolos, 6 MB → 413; file Drive 14 MB & 2 MB via fungsi utuh. Latensi awal Drive 1–6 dtk (bervariasi) | Respons besar boleh di-stream lewat fungsi; upload besar WAJIB langsung ke Drive; lampiran = fitur asinkron + cache |
| S3 (upload langsung) | 2026-10-06 | LOLOS: 12 MB dan 30 MB, ukuran persis, CORS OK | Jalur sesi resumable server → PUT browser → Drive layak |
| S8 (cold start) | 2026-10-06 | PARSIAL: cold setelah idle ±30 mnt = 783 ms total di browser vs warm 142 ms; ukuran bundle belum | Cold start ±0,6 dtk, tidak jadi masalah |
| S6 (webhook Lixus) | 2026-10-07 | SELESAI (jawaban vendor): hex HMAC-SHA256 atas raw body, header saja; tanpa timestamp & retry; `@lid` di-resolve gateway | Verifier tetap & sederhana; wajib dedup + cek umur pesan (tidak ada anti-replay dari gateway); pesan hilang bila endpoint gagal (fire-and-forget) → penanganan sendiri; pertanyaan lanjutan soal asal pemetaan LID |

## S0 — Koneksi (LOLOS)
- Service account membaca spreadsheet dummy; pengaman judul (`DUMMY`/`SPIKE`) bekerja.
- Spreadsheet salinan berisi **13 tab** sebelum tab uji ditambah (tab produksi ikut tersalin; user diingatkan untuk mengosongkan/anonimkan datanya).
- Empat tab uji dibuat: `Spike_Read`, `Spike_Write`, `Spike_Audit`, `Spike_Race`.
- Uji Drive **dilewati** (`SPIKE_DRIVE_FOLDER_ID` kosong).
- Kendala yang ditemui user (bukan bug kit, tapi masuk README sebagai jebakan umum): (1) ekstensi tersembunyi di Windows → file jadi `sa-key.json.json`; (2) `SPIKE_SHEET_ID` masih berisi ID contoh → 404 "Requested entity was not found".

## S7 — hasil parsial
- **Pembuatan service account key diizinkan** di organisasi user (key berhasil dibuat 2026-10-06; tidak ada pemblokiran org policy). Jalur auth utama aplikasi = JSON key di env var terenkripsi; Workload Identity Federation tetap opsi cadangan/hardening (design doc 5.7, R-24).
- Key yang dibuat tidak punya expiry (1 Jan 10000) → wajib rotasi manual (kebijakan 90 hari di R-24) dan hapus key trial setelah spike.
- (Diperbarui di bawah, bagian "S7 — audit log & email OTP".)

## S7 — Audit log & email OTP (2026-10-06; diperbarui 2026-10-07)
> **Keputusan user 2026-10-07 (D9):** tanpa email OTP (super admin lambat merespons); approval via WA ≥ Rp 5 jt dimatikan, wajib web + konfirmasi password. Maka opsi A/B di bawah dan item checklist 2–5 **tidak diperlukan sekarang** (disimpan sebagai referensi bila email dibutuhkan kelak). Yang tersisa non-blocking: item 1–2 (audit log Drive & ekspor) bila ada akses admin.
Sumber: dokumentasi resmi Google (dibaca langsung; WebSearch tidak aktif di sesi ini). Yang **tidak bisa** diverifikasi dari luar: konfigurasi tenant user (menu Admin console, kebijakan org) → checklist manual di bawah.

**Terverifikasi dari dokumentasi Google:**
- Retensi log Workspace: **Drive log events, Admin, Login/User, Token = 6 bulan** (halaman "Data retention and lag times"; tidak ada perbedaan per edisi yang tertulis di halaman itu). Konsekuensi: review audit Google **minimal tiap bulan** dan, bila audit eksternal butuh > 6 bulan, **ekspor berkala** — opsi ekspor/BigQuery perlu dicek di tenant (belum diverifikasi).
- **Domain-wide delegation (DWD):** hanya **super admin**; Admin console → Security → Access and data control → API controls → Manage Domain Wide Delegation → Add new (Client ID service account + scope). Propagasi beberapa menit s.d. 24 jam. Service account menyamar sebagai user lewat klaim `sub`; hanya bisa mengakses apa yang user itu boleh akses.
- Dokumentasi Gmail API `messages.send` tidak memuat batas kirim harian atau panduan service account (halaman terpisah; batas kirim Workspace **belum diverifikasi** — cek sebelum dipakai).

**Opsi pengirim OTP email (untuk O8):**
| Opsi | Kelebihan | Kekurangan / yang harus dicek |
|---|---|---|
| A. **Gmail API + DWD** dari mailbox khusus (mis. `no-reply@<domain>`) | Tanpa vendor baru; domain & SPF/DKIM sudah di Workspace; log pengiriman di Workspace | Perlu super admin menyetujui DWD; **pakai service account TERPISAH** hanya dengan scope `gmail.send` (jangan memberi DWD ke service account data Sheets/Drive); batas kirim harian harus dicek; kunci tambahan yang harus dijaga |
| B. **Penyedia email transaksional** (mis. Resend atau SMTP) | Setup cepat, tanpa DWD | Vendor baru + DNS record (SPF/DKIM) di domain; kuota/harga free tier **belum diverifikasi**; data (alamat email approver) keluar ke pihak ketiga |
| C. OTP lewat WA yang sama (tanpa email) | Paling sederhana | Bukan faktor terpisah (kompromi WA = kompromi OTP) — keputusan O8 |
Volume OTP kecil (hanya approval ≥ Rp 5 jt; kira-kira puluhan–ratusan/bulan) → batas kirim bukan kendala pada opsi apa pun. Rekomendasi: **A** bila super admin setuju, **B** sebagai cadangan; **C** hanya bila O8 diputuskan "WA cukup".

**Checklist manual untuk user (butuh akses admin) — tulis jawabannya ke project:**
1. Admin console → Reporting → **Audit and investigation → Drive log events**: menu ada? Buka spreadsheet dummy atau unduh file uji lewat halaman uji Vercel, lalu cari event-nya (actor = email service account `p2p-spike@...`). Lag beberapa menit. Apakah event **edit/view spreadsheet** muncul (file-level)? (Perubahan per sel hanya lewat version history Sheets.)
2. Reporting → **Data integrations** / ekspor log (BigQuery): tersedia di edisi tenant?
3. Security → Access and data control → **API controls → Domain-wide delegation**: halaman bisa dibuka? Siapa super admin yang bisa menyetujui?
4. Boleh dibuat **mailbox khusus no-reply** (mis. `no-reply@<domain>`) dan dikirim via API? Domain sudah punya SPF/DKIM/DMARC aktif?
5. Kebijakan perusahaan soal vendor email transaksional (opsi B)?

## S2 — Atomisitas & tipe data (LOLOS 18/18)

**A. `values.batchUpdate` (satu range valid + satu invalid)**
- Tab tidak ada → 400 `Invalid data[1]: Unable to parse range`; range valid TIDAK tertulis (atomik).
- Di luar batas grid → 400 `Range (...) exceeds grid limits`; range valid TIDAK tertulis (atomik).
- (Catatan tampilan: pesan "Max rows: 100" di output terpotong oleh script pada 80 karakter; tab dibuat dengan 1000 baris.)

**B. `spreadsheets.batchUpdate` lintas tab (updateCells + appendCells + request ke-3 invalid)**
- Ditolak 400 `Invalid requests[2].updateCells: No grid with id: 999999`; **tidak ada** request ke-1/ke-2 yang tertulis (atomik).

**C. Kontrol positif** — batch valid lintas dua tab tertulis keduanya.

**D. 20 `values.append` paralel** ke `Spike_Audit` → 20 baris unik, tidak saling timpa, tidak ada yang ditolak.

**E. Tipe data** — dengan `valueInputOption=RAW` dan `userEnteredValue.stringValue`, ketujuh jebakan kembali persis sebagai string: `0123456789012`, `0012`, `1E5`, `=1+1`, `'abc`, `29/02/2026`, `12345678.5`.
Pembanding `USER_ENTERED` (BUKTI R-06):
`0123456789012 → 123456789012` · `0012 → 12` · `1E5 → 100000` · `=1+1 → 2` · `'abc → abc` · `12345678.5 → 12345678.5`.

### Yang S2 membuktikan — dan yang BELUM
- **Terbukti:** request multi-mutasi yang **gagal validasi** ditolak utuh. Itu sesuai desain UoW (design doc 4.3): validasi di sisi server Google terjadi sebelum ada yang diterapkan.
- **Belum terbukti:** perilaku saat kegagalan **di luar validasi** — timeout jaringan, 5xx, atau fungsi Vercel mati setelah request terkirim. Di kasus itu klien **tidak tahu** apakah batch diterapkan. Karena itu tetap wajib: `Idempotency-Key` + pemeriksaan "sudah diterapkan?" (baca ulang baris/log dengan kunci aksi) sebelum retry, dan rekonsiliasi terjadwal `TOTAL_PAID` vs Payment_Log (R-03, R-04). Tidak ada perubahan desain; hanya penegasan.
- `values.append` mencari "tabel" untuk menaruh baris baru; di tab dengan **baris kosong di tengah data** hasilnya bisa tidak terduga. Aturan: tab Audit/Payment_Log tidak boleh punya baris kosong di area data; lebih aman memakai `appendCells` di dalam `batchUpdate` (ditambah ke 4.5 bila diperlukan). Uji D hanya memakai tab bersih.
- Pesan error Google dipakai script hanya untuk tampilan; aplikasi harus membedakan 400 (validasi), 429 (kuota), 5xx (transient) lewat status code, bukan teks.

### Keputusan yang terdampak
- **R-03** (tulis tidak atomik): turun dari "perlu verifikasi" ke **terverifikasi untuk skenario validasi**; desain kompensasi (penanda `PENDING`) tidak diperlukan, rekonsiliasi + idempotency tetap.
- **R-06** (korupsi tipe data): **terbukti nyata** dengan USER_ENTERED; aturan "RAW/stringValue untuk semua teks" dikunci. Data lama yang memakai apostrof `'` (hack Apps Script) aman dibaca (bukan bagian uji ini; uji dengan data nyata di Fase 1).
- **ADR-001:** tidak ada perubahan keputusan; asumsi "batchUpdate atomik" berubah dari asumsi → terbukti (skenario validasi).

### S0/S7 — Drive & Shared Drive (2026-10-06)
- **R-09 terbukti nyata:** folder biasa di My Drive yang di-share ke service account → tes mendeteksi "bukan Shared Drive" dan upload ditolak `403 Service Accounts do not have storage quota`.
- **Setelah memakai Shared Drive** (`P2P DUMMY Files` → folder `upload-test`, service account sebagai Content manager): 7/7 PASS — folder terbaca, berada di Shared Drive (`driveId` terisi), boleh menambah file, **upload** file uji sukses, **download** (jalur proxy aplikasi) sukses, file uji bisa di-trash.
- Artinya di tenant user: **Shared Drive aktif dan boleh dibuat**, service account key diizinkan, dan pola "lampiran di Shared Drive, diakses lewat proxy aplikasi" (design doc 4.6) layak. Domain-wide delegation tidak diperlukan untuk lampiran.
- **S7 masih terbuka:** audit log Drive/Sheets (ketersediaan & retensi), domain-wide delegation (hanya perlu bila email OTP lewat Gmail API), penyedia email OTP (O8).

## S1 — Kuota Sheets API (4 variasi, 20 user virtual, 120 dtk)
Dijalankan dari laptop user (WSL Ubuntu), BUKAN dari fungsi Vercel — latensi belum representatif untuk produksi.

| # | Skenario | Puncak baca/mnt | Puncak tulis/mnt | 429 | Aksi gagal | Latensi aksi user (p50 / p95 / p99) | Latensi per panggilan (p50 / p95 / max) |
|---|---|---|---|---|---|---|---|
| 1a-c | target: think 10–30 dtk, cache 30 dtk (3 run, run ke-3 dengan warm-up) | 19–26 | 6–16 | 0 | 0 | 0 / 1226–1368 / 2800–9288 ms | ±505 / 1611–4453 / 5760–17672 ms |
| 2 | **tanpa cache**, think 10–30 | **54** | 8 | 0 | 0 | 550 / **4235** / 5279 ms | 539 / 4235 / 5582 (baca) ; tulis p95 4783 |
| 3 | **padat** think 5–15, cache 30 dtk | 41 | 30 | 0 | 0 | 0 / 1322 / 5031 ms | 502 / 1851 / 4762 |
| 4 | tanpa cache, **tanpa retry** | 53 | 14 | 0 | 0 | 547 / 4711 / 10026 ms | 530 / 4294 / **64472** (satu baca) |

**Kuota — hasil:**
- **Tidak pernah kena 429** di keempat variasi, termasuk tanpa cache dan tanpa retry. Puncak baca tanpa cache 54/60: lolos, tapi **margin hanya ±10%**. Dengan cache puncak baca 19–41/60.
- Koreksi: ekspektasi awal ("tanpa cache hampir pasti 429") **tidak terbukti** di beban ini (rata-rata ±60 aksi/menit). Cache tetap dibutuhkan, tetapi alasannya **latensi + ruang gerak**, bukan sekadar menghindari 429.
- **Backoff belum pernah teruji hidup** (tidak ada 429 untuk dipicu). Perlu satu uji beban lebih berat untuk menemukan titik patah dan membuktikan retry bekerja.
- Ukuran: puncak tulis 30/60 pada beban padat (2 panggilan tulis per aksi di script; desain target = 1 `batchUpdate` per aksi → lebih rendah).

**Latensi — hasil:**
- Median stabil **±0,5 dtk per panggilan** (baca dan tulis sama).
- **Ekor lambat nyata dan tidak terkait kuota** (0 kali 429): ±5% panggilan 3–6 dtk, baca maupun tulis, dan satu panggilan baca **64,5 dtk** (run 4, berhasil tanpa error). Warm-up pertama pernah 6,7 dtk (run 3). Warm-up mengurangi tapi tidak menghilangkan ekor; dugaan lonjakan koneksi awal (run 1–2) tidak cukup menjelaskan semuanya.
- Tanpa cache: p95 aksi user 4,2–4,7 dtk (gagal batas 2 dtk). Dengan cache: p95 1,3 dtk (lolos).
- Penyebab ekor (jaringan WSL/ISP user, front-end Google, atau lainnya) **belum diketahui**; hanya bisa dibedakan dengan mengukur dari fungsi Vercel (Fase 0b).
- Perkiraan kasar (asumsi ±5% panggilan lambat, independen): aksi tulis = ≥3 panggilan berurutan → ±14% aksi tulis terkena sedikitnya satu panggilan lambat.

**Dampak desain (usulan, BELUM diterapkan; keputusan setelah S5 + Fase 0b):**
1. **TTL lock 15 dtk tidak cukup** terhadap ekor 5–64 dtk. Tidak ada TTL tetap yang aman terhadap panggilan 64 dtk; solusi harus berupa **batas waktu**, bukan TTL besar saja:
   - timeout keras per panggilan Sheets (mis. 8–10 dtk, `AbortSignal`);
   - **deadline guard** di critical section: sebelum `batchUpdate`, cek `elapsed < TTL − margin`; kalau lewat → batalkan tanpa menulis;
   - TTL lock ±30 dtk;
   - timeout pada **tulis** menimbulkan hasil ambigu (mungkin sudah diterapkan) → wajib baca-ulang berdasar `Idempotency-Key`/ID aksi sebelum retry, dan rekonsiliasi (R-03/R-04).
2. **Cache untuk semua jalur baca** (dashboard/antrean/detail) — wajib demi latensi; invalidasi saat tulis.
3. UI: status "memproses" yang jujur, tombol terkunci, tidak ada asumsi aksi tulis < 2 dtk.
4. Kuota: tetap pakai cache + 1 `batchUpdate` per aksi; ajukan kenaikan kuota hanya jika uji patah (di bawah) menunjukkan margin sempit.
5. ADR-001 tidak berubah; ambang "revisit Postgres" (design doc 11) perlu diisi angka latensi dari Vercel.

### S1 — Uji patah (60 user, think 3–8 dtk ≈ 650 aksi/mnt, TANPA cache, retry aktif)
Sengaja ±10× beban target untuk menemukan titik patah dan menguji backoff. Dijalankan dari laptop user.

| Metrik | Hasil |
|---|---|
| Percobaan baca/mnt (menit 1, 2) | 437, 384 (batas resmi 60/mnt/user) |
| Kena 429 | **629 dari 888 percobaan (70,8%)** |
| Aksi sukses / gagal | 239 / **20 (±7,7%)** setelah 6× retry |
| Latensi aksi user p50 / p95 / p99 | 2,4 dtk / **57,8 dtk** / 60,3 dtk |
| Latensi panggilan baca (yang berhasil) | p50 762 ms, p95 7,8 dtk, maks 41,9 dtk |
| Latensi tulis | p50 487 ms, p95 3,1 dtk, maks 5,5 dtk (tulis relatif tidak terdampak) |

- **Pesan 429 asli:** `Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com'` → membenarkan kuota 60 baca/mnt/user terhitung per **project/service account**.
- **Backoff bekerja tetapi tidak menyelamatkan beban 10×:** 92% aksi akhirnya sukses, tetapi dengan p95 ±58 dtk dan 8% gagal. ≈3,4 percobaan per aksi → **retry memperbesar beban** (retry storm).
- Baca yang berhasil ±108 dan ±88 per menit-skrip: konsisten dengan batas 60/mnt yang dievaluasi per menit jam (jendela Google tidak sejajar dengan menit-skrip → dua jendela per bucket). Bukan bukti kuota > 60.
- **Titik patah tanpa cache ≈ 60–65 aksi/menit** (run 2: 54 baca/mnt aman; run ini jauh lewat). Dengan cache hit-rate ±60% titik patah kira-kira ×2,5 (≈150 aksi/mnt) — **perkiraan**, belum diuji. Uji lanjutan yang disarankan: sama dengan `--cache-ttl=30`.

**Dampak desain tambahan (usulan, BELUM diterapkan):**
1. **Stale-if-error / stale-while-revalidate** untuk semua baca tampilan: saat 429/timeout, sajikan cache lama (label "data per HH:MM") + refresh di latar belakang. Menghilangkan kegagalan baca di dashboard saat kuota habis. Aksi tulis/uang tetap baca segar (tidak boleh stale).
2. **Pembatas laju global** (token bucket di Redis, mis. ≈45 baca/mnt & ≈45 tulis/mnt per service account) + **antrean** alih-alih tiap request retry sendiri; coalescing (single-flight) pada cache miss.
3. **Retry budget kecil** (≤2 retry atau ≤5 dtk) lalu gagal cepat dengan pesan "sistem sibuk, coba lagi" — jangan membiarkan user menunggu 60 dtk.
4. **Tuas skala:** beberapa service account (kuota per user → ×N, batas 300/mnt/project), TTL cache lebih panjang untuk master, ajukan kenaikan kuota di Cloud Console (tidak dijamin). Tidak wajib di ≤20 user.
5. Alarm: 429 > 5% dalam 10 menit; laju baca > 45/mnt.


### S1 — Uji patah DENGAN cache (60 user, think 3–8 dtk, cache 30 dtk)
| Metrik | Tanpa cache (run 5) | Dengan cache 30 dtk (run 6) |
|---|---|---|
| Hit-rate cache | – | 71% |
| Percobaan baca/mnt (menit 1, 2) | 437, 384 | 189, 244 |
| Percobaan tulis/mnt (menit 1, 2) | 22, 18 | **147, 111** |
| Kena 429 | 70,8% | 56,8% (**termasuk 429 tulis**) |
| Aksi sukses / gagal | 239 / 20 | **765 / 1** (gagal = tulis kena 429) |
| Latensi aksi p50 / p95 / p99 | 2,4 / 57,8 / 60,3 dtk | 0 / 37,2 / 57,0 dtk |
| Latensi baca maks / tulis maks | 41,9 / 5,5 dtk | 16,5 / 19,8 dtk |

- **Cache menyelamatkan baca:** jumlah aksi sukses 3× lebih banyak (765 vs 239) pada beban sama dengan hanya 1 kegagalan. Tetapi p95 tetap 37 dtk karena antrean retry di sisa panggilan yang kena 429.
- **Hambatan bergeser ke TULIS.** Pesan: `Write requests per minute per user` → kuota tulis **terpisah** (60/mnt/user) dan **tidak tertolong cache**. Penyebab: script memakai campuran 10% aksi tulis × 2 panggilan tulis per aksi pada ±650 aksi/mnt ≈ 130 tulis/mnt — jauh lebih tulis-berat daripada beban nyata (600 pengajuan/bulan ≈ puncak beberapa tulis/mnt). Desain target = 1 `batchUpdate` per aksi (bulk 30 baris = 1 panggilan tulis) sehingga ≈ setengahnya.
- **Kesimpulan S1 (final):** untuk ≤20 user bersamaan (beban target) kuota **aman dengan cache** (puncak baca 19–41/60, tulis ≤30/60, 0× 429). Pada beban 10× kuota tertabrak, sistem tetap melayani 99,9% aksi dengan cache tetapi lambat (p95 37 dtk) → perlu pembatas laju + stale-if-error + retry budget kecil (di atas) supaya degradasi tidak dirasakan sebagai "menggantung". Tuas skala (multi service account, kenaikan kuota) belum diperlukan di O1 saat ini; tinjau ulang bila user aktif bersamaan > ±40.
- **S1 dianggap SELESAI.** Sisa pekerjaan terkait diukur di Fase 0b dari fungsi Vercel (latensi, ekor lambat).

## S6 — Webhook gateway Lixus (SELESAI, jawaban vendor 2026-10-07)
Sumber: penelusuran spec OpenAPI + sampel webhook asli (2026-10-06), lalu **jawaban langsung dari pembuat gateway (tim Lixus/"Antigravity") 2026-10-07**. Ini keterangan vendor atas kodenya, **belum diuji sendiri** dengan request bertanda tangan asli — diuji pada kalibrasi Fase 1 (di bawah). Sampel mentah **tidak** disalin ke dokumen ini (memuat nomor asli & `messageSecret`).

| Pertanyaan | Jawaban |
|---|---|
| Header, algoritma | `X-Gateway-Signature`, **HMAC-SHA256** |
| Encoding | **hex** (bukan base64): `crypto.createHmac('sha256', consumer.webhookSecret).update(body).digest('hex')` |
| Yang ditandatangani | **raw body JSON saja** (string payload mentah). Tidak ada gabungan timestamp (`${timestamp}.${body}`) |
| Timestamp webhook / toleransi | **Tidak ada** header timestamp dan **tidak ada proteksi replay** dari gateway. Body `message.received` memuat `timestamp`/`messageTimestamp` (epoch detik) = waktu pesan WhatsApp, bukan waktu pengiriman webhook; event lain (`session.status`, `presence.update`) tanpa timestamp |
| Retry / timeout / redirect | **Tidak ada retry** (fire-and-forget; `fetch()` langsung tanpa antrean/backoff). Tidak ada `AbortSignal.timeout` eksplisit. Error hanya di-`console.error` lalu diabaikan. `fetch` default `redirect: 'follow'` (302 diikuti). **Status HTTP respons tidak diperiksa** (3xx/4xx/5xx tidak memicu error/retry) |
| Signature lewat query/body | **Tidak bisa**; hanya header `X-Gateway-Signature: <hex>` (+ `Content-Type: application/json`) |
| Pengirim `@lid` | Tidak ada field nomor alternatif. LID **dikenali** → gateway menimpa `remoteJid` jadi `<phone>@s.whatsapp.net` sebelum kirim. LID **belum dikenali** → `skipWebhook = true` + bot auto-reply menanyakan nomor telepon; **webhook tidak dikirim** sampai pemetaan didapat. Bila payload `@lid` terkirim, isinya string `@lid` murni tanpa field tambahan |
| Secret | Ops Panel → API Consumers → "Webhook Secret" per consumer (kini terkonfirmasi dipakai untuk HMAC); sistem lama tidak memakainya (memakai `WA_WEBHOOK_TOKEN` di query `?wh=`) |
| Id unik | `message.key.id` (stabil) |

**Dampak desain (diterapkan di design doc 5.5 / 9.2 / R-15 / R-34):**
1. **Verifier tetap & sederhana:** baca `await req.text()` (raw body) → hitung HMAC-SHA256 hex dengan `WA_WEBHOOK_SECRET` → bandingkan dengan `timingSafeEqual` (cek panjang sama dulu) → baru `JSON.parse`. Fail-closed bila header tidak ada/salah. Tidak perlu mode kalibrasi; cukup satu uji dengan request asli dari consumer uji.
   Vektor uji unit (dihitung dengan Node): secret `test-secret`, body `{"event":"message.received","sessionId":"s1"}` → `95a77c64bdd40c82cc3a336360457a80872bd1e4dca6b2178db5990cfec4a8e2`.
2. **Karena gateway tidak punya anti-replay**, signature yang valid dapat diputar ulang tanpa batas. Pertahanan di sisi kita: (a) dedup `message.key.id` di Redis (TTL ≥ 7 hari); (b) **tolak pesan yang `messageTimestamp`-nya terlalu tua** (mis. > 10 menit untuk perintah `SETUJU/TOLAK`; timestamp ada di body yang ikut ditandatangani, jadi tidak bisa dipalsukan terpisah); (c) kode `SETUJU/TOLAK` sekali pakai + TTL (I14) dan OTP untuk ≥ Rp 5 jt tetap lapis berikutnya.
3. **Fire-and-forget = pesan hilang tanpa jejak** bila endpoint kita lambat/mati/redirect/Redis down (gateway tidak peduli status). Konsekuensi: (a) endpoint harus membalas 200 cepat dan memproses dalam anggaran waktu; (b) setiap perintah WA **selalu dibalas** ke pengirim ("diterima/ditolak/gagal, coba lagi") sebagai satu-satunya umpan balik; approver yang tak dapat balasan mengulang; (c) catat pesan yang gagal diproses ke dead-letter di Redis + alarm; (d) **cutover**: ganti URL webhook di jam sepi dan beri tahu approver bahwa pesan di jendela itu mungkin tidak tercatat; (e) dokumen tidak pernah berubah status hanya karena **tidak ada** webhook (dashboard & digest tetap sumber kebenaran).
4. **`@lid`:** gateway menyelesaikan atau menahan webhook, jadi jalur normal tidak pernah membawa `@lid`. Aturan tetap fail-closed: **pengirim yang bukan `<digit>@s.whatsapp.net` ditolak**.
5. **Pertanyaan lanjutan ke Lixus (penting untuk keamanan I14):** bagaimana pemetaan LID→nomor dibentuk? Bila dari **jawaban yang diketik pengguna** (bot menanyakan nomor telepon) dan tidak diverifikasi, maka orang yang berbicara lewat LID bisa menyatakan nomor approver dan gateway akan menimpa `remoteJid` dengan nomor itu → pengirim palsu tampak sebagai nomor approver. (Ini **inferensi dari deskripsi** vendor, belum terbukti.) Yang melindungi: kode `SETUJU <4 digit>` hanya diketahui penerima digest, plus OTP ≥ Rp 5 jt. Tapi pengikatan kode↔nomor tidak boleh dianggap bukti identitas. Minta Lixus menjelaskan: sumber pemetaan, apakah diverifikasi (mis. via metadata WhatsApp/kode balasan), dan apakah ada flag di payload yang menandai "nomor hasil pemetaan".
6. **Uji internal yang tersisa:** (a) request bertanda tangan asli dari consumer uji ke endpoint dummy untuk memastikan header, hex, dan raw body cocok persis (kasus whitespace/urutan key: HMAC dihitung atas string yang dikirim, jangan parse ulang); (b) balasan `SETUJU` dari nomor approver asli — apakah `remoteJid` sudah berformat nomor.
7. **Tindakan keamanan di sistem lama:** matikan `WA_WEBHOOK_DEBUG`, hapus baris sampel dari `Sys_AuditLog`.

## S2b — Race plafon PO, Sheets + Upstash asli (LOLOS 4/4)
Skenario: PO Rp 100 jt, plafon penagihan 90%, sudah ditagih Rp 80 jt, 20 pengaju bersamaan masing-masing Rp 1 jt (benar: tepat 10 diterima).

| | Diterima | Ditolak | Total | Kelebihan | Durasi |
|---|---|---|---|---|---|
| **Tanpa lock** | 18 | 2 | Rp 98.000.000 | **Rp 8.000.000** | 9,8 dtk |
| **Dengan lock Redis** (`po:PO-SPIKE-001`) | **10** | 10 | **Rp 90.000.000** | **0** | 16,3 dtk |

- **R-02 terbukti nyata di Sheets asli:** tanpa lock, plafon PO bocor Rp 8 jt (18 diterima padahal seharusnya 10). Ini membenarkan keputusan memakai lock per-sumber-daya.
- **Lock memperbaikinya:** tepat 10 diterima, total persis plafon, 0 error, 0× 429.
- **Throughput di bawah lock:** ±0,8 dtk per aksi (baca segar + append) → ±1,2 aksi/dtk **per PO**; pengaju terakhir menunggu 16 dtk. Kontensi pada satu PO oleh 20 orang sekaligus tidak realistis; tetap perlu perilaku jelas: untuk aksi uang, lebih baik **gagal cepat** dengan pesan "sedang diproses pengguna lain, coba lagi" daripada menunggu panjang.
- **Biaya Redis di bawah kontensi:** 1.617 command untuk 20 aksi ≈ **81 command/aksi** (waiter polling tiap ±80 ms). Tanpa kontensi ≈ 2–5/aksi. Usulan: polling dengan jeda lebih panjang + jitter, atau gagal cepat; tidak masalah di volume nyata (free tier 500K command/bulan), tapi jangan polling agresif.

## S5 — Upstash Redis (8 PASS, 1 FAIL)
Region Singapore (pilihan user); diukur dari laptop user (WSL).
- Latensi: PING p50 33 ms / p95 540 ms; SET+GET p50 71 / p95 92 ms; **satu siklus lock (acquire+release) p50 73 ms / p95 330 ms**. Itu tambahan per aksi tulis, kecil dibanding panggilan Sheets (±500 ms).
- **FAIL satu-satunya:** ambang "p95 siklus lock < 300 ms" (angka buatan gw, bukan persyaratan desain) terlampaui 30 ms (330 ms). Tidak memblokir: median 73 ms dan ekor wajar untuk jaringan user. Ambang diukur ulang dari fungsi Vercel di Fase 0b.
- **Primitif terbukti di Upstash asli:** `SET NX PX` (50 acquire bersamaan → tepat 1 pemenang), release Lua dengan cek token (token salah → 0, token benar → 1), TTL kedaluwarsa otomatis, token lama tidak bisa melepas lock baru, `INCR` paralel 100× → 100 nilai unik 1..100 (generator ID aman). Ini menutup asumsi "SET NX PX/EVAL didukung Upstash" yang sebelumnya tidak terverifikasi.
- Pemakaian command di script ini: 309 (s5) dan 1.617 (s2b) dari free tier 500K/bulan.

## Fase 0b — dari fungsi Vercel Hobby, region `sin1` (2026-10-06)
Kit: `claude/spike-kit-0b.md` (Next.js, Node 24 di Vercel). Project dummy `p2p-spike-0b`, Deployment Protection aktif (hanya akun Vercel pemilik). Sumber: file JSON hasil yang diunduh user dari halaman uji (data mentah ada di mesin user).

### S5 & S1 dari Vercel (latensi)
| | Laptop (WSL) | Vercel `sin1` |
|---|---|---|
| Redis ping p50 | 33 ms | 2 ms |
| Siklus lock p50 / p95 | 73 / 330 ms | **5 ms / 6–22 ms** (max 34) |
| Sheets baca (n=75, 5 run) | p50 ±500 ms, ekor 3–6 dtk (±5%), maks 64,5 dtk | p50 **365**, p90 430, p95 **509**, maks 1.438 ms; 2 dari 75 > 1 dtk |
| Sheets tulis/append (n=15) | belum dipisah | p50 **364**, maks 1.495 ms; 1 dari 15 > 1 dtk |
| Status | – | 90/90 panggilan HTTP 200, 0× 429 |

- **Ekor lambat di laptop hampir pasti bukan dari Google**: dari Vercel tidak ada panggilan > 1,5 dtk di 90 sampel. Penyebab ekor laptop (jaringan WSL/ISP) tidak perlu dikejar lagi.
- **Aksi tulis uang ≈ 0,8 dtk** (lock 5 + baca 365 + tulis 364 ms), lebih cepat dari perkiraan 1,5–3 dtk. Dashboard tanpa cache ±0,4 dtk.
- Ambang S5 "p95 lock < 300 ms" (yang FAIL dari laptop) **terpenuhi** dari Vercel (p95 ≤ 22 ms).
- **Caveat:** satu waktu (siang), 90 sampel. Ekor ≈1% belum terukur; timeout per panggilan & retry budget tetap dipertahankan. Uji beban 10× dari Vercel belum diulang — dengan latensi yang lebih rendah, satu user bisa menembak lebih banyak panggilan/menit, jadi **kuota 60/mnt tetap batas keras** dan rate limiter + cache tetap berlaku.
- Token service account ±70–90 ms pada instance baru, 0 ms setelahnya (di-cache); pengecekan judul dummy ±400–650 ms hanya sekali per instance.

### S8 — Cold start / environment (parsial)
- Region terkonfirmasi `sin1`; Node 24 di Vercel (lokal 22 → samakan versi di `engines`).
- `clientMs` 265 dan 171 ms (saat sedang aktif dipakai; instance sudah dipanaskan Vercel, bukan cold start sebenarnya), warm 142 ms (sudah termasuk jaringan user ke Singapore + Deployment Protection).
- **Cold start nyata setelah idle ±30 mnt: 783 ms** total di browser (`coldStart: true`, `processUptimeS` 0,4) → ±0,6 dtk di atas warm. Satu sampel.
- **Instance berganti antar request** (request ke-2 mendarat di instance baru ±24 dtk setelah yang pertama padahal yang lama hangat). Konsekuensi desain: **jangan andalkan memori proses** untuk cache/lock/counter — wajib Redis (sesuai desain).
- **Belum:** ukuran bundle fungsi; waktu build/deploy ±26–33 dtk.

### S4 — Body besar
| Uji | Hasil |
|---|---|
| Stream respons sintetis 10 MB | utuh (10.485.760 B), byte pertama 113 ms, total 251 ms |
| Stream respons sintetis 50 MB | **utuh** (52.428.800 B), byte pertama 169 ms, total 497 ms; tanpa `content-length` (chunked) |
| POST 3 MB ke fungsi | 200, diterima utuh |
| POST 6 MB ke fungsi | **413** `FUNCTION_PAYLOAD_TOO_LARGE` (batas 4,5 MB request tegas) |

- Respons > 4,5 MB **boleh** dikirim jika di-stream (tidak terpotong). Batas 4,5 MB berlaku untuk **request**. Maka: **upload lampiran tidak boleh lewat fungsi** (→ S3), sedangkan unduh/preview lampiran lewat proxy fungsi dengan stream layak.
- **Belum teruji:** stream file nyata dari Drive melalui fungsi (kecepatan Drive→fungsi→browser, izin per user). Sintetis tidak mencakup latensi/ketersediaan Google.

### S4 — Unduh file Drive lewat fungsi (proxy lampiran)
| Sampel | File | Meta | Header `alt=media` | Byte pertama | Total |
|---|---|---|---|---|---|
| 10:31 | 14,2 MB | – | – | 4,7 dtk | 16,1 dtk |
| 10:51 | 14,2 MB | – | – | 7,3 dtk | 26,2 dtk |
| 10:52 | 14,2 MB | – | – | 7,6 dtk | 22,8 dtk |
| 11:02 | 14,2 MB | 516 ms | 5.091 ms | 6,1 dtk | 14,0 dtk |
| 11:03 | 14,2 MB | 480 ms | 5.761 ms | 6,7 dtk | 16,3 dtk |
| 11:13 | 14,2 MB | 472 ms | 5.475 ms | 7,0 dtk | 7,9 dtk |
| 11:15 | 2,0 MB | 521 ms | 4.696 ms | 5,7 dtk | 6,1 dtk |
| ±11:20 | 2,0 MB | 494 ms | **1.503 ms** | 2,4 dtk | 2,6 dtk |
| 11:23 (`/api/drive-timing`) | 2,0 MB | 584 ms | `alt=media` 1.062 / 1.334; **download-endpoint 752 / 783**; Range 1 KB 990 / 1.007 ms | – | 0,8–1,5 dtk |

- Semua unduhan **utuh** (14.183.626 dan 1.980.271 byte); stream lewat fungsi tidak terpotong.
- **Latensi awal Drive bervariasi menurut waktu**: ±5 dtk antara 10:31 dan 11:15, lalu ±1–1,5 dtk mulai ±11:20 dari region yang sama (`sin1`). Dari laptop user (WSL): `alt=media` header 2,9 → 1,4 → 1,1 dtk, Range 1 KB 1,2–1,3 dtk, tanpa redirect. Penyebab fluktuasi **tidak diketahui** (dugaan: kondisi sisi Google/jam; bukan region, bukan ukuran file, bukan cold start — tidak terbukti).
- **Biaya awal tetap, bukan proporsional ukuran**: Range 1 KB sama lambatnya dengan file penuh; throughput setelah byte pertama cepat (2 MB ≈ 0,3 dtk) tapi bervariasi untuk 14 MB (0,9–9,5 dtk).
- **Endpoint `/download/drive/v3/files/{id}?alt=media` ±25–40% lebih cepat** (±0,75 dtk vs ±1,1–1,3 dtk) pada satu run; satu sampel — pakai sebagai pilihan awal dan ukur ulang di Fase 1.
- Perbandingan region (`hnd1`/`iad1`) **tidak dilakukan** karena fluktuasi waktu akan mengacaukan perbandingan; `sin1` tetap karena Sheets 365 ms, Redis 5 ms.
- **Dampak desain:** lampiran = fitur asinkron (indikator memuat; jangan di jalur kritis approve/bayar), `Cache-Control: private` agar buka ulang instan, pra-ambil saat halaman detail terbuka, rencanakan 1–6 dtk untuk klik pertama. Lampiran > ±4,5 MB tetap dialirkan (stream), tidak pernah di-buffer.

### S3 — Upload langsung browser → Drive (sesi resumable)
| Ukuran | Buat sesi (server) | PUT browser→Drive | Hasil |
|---|---|---|---|
| 12 MB | 1,59 dtk | 5,4 dtk (±2,2 MB/dtk) | 200, `size` = 12.582.912 persis, 1 file di folder dummy |
| 30 MB | 1,17 dtk | 19,3 dtk (±1,6 MB/dtk) | 200, `size` = 31.457.280 persis, 1 file di folder dummy |

- **CORS lolos:** `Origin` pada permintaan inisiasi sesi → browser dapat PUT langsung ke URL sesi Google. Server memverifikasi lewat Drive API (ukuran + folder induk) dan membersihkan (trash).
- Throughput dibatasi uplink user, bukan sistem. Untuk lampiran tipikal (PDF/foto ≤10 MB) ±5 dtk.
- **Catatan desain (belum diuji):** URL sesi = kredensial pembawa (siapa pun yang memegangnya bisa mengunggah ke sesi itu, berlaku ±1 minggu) → perlakukan rahasia, jangan di-log. Server harus **mengonfirmasi** setelah upload (cek `size`, `parents`, nama server-generated, tipe) sebelum lampiran menempel ke pengajuan; kontrol ukuran/tipe/pemindaian tetap di sisi server karena klien tidak tepercaya. PUT tunggal tanpa chunk/resume: jaringan mobile putus di tengah perlu penanganan (kueri status sesi + lanjut), dan >100 MB tidak diuji.
- Sesi dibuat oleh service account, file dimiliki Shared Drive (tidak ada kuota service account) — sama seperti uji Fase 0.

## Berikutnya
1. ~~S1~~, ~~S2b/S5~~, ~~Shared Drive~~ selesai. ~~S3, S4 sintetis, S5/S1 dari Vercel~~ selesai.
2. Sisa Fase 0b: ukuran bundle fungsi (S8). ~~stream file Drive~~, ~~cold start idle~~ selesai; perbandingan region ditunda (lihat S4).
3. ~~S6~~ dijawab vendor; sisa: tanyakan sumber pemetaan LID ke Lixus + uji request bertanda tangan asli. S7: checklist manual audit log/DWD/email OTP (lihat bagian S7) → keputusan O8.
4. Setelah itu: perbarui design doc 4.3 (TTL lock, timeout, deadline guard, stale-if-error, rate limiter) dengan angka ini; hapus key service account & deploy dummy.
