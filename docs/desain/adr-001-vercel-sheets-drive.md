# ADR-001: Vercel (Next.js) + Google Sheets sebagai database + Google Drive sebagai file storage (+ Redis untuk koordinasi) untuk P2P Finance Portal

**Status:** Proposed — arah sudah diputuskan user (2026-10-05); desain detail menunggu review
**Date:** 2026-10-05
**Deciders:** Heylocal (FAT) — pemilik keputusan; reviewer teknis: Claude (sesi migrasi)
**Dokumen terkait:** `claude/vercel-migration-design.md`, `claude/vercel-migration-risk-register.md`

---

## Context

P2P Finance Portal sekarang berjalan di Google Apps Script (HtmlService + `google.script.run`), Google Spreadsheet sebagai database, Google Drive sebagai penyimpanan lampiran. Kendala yang sudah terasa dan terdokumentasi di `konteks-sistem-p2p-portal.md`:

- **Deployment Apps Script mengecek akses sebelum kode jalan** → e-approver butuh *deployment kedua* "Anyone"; `doPost` tidak bisa membaca header HTTP → verifikasi HMAC webhook WA tidak mungkin dan harus diganti shared-secret query string.
- UI terbatas (iframe sandbox, navigasi `window.top`, tanpa routing/URL bersih, tanpa laporan/audit viewer, tanpa peran admin di web).
- Password hash terbatas (SHA-256 diulang, karena tidak ada library hash modern), tidak ada rate-limit login.
- Keinginan user: **semua aktivitas di web app**, UI/UX lebih komprehensif, auth seragam (nomor HP + password untuk semua level).

Keputusan user (2026-10-05): trial di **Vercel Hobby**, lalu **Pro** setelah jadi; **database tetap Spreadsheet**, **file tetap Google Drive**. Organisasi berlangganan **Google Workspace Enterprise**.

Fakta pembatas (terverifikasi 2026-10-05, rincian & sumber di design doc 2.3):
- Sheets API: **60 baca + 60 tulis / menit / user / project** (300 per project); service account = satu "user". Edisi Workspace tidak mengubahnya; kenaikan lewat permintaan kuota (tidak dijamin).
- Service account Google **tidak punya storage quota**; harus upload ke **Shared Drive** atau OAuth user.
- Vercel tidak punya lock bawaan; body fungsi maks **4,5 MB**; Hobby: cron maks **1×/hari**, runtime log **1 jam**, dan **non-komersial** (ToS).
- Sheets: tidak ada transaksi multi-langkah, lock, constraint unik, atau query. `spreadsheets.batchUpdate` memberi atomik per request (**perlu dikonfirmasi — spike S2**).

Kontrol keuangan yang HARUS tetap benar (design doc 2.2, I1–I17): gate CFO ≥ Rp 5 jt, anti-overbilling PO, maker-checker vendor, pengaju ≠ verifikator, anti-overpay dari payment log, invoice unik, audit append-only. Beberapa di antaranya hari ini bergantung pada **satu lock global** `LockService` — yang tidak ada di Vercel.

## Decision

Bangun web app **Next.js (TypeScript) di Vercel** dengan arsitektur berlapis:

1. **Domain services** (bisnis logic murni, tanpa I/O) di atas **Repository interface**.
2. **`SheetsRepo`** (adapter) = akses ke Google Sheets sebagai **sumber kebenaran**; **Google Drive (Shared Drive organisasi)** untuk lampiran/export, diakses lewat proxy aplikasi.
3. **Redis (Upstash via Vercel Marketplace)** sebagai lapisan **koordinasi & cache saja** — lock terdistribusi per sumber daya (`SET NX PX`), cache baca, rate-limit, idempotency key, revoke sesi, state OTP/kode WA. **Bukan sumber kebenaran**; boleh hilang tanpa kehilangan data bisnis (aksi uang ditolak/fail-closed saat Redis mati).
4. **Pola tulis Unit-of-Work:** validasi → lock berurutan → baca segar → aturan bisnis murni → **satu `batchUpdate` atomik** → invalidasi cache → lepas lock → notifikasi di luar lock.
5. **Auth seragam** nomor HP + password (scrypt), sesi JWT cookie + revoke di Redis, step-up untuk aksi uang, webhook WA diverifikasi HMAC (S6).
6. **Hobby = trial dengan data dummy** (salinan spreadsheet + Shared Drive dummy); **upgrade Pro sebelum menyentuh data produksi**.
7. Repository interface dijaga supaya **jalan keluar ke Postgres tetap terbuka** (pemicu revisit di design doc bagian 11).

Redis adalah **tambahan di luar "Sheets + Drive"** yang diminta user. Itu sengaja diangkat eksplisit di sini: tanpanya, kontrol I5/I7/I9/I10 tidak bisa dijamin di lingkungan serverless paralel, dan kuota Sheets terlampaui oleh pola baca sistem lama.

## Options Considered

### Option A — Vercel + Sheets (DB) + Drive (file) + Redis (lock/cache)  ← dipilih
| Dimension | Assessment |
|-----------|------------|
| Complexity | **Tinggi untuk lapisan data** (UoW, lock, cache, idempotency, schema registry); rendah untuk sisi lain |
| Cost | Hobby gratis (trial); Pro $20/seat/bln; Upstash free → PAYG ($0,2/100K cmd); Sheets/Drive termasuk lisensi Workspace |
| Scalability | Terbatas: 60/60 request/menit per service account (cukup untuk asumsi ≤ 20 user bersamaan, ≤ 600 trx/bln **bila** cache+batch benar); batas sel 10 juta aman |
| Team familiarity | Tinggi untuk data (tim sudah hidup di Sheets, Odoo export, laporan manual); sedang untuk stack Next.js |

**Pros:** kontinuitas penuh dengan sistem & kebiasaan sekarang; tidak ada migrasi data (rollback = nyalakan lagi Apps Script, sheet tetap satu-satunya kebenaran); tim Finance tetap bisa membuka/menganalisis data di Sheets; memanfaatkan lisensi Workspace Enterprise (Shared Drive, DLP, audit log, kontrol admin); biaya minim.
**Cons:** kuota rendah & tak bisa diskalakan sembarang; konkurensi harus dibangun sendiri dan diuji keras; ada dependensi tambahan (Redis); cache vs edit manual di Sheet berpotensi basi; tipe data Sheets licin (tanggal serial, nol di depan, zona waktu); tidak ada constraint di level DB.

### Option B — Vercel + Postgres (Neon/Supabase) + Drive/Blob untuk file
| Dimension | Assessment |
|-----------|------------|
| Complexity | Sedang: ORM/migrasi standar, transaksi & constraint unik gratis, tanpa Redis untuk lock |
| Cost | Free tier cukup untuk trial; ~$20–25/bln produksi + migrasi data satu kali |
| Scalability | Tinggi (ribuan user/jutaan baris tanpa desain khusus) |
| Team familiarity | Rendah-sedang: data tidak lagi di Sheets; laporan/Odoo export perlu dibangun ulang atau sync ke Sheets |

**Pros:** kontrol uang paling kuat (transaksi ACID, `UNIQUE` untuk invoice/rekening, row-level lock); hilangkan kelas risiko R-02/R-03/R-04/R-06; latensi kecil; query laporan bebas.
**Cons:** **bertentangan dengan keputusan user** (database = spreadsheet); biaya perpindahan kebiasaan tim; butuh sinkron/ekspor ke Sheets bila tim masih ingin analisis di Sheets; migrasi data & audit trail lama; Hobby+Postgres tetap non-komersial.

### Option C — Hybrid: Postgres sebagai primer, Sheets sebagai mirror laporan (read-only), Drive untuk file
| Dimension | Assessment |
|-----------|------------|
| Complexity | Tertinggi: dua penyimpanan + sinkronisasi satu arah + rekonsiliasi |
| Cost | Postgres + job sinkron + Sheets API (tulis mirror terkena kuota juga) |
| Scalability | Tinggi di jalur transaksi, terbatas di jalur mirror |
| Team familiarity | Sedang: Finance tetap punya "Sheets" tapi bukan sumber kebenaran → potensi kebingungan |

**Pros:** keamanan transaksi seperti B + Finance tetap melihat data di Sheets.
**Cons:** kompleksitas dan "dua kebenaran" yang sering memicu kebingungan ("ubah di sheet tapi tidak berubah di app"); tetap menyalahi keputusan user; paling mahal dibangun.

### Option D — Tetap Apps Script, perbaiki UI (HtmlService/React di dalam iframe) + deployment kedua
| Dimension | Assessment |
|-----------|------------|
| Complexity | Rendah-sedang |
| Cost | $0 tambahan |
| Scalability | Terbatas (kuota Apps Script, 6 menit/eksekusi, `LockService` global) |
| Team familiarity | Tertinggi |

**Pros:** nol migrasi; `LockService` sudah ada dan terbukti; tidak ada dependensi baru.
**Cons:** hambatan platform yang jadi alasan utama (cek akses deployment, tidak bisa baca header, UI iframe, auth terbatas, UX tidak bisa "komprehensif dan deep" secara wajar); hash password lemah; kontrol kualitas (test, CI) sulit.

## Trade-off Analysis

1. **A vs B — keputusan terpenting.** Secara teknis B lebih kuat untuk sistem yang memindahkan uang. A dipilih karena **keputusan eksplisit user** dan alasan nyata: kontinuitas data/kebiasaan, tanpa migrasi, rollback mudah, memakai lisensi Workspace yang sudah dibayar. Harga A: kompleksitas lapisan data dan plafon skala rendah. Gw mencatat ini jujur di sini supaya keputusan A diambil *dengan mata terbuka*, bukan karena tidak tahu alternatifnya. Mitigasi: repository interface + **pemicu revisit numerik** (design doc 11) + contract test yang bisa dijalankan terhadap `PostgresRepo` kelak.
2. **Redis atau tidak.** Alternatif lock tanpa Redis (mis. tab `Locks` di Sheet dengan compare-and-set) tidak atomik di Sheets API → tidak aman untuk uang. Tanpa lock, kontrol I5/I7/I9/I10 bisa ditembus oleh dua request paralel. Redis dipilih; biayanya kecil, risikonya ditangani dengan fail-closed.
3. **Satu lock global vs lock per-sumber-daya.** Lock global meniru sistem lama (aman, lambat, menyembunyikan bug). Per-sumber-daya (`trx:`, `po:`, `inv:`, `vendor-rek:`, `seq:`, diurutkan) lebih cepat tapi menuntut daftar kunci yang **lengkap**; kelalaian satu kunci = celah. Dipilih per-sumber-daya dengan race test wajib. Fallback bila ragu: lock global (`global:write`) sebagai mode aman yang bisa diaktifkan via flag.
4. **Cache vs kesegaran.** Daftar boleh basi 15–30 detik; keputusan uang selalu baca segar. Edit manual di Sheet = sumber basi → ditangani dengan TTL pendek, pembatasan akses Sheet (hanya admin + service account), dan opsional trigger `onEdit` Apps Script untuk membersihkan cache.
5. **Auth Google vs HP+password untuk semua.** User memilih HP+password; Enterprise memungkinkan SSO tapi tidak dipakai agar satu sistem konsisten (approver eksternal/tanpa akun Google tetap bisa masuk). SSO admin = opsi masa depan (O9).
6. **Hobby trial vs langsung Pro.** Hobby gratis tapi ToS non-komersial → data dummy dan kode siap pindah; risiko "trial tidak merepresentasikan produksi" (limit Hobby lebih ketat di cron/log) dicatat di risk register (R-10, R-11, R-12).

## Consequences

**Menjadi lebih mudah:** verifikasi webhook yang benar (HMAC header); UI/UX penuh (routing, state, mobile, laporan, audit viewer); satu sistem auth dengan hash kuat + lockout; pengujian otomatis (domain murni + race test); CI/CD & preview deployment; satu detail dokumen untuk semua peran; folder Shared Drive tidak terikat satu orang.

**Menjadi lebih sulit:** semua yang tadinya diberikan `LockService`/`SpreadsheetApp` secara gratis (lock, baca-tulis cepat in-process, `Session` identitas) kini harus dirancang & diuji; membaca/menulis Sheets lewat REST dengan kuota ketat; konsistensi tipe data (tanggal/nol/zona waktu); observabilitas (log Hobby 1 jam); mengelola rahasia & kredensial service account; dua platform yang harus dipantau (Vercel + Google + Upstash).

**Harus ditinjau lagi:**
- Setelah S1/S2/S3/S4/S6/S7 (hasil spike) — ADR ini diperbarui, bukan diam-diam diubah.
- Pemicu pindah ke Postgres (design doc 11).
- Hash-chain Audit_Log, antrean tulis, pemisahan layanan WA bila skala naik.
- Kebijakan pemisahan tugas tambahan (O5) dan e-approve L4/L5 (O4) — menyentuh kontrol uang, butuh persetujuan eksplisit.

## Action Items

1. [ ] User menjawab keputusan terbuka O1–O10 (design doc 12), terutama O1 (skala), O2 (tenant Workspace), O4/O5 (kontrol uang).
2. [ ] Fase 0: jalankan spike S1–S8, simpan hasil di `claude/spike-results.md`.
3. [ ] Admin Workspace: buat proyek GCP + aktifkan Sheets & Drive API; buat **Shared Drive** `P2P-Lampiran` (trial: `P2P-Lampiran-DUMMY`); tentukan jalur kredensial (JSON key vs Workload Identity Federation) sesuai kebijakan org.
4. [ ] Buat skrip anonimisasi untuk **salinan spreadsheet dummy** (nama vendor, rekening, NPWP, nomor HP, email → data uji).
5. [ ] Provision Upstash Redis via Vercel Marketplace (region sama dengan fungsi); pasang log drain + Sentry sejak awal.
6. [ ] Scaffold repo (Next.js + schema registry + `SheetsRepo` + lock + UoW) **setelah** design doc ini disetujui — bukan sebelum.
7. [ ] Jadwalkan upgrade **Vercel Pro** sebelum Fase 4 (go-live); jangan arahkan ke data produksi selama masih Hobby.
8. [ ] Perbarui `konteks-sistem-p2p-portal.md` bagian 8/9 dengan keputusan migrasi ini (dikerjakan di sesi yang sama).
