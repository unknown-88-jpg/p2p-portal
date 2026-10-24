# DESIGN DOC — Migrasi P2P Finance Portal: Apps Script → Vercel Web App

**Status:** DRAFT final-review (belum ada kode / scaffold) — **diperbarui 2026-10-06/07: hasil spike Fase 0/0b + keputusan O1–O12 (bagian 12)** (lihat `claude/spike-results.md`)
**Tanggal:** 2026-10-05 (revisi 2026-10-06)
**Penulis:** Claude (sesi migrasi) · **Reviewer:** Heylocal (FAT)
**Dokumen terkait:** `claude/adr-001-vercel-sheets-drive.md` (keputusan arsitektur), `claude/vercel-migration-risk-register.md` (risiko + temuan debug dari kode asli), `konteks-sistem-p2p-portal.md` (konteks sistem lama, source of truth perilaku bisnis)

> Dasar dokumen ini: seluruh `.gs` + `.html` di project sudah dibaca ulang (bukan dari ingatan). Setiap klaim tentang perilaku sistem lama menyebut fungsi/filenya. Klaim eksternal (kuota Google, limit Vercel) diverifikasi lewat dokumentasi resmi tanggal 2026-10-05 — lihat bagian 2.3. Hal yang BELUM terverifikasi ditandai **[SPIKE Sx]** (bagian 13).

---

## 0. TL;DR

1. **Yang dibangun:** web app Next.js di Vercel, semua aktivitas (ajukan, approve, finance, vendor, master, export, laporan, admin) pindah ke situ. Google Sheets tetap jadi database, Google Drive tetap jadi penyimpanan lampiran.
2. **Auth:** semua orang (PIC, Manager, Finance, CFO, Admin) login **nomor HP + password**. Satu sistem auth, satu aturan. Tidak ada ketergantungan akun Google di sisi user.
3. **Tambahan di luar Sheets & Drive:** satu layanan **Redis (Upstash via Vercel Marketplace)** — BUKAN sumber kebenaran data, cuma untuk *lock terdistribusi, cache baca, rate-limit, idempotency, revocation sesi*. Alasannya: Vercel tidak punya `LockService`, dan kuota Sheets API sangat kecil (60 request/menit/user — lihat 2.3). Tanpa ini sistem akan salah (race condition) atau kena 429.
3b. **Workspace Enterprise dimanfaatkan di sisi Google, bukan di sisi login user:** lampiran disimpan di **Shared Drive** milik organisasi (menyelesaikan masalah "service account tidak punya storage quota"), akses ke Sheet/Drive dikunci ke service account + admin, DLP/context-aware access/audit log Workspace dipakai sebagai lapisan kontrol tambahan. Login user tetap nomor HP + password (D5). Detail + batasannya (Enterprise TIDAK otomatis menaikkan kuota Sheets API) ada di 2.5.
4. **Trial di Hobby = data DUMMY.** Hobby non-komersial (ToS) → spreadsheet salinan + folder Drive dummy. Setelah upgrade Pro baru boleh diarahkan ke data produksi.
5. **Fase:** (0) spike teknis → (1) Auth + Ajukan + Approval → (2) Finance → (3) Vendor/Master/Export/Laporan/Admin → (4) go-live setelah Pro.
6. **Push-back jujur (keputusan tetap di lo):** Sheets sebagai DB itu bisa jalan untuk skala perusahaan lo, tapi plafonnya rendah dan ada beberapa jebakan desain. Repository layer sengaja dibuat bisa diganti ke Postgres tanpa nulis ulang bisnis logic — lihat ADR-001 dan bagian 11 ("kapan harus revisit").

---

## 1. Keputusan yang sudah dikunci

| # | Keputusan | Sumber |
|---|---|---|
| D1 | Trial di Vercel **Hobby**, setelah jadi langsung **Pro** ($20/seat/bulan; seat = developer ber-akses deploy, Viewer gratis) | Pesan user 2026-10-05 |
| D2 | Database = **Google Spreadsheet**; file = **Google Drive** | Pesan user |
| D3 | **Semua aktivitas** di web app; UI/UX dikembangkan lebih komprehensif | Pesan user |
| D4 | Deliverable sesi ini = design doc + ADR + risk register (tanpa kode) | AskUserQuestion |
| D5 | Auth **semua level pakai nomor HP + password** | AskUserQuestion |
| D6 | Trial memakai **salinan spreadsheet + folder Drive dummy** | AskUserQuestion |
| D7 | Fase modul: **Auth+Ajukan+Approval → Finance → Vendor/Master/Export** | AskUserQuestion |
| D8 | Organisasi berlangganan **Google Workspace Enterprise** → manfaatkan ekosistem Google semaksimal mungkin (Shared Drive, kontrol admin, DLP, dst. — lihat 2.5) | Pesan user 2026-10-05 (koreksi atas draf pertama) |
| D9 | **Tanpa OTP email** (O8 dijawab): OTP, bila dipakai, lewat WA. **Approval via WA nominal ≥ Rp 5 jt DIMATIKAN** — hanya lewat web app dengan konfirmasi ulang password; < Rp 5 jt tetap boleh `SETUJU` via WA. **Mengubah perilaku I14 sistem lama** (dulu WA ≥ 5 jt boleh dengan OTP email) | Pesan user + AskUserQuestion 2026-10-07 |

Keputusan turunan yang **belum** dikunci (butuh jawaban lo) ada di bagian 12.

---

## 2. Requirements

### 2.1 Functional — inventory sistem lama → padanan baru (parity matrix)

Semua baris di bawah wajib ada padanannya (Apps Script function → route baru). "Fase" mengikuti D7.

| Fungsi Apps Script (file) | Route baru | Role | Fase |
|---|---|---|---|
| `loginApprover` (Auth.gs) | `POST /api/auth/login` | semua | 1 |
| `logoutApprover` | `POST /api/auth/logout` | semua | 1 |
| `setPasswordViaToken` | `POST /api/auth/set-password` | token sekali pakai | 1 |
| `kirimLinkSetPasswordApprover/SemuaManager` (admin-run di editor) | `POST /api/admin/users/:id/send-setpass` (+ bulk) | Admin | 1 (CLI/skrip) → 3 (UI) |
| *(baru)* lupa password via WA | `POST /api/auth/forgot` | publik, rate-limited | 1 |
| `getUserProfile`/`whoAmI`/`getHomeContext` (Auth.gs, Code.gs) | `GET /api/me`, `GET /api/home` | login | 1 |
| `getBrandOptions/getDeptOptions/getPicOptions/getOrgStructure` (API_Master) | `GET /api/master/org` (1 payload, cascade di client) | login | 1 |
| `getEntitasMap`, `getMasterCoaData`, `getKasAccounts`, `getPphRates` | `GET /api/master/{entitas,coa,kas,pph}` | login | 1–2 |
| `getVendorList(tipe)`, `getVendorByCode` | `GET /api/vendors?tipe=&status=approved` | login | 1 |
| `searchPODetails`, `getPOBillingHistory`, `hitungPlafonSJ_` (API_PO) | `GET /api/po/:poNumber` | PIC+ | 1 |
| `previewPajak`/`hitungPajak` (Calc.gs) | `POST /api/calc/tax` (fungsi murni, tanpa Sheets) | login | 1 |
| `savePengajuan` | `POST /api/pengajuan` (draft) | PIC | 1 |
| `updatePengajuan` | `PUT /api/pengajuan/:id` | PIC pemilik | 1 |
| `submitPengajuan` (+ `assertPOTidakOverbilling_`, `assertNoDuplicateInvoice_`) | `POST /api/pengajuan/:id/submit` | PIC pemilik | 1 |
| `getUserDraftsAndHistory` | `GET /api/pengajuan?scope=mine` | PIC | 1 |
| *(baru)* detail dokumen + timeline | `GET /api/pengajuan/:id` | sesuai `bisaLihatDokumen_` | 1 |
| `getPrintData`, `buildSignatureBlocks` (API_Print, Approval.gs) | `GET /api/pengajuan/:id/voucher` | sesuai `bisaLihatDokumen_` | 1 |
| `getInvoiceFileData` | `GET /api/pengajuan/:id/files/:fileId` (stream, proxy Drive) | sesuai `bisaLihatDokumen_` | 1 |
| `getPendingApprovals` | `GET /api/approvals/inbox` | Manager (L2) | 1 |
| `managerApprove`, `managerReject` | `POST /api/approvals/approve`, `POST /api/approvals/:id/reject` | Manager | 1 |
| `handleWebhookWA`, `prosesBalasanWA_`, `prosesOTP_` (WA_Approval) | `POST /api/webhooks/wa` | HMAC gateway | 1 |
| `kirimDigestApproval/Finance`, `kirimSemuaDigest` (WA_Digest) | `GET /api/cron/digest` | secret cron | 1 |
| `bersihkanWAPending` | `GET /api/cron/housekeeping` | secret cron | 1 |
| `getFinanceQueues` | `GET /api/finance/queues?stage=` | L3+ | 2 |
| `verifyTax` | `POST /api/finance/:id/verify-tax` | L3 (≠ pengaju) | 2 |
| `submitWetSignature` | `POST /api/finance/:id/wet-signature` (kompatibel) → digantikan e-approve L4/L5 | L3 → L4/L5 | 2 |
| `postJournalBulk` | `POST /api/finance/journal` | L3 | 2 |
| `executePayment`, `executePaymentBulk`, `executePaymentCore_`, `bolehDibayar` | `POST /api/finance/:id/pay`, `POST /api/finance/pay-bulk` (idempotent) | L3 | 2 |
| `getPaymentHistory`, `getTotalPaidFromLog` | `GET /api/pengajuan/:id/payments` | sesuai akses dok | 2 |
| `financeReject` | `POST /api/finance/:id/return` | L3 | 2 |
| `submitNewVendor`, `generateVendorID_` | `POST /api/vendors` | PIC+ | 3 |
| `getPendingVendors`, `approveVendor(rowIdx)`, `rejectVendor(rowIdx)` | `GET /api/vendors?status=pending`, `POST /api/vendors/:kode/{approve,reject}` (**by kode, bukan nomor baris** — lihat risiko R-21) | L3 (≠ pendaftar) | 3 |
| `exportJurnalOdoo` | `POST /api/finance/export/odoo` + `GET .../history` | L3 | 3 |
| `validateStruktur`, `diagnosaEmail`, `kenapaAkuDitolak`, `daftarSemuaEmail`, `clearMasterCache` | `/admin/health`, `/admin/users`, `POST /api/admin/cache/clear` | Admin | 3 |
| `auditDataIntegrity`, `repairNoRekening`, `reconcilePayments`, `cekBarisHantu`, `diagnosaKecepatan` (Repair/Diagnostics) | `/admin/health` (audit read-only dulu; aksi repair pakai konfirmasi + snapshot) | Admin | 3 |
| `setupDatabase`, `migrateOldStatus` | skrip CLI sekali jalan (bukan UI) | Admin | 0 |

Modul **baru** (tidak ada di sistem lama; muncul karena "semua aktivitas di web"): dashboard per-peran, detail dokumen + timeline, laporan (aging AP, outstanding per vendor, per brand/dept), viewer audit log, manajemen user, pusat notifikasi, profil/ganti password, command palette.

### 2.2 Invarian kontrol keuangan — WAJIB identik setelah migrasi

Ini aturan yang tidak boleh berubah perilakunya tanpa keputusan eksplisit lo. Setiap item punya test otomatis di Fase 1–2 (bagian 10).

| # | Invarian | Sumber kode |
|---|---|---|
| I1 | Nominal ≥ Rp 5.000.000 (`CFO_THRESHOLD`) → `REQUIRE_CFO=YES`; dihitung ulang tiap nominal berubah | `butuhCFO`, `savePengajuanRow_`, `verifyTax` |
| I2 | Semua angka (DPP, PPN 11%, PPh, final) dihitung ulang di server; angka dari browser diabaikan | `hitungPajak` |
| I3 | Alur status hanya lewat `STATUS_FLOW`; transisi ilegal ditolak + audit otomatis | `transitionStatus`, `Config.gs` |
| I4 | Pembayaran diblokir kecuali: status COA Posted/Partially Paid; approval L2 ada; L3 ada; L4 ada; L5 ada bila CFO wajib; Sub COA, Budget, Link TTD terisi | `bolehDibayar` |
| I5 | Tidak boleh overpay: `nominal ≤ sisa + PAYMENT_TOLERANCE(1000)`; total dibayar dihitung dari **Trx_Payment_Log**, bukan kolom ringkasan | `executePaymentCore_`, `getTotalPaidFromLog` |
| I6 | Pengaju ≠ verifikator pajak (cek email dinormalisasi, server-side) | `verifyTax` |
| I7 | Vendor maker-checker: pendaftar ≠ pengesah; rekening (bank+no) unik | `approveVendor`, `submitNewVendor` |
| I8 | Vendor di pengajuan harus `Approved` dan dicocokkan nama persis | `findVendor_`, `getVendorList` |
| I9 | Invoice unik per vendor (kecuali dokumen berstatus Rejected) | `assertNoDuplicateInvoice_` |
| I10 | Anti-overbilling PO: plafon = 90% grandTotal (`PO_RETENSI_PELUNASAN_PCT=0.10`), 100% hanya bila `qtySJ ≥ qtyPO`; kumulatif lintas dokumen non-Rejected; di-enforce saat submit; qty direkomputasi dari DB_PO/DB_SJ, bukan snapshot baris | `hitungPlafonSJ_`, `assertPOTidakOverbilling_` |
| I11 | Trade non-DP butuh barang diterima penuh (cek qty) saat submit | `submitPengajuan` |
| I12 | Edit hanya oleh pemilik, hanya status Draft/Revision; revisi mengosongkan PPh lama | `updatePengajuanRow_` |
| I13 | Otorisasi lihat dokumen/lampiran: pemilik, manager berwenang brand/dept, atau Finance (L3+) | `bisaLihatDokumen_` |
| I14 | Approval WA: kode 4 digit terikat nomor pengirim; **nominal ≥ Rp 5jt TIDAK boleh via WA — wajib di web + konfirmasi ulang password (D9, berubah dari sistem lama yang memakai OTP email)**; Finance TIDAK approve via WA | `WA_Approval.gs`, `WA_Digest.gs` |
| I15 | Notifikasi = digest terjadwal, bukan instan per submit; notif gagal tidak boleh menggagalkan transaksi | `submitPengajuan`, `kirimWA_` |
| I16 | Export Odoo difilter `DATE_INVOICE` (fallback timestamp), dua jenis jurnal (pembelian, pembayaran) | `exportJurnalOdoo` |
| I17 | Setiap perubahan status/nominal/pembayaran/vendor menulis `Audit_Log` append-only | `writeAudit` |

### 2.3 Fakta eksternal terverifikasi (2026-10-05)

| Fakta | Angka | Sumber |
|---|---|---|
| Sheets API baca | 300/menit/project, **60/menit/user/project** | developers.google.com/workspace/sheets/api/limits |
| Sheets API tulis | 300/menit/project, **60/menit/user/project** | idem |
| Lewat kuota | HTTP 429, wajib exponential backoff; payload disarankan ≤ 2 MB; 1 request maks 180 detik | idem |
| Service account di Drive | Tidak punya storage quota, **tidak bisa memiliki file**; harus upload ke **Shared Drive** atau OAuth atas nama user | developers.google.com/workspace/drive/api/guides/about-shareddrives |
| Drive API | 1.000.000 unit/menit/project; 325.000/menit/user; upload 750 GB/hari/user; "API calls by a service account are considered a single account" | .../drive/api/guides/limits |
| Vercel Hobby fungsi | Fluid compute: default & maks **300 dtk**, 2 GB / 1 vCPU; Pro maks 800 dtk (1800 beta), memori s.d. 4 GB | vercel.com/docs/functions/limitations |
| Body request/response fungsi | **4,5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE`) | idem |
| Hobby deploy | 100 deployment/hari, 1 build concurrent, runtime log disimpan **1 jam** (Pro 1 hari) | vercel.com/docs/limits |
| Hobby **cron** | **maks 1×/hari**, presisi per-jam (±59 menit); Pro: per menit | vercel.com/docs/cron-jobs/usage-and-pricing |
| Hobby & Git org | Project Hobby tidak bisa connect ke repo milik GitHub *organization* | vercel.com/docs/limits |
| Upstash Redis free | 500K command/bulan, 256 MB, request 10 MB; PAYG $0,2 / 100K command | upstash.com/pricing/redis |
| Hobby ToS | Non-komersial / personal only | vercel.com/docs/plans/hobby, vercel.com/legal/terms (dijawab 2026-09-23) |

**Terverifikasi lewat spike (2026-10-06, data dummy):** `values.batchUpdate` & `spreadsheets.batchUpdate` menolak utuh saat validasi gagal (S2); kuota 60 baca + 60 tulis/menit/user terbukti terpisah dan kena 429 hanya di ±10× beban target (S1); `SET NX PX` + release Lua + `INCR` bekerja di Upstash (S5); respons stream > 4,5 MB lolos, request > 4,5 MB → 413, upload resumable langsung browser→Drive lolos CORS (S3/S4); service account hanya bisa upload ke Shared Drive (S0/S7).

**Belum terverifikasi:** format signature webhook gateway Lixus (halaman docs butuh PIN — hanya terkonfirmasi sebelumnya bahwa dikirim di header `X-Gateway-Signature`; algoritma/encoding/timestamp belum) → **[SPIKE S6]**; ketersediaan & retensi audit log Workspace dan penyedia email OTP → **[SPIKE S7 sisa]**; perilaku kegagalan *non-validasi* (timeout/5xx di tengah batch) tetap ambigu → wajib idempotency + baca-ulang (4.3).

### 2.4 Non-functional — ASUMSI (tolong koreksi kalau meleset)

| Dimensi | Asumsi | Kenapa penting |
|---|---|---|
| Pengguna terdaftar | ≤ 60 orang | Menentukan beban cache & kuota |
| Pengguna bersamaan (puncak) | ≤ 20 | idem |
| Volume | ≤ 600 pengajuan/bulan (~30/hari kerja), ≤ 1.500 baris payment log/tahun | Menentukan ukuran sheet & beban tulis |
| Ukuran lampiran | invoice ≤ 4 MB setelah kompres sisi-klien | Limit 4,5 MB body Vercel |
| Latensi | baca (cache hit) p95 < 400 ms; tulis uang p95 < 3 dtk. **Terukur dari Vercel `sin1` (S1/S5, 90 sampel):** tulis uang ≈ 0,8 dtk (lock 5 ms + baca 365 ms + tulis 364 ms); baca Sheets p50 365 / p95 509 ms; cold start ≈ 0,6 dtk | UX |
| Ketersediaan | jam kerja WIB; downtime singkat OK, **kehilangan/korupsi data tidak OK** | Prioritas konsistensi > ketersediaan |
| RPO / RTO | RPO ≤ 24 jam (snapshot harian) + version history Sheets; RTO ≤ 4 jam | bagian 9 |
| Zona waktu | semua tanggal bisnis = Asia/Jakarta (WIB) | Risiko R-05 |
| Bahasa/format | id-ID, Rupiah tanpa desimal | UI |

Kalau angka-angka ini jauh lebih besar (mis. 300 user / 5.000 trx per bulan), jawabannya berubah: Sheets sebagai DB jadi tidak realistis (lihat bagian 11).

### 2.5 Konteks Google Workspace Enterprise — apa yang berubah, apa yang TIDAK

Lo di Workspace Enterprise, jadi ada beberapa hal yang bisa kita pakai lebih dari rancangan awal. Tapi gw pisahkan dengan jelas mana yang **terverifikasi**, mana yang **belum**, dan mana yang **tidak berubah** — supaya ekspektasinya pas.

**Terverifikasi (workspace.google.com/pricing, 2026-10-05):** edisi Enterprise membawa DLP (data loss prevention), context-aware access, Cloud Identity Premium, endpoint management level enterprise, dan storage 5 TB/user (bisa minta lebih). **Belum terverifikasi dari halaman itu:** rincian Shared Drive, Vault, dan audit log per edisi (halamannya tidak merinci) — gw cek langsung di Admin console lo di **[SPIKE S7]**. Shared Drive sendiri terverifikasi dari dokumentasi Drive sebagai jalur resmi untuk service account (lihat 2.3); yang perlu dikonfirmasi cuma bahwa tenant lo mengaktifkannya.

**Yang kita manfaatkan (dan efeknya ke desain):**

| Fitur ekosistem | Dipakai untuk | Efek ke desain |
|---|---|---|
| **Shared Drive** (milik organisasi, bukan milik satu orang) | Folder lampiran produksi `P2P-Lampiran` | Menjawab batasan "service account tidak bisa memiliki file" (2.3). Bonus: file tidak ikut hilang/pindah pemilik kalau staff keluar — di sistem lama (`FOLDER_LAMPIRAN_ID` di My Drive seseorang) itu risiko tersembunyi. Service account jadi *member* Shared Drive dengan peran minimum (Contributor/Content manager, bukan Manager). Semua panggilan Drive wajib `supportsAllDrives=true` |
| **Hak akses ke Spreadsheet** | DB utama | Sheet produksi hanya dibagikan ke service account (Editor) + 2–3 admin (Editor) + auditor (Viewer). **User biasa tidak perlu akses langsung ke Sheet lagi** → permukaan serangan "edit manual di sheet" mengecil drastis (R-22) |
| **DLP / label Drive** | Menandai data sensitif (NPWP, no. rekening vendor) di Shared Drive & Sheet | Kontrol tambahan di sisi Google; tidak mengubah kode. Aturan DLP di-set admin Workspace |
| **Context-aware access** | Membatasi akses konsol Google (Sheet/Drive/Admin) dari perangkat/lokasi tak dikenal | Melindungi jalur manual admin; tidak melindungi web app (web app tidak lewat Google login) |
| **Audit log Drive/Sheets di Admin console** | Mendeteksi siapa menyentuh Sheet/Drive di luar aplikasi | Pelengkap `Audit_Log` aplikasi: audit aplikasi mencatat aksi bisnis, audit Google mencatat akses mentah. **Retensi 6 bulan** (docs resmi, S7) → review bulanan wajib; ekspor berkala bila audit eksternal butuh lebih lama. Ketersediaan di tenant = checklist S7 |
| **Cloud Identity Premium / SSO** | *Opsi masa depan:* SSO untuk staff internal | **Tidak mengubah D5.** Auth user tetap HP + password. Dicatat supaya tidak tertutup kemungkinannya (mis. login admin dengan Google SSO + 2FA di Fase 3) — jadi pertanyaan terbuka O9 |
| **Kebijakan organisasi GCP/Workspace** | Mengatur pembuatan *service account key* | Banyak tenant Enterprise memblokir pembuatan JSON key (policy `iam.disableServiceAccountKeyCreation`). Kalau tenant lo begitu, JSON key tidak bisa dibuat → jalur alternatifnya **Workload Identity Federation** (Vercel menyediakan token OIDC) atau key yang dikecualikan policy untuk proyek ini. Dicek di **[SPIKE S7]** — ini bisa mengubah cara autentikasi server-ke-Google |

**Yang TIDAK berubah karena Enterprise (penting, jangan berharap sebaliknya):**

1. **Kuota Sheets API (60 baca + 60 tulis per menit per user per project) tidak ikut naik karena edisi Workspace.** Kuota itu melekat di *Google Cloud project* tempat API diaktifkan, bukan di edisi Workspace. Service account dihitung satu "user". Jalur menaikkannya: ajukan *quota increase* di Cloud Console (tidak dijamin disetujui — Google sendiri bilang begitu di dokumentasi Drive; untuk Sheets belum gw baca eksplisit) dan/atau sebar beban ke lebih dari satu service account/project. Karena itu arsitektur cache + batching (bagian 4) tetap wajib — dan itu bagian dari **[SPIKE S1]**: ukur dulu, baru ajukan kenaikan kuota kalau perlu.
2. **Spreadsheet tetap bukan database transaksional.** Tidak ada lock, tidak ada constraint unik, tidak ada query; ini properti Sheets, bukan properti lisensi. Redis untuk lock/cache tetap diperlukan (ADR-001).
3. **Limit Vercel tetap limit Vercel** (body 4,5 MB, cron Hobby harian, dst.).

**Apps Script tetap berguna sebagai "lem" kecil** (opsional, Fase 3): trigger `onEdit` di Sheet yang memanggil endpoint `/api/cache/bust` supaya cache Redis ikut basi saat admin mengedit Sheet manual. Ini memanfaatkan fakta bahwa di Workspace, Apps Script jalan di domain yang sama dengan Sheet-nya — dan menutup risiko cache basi (R-07) tanpa menunggu TTL habis. Tidak dipakai untuk bisnis logic.

---

## 3. High-level design

### 3.1 Komponen

```
 Browser (PIC / Manager / Finance / CFO / Admin)          WhatsApp gateway (Lixus)
        │  HTTPS (cookie sesi httpOnly)                         │ webhook (HMAC) ▲ kirim pesan
        ▼                                                       ▼                │
┌──────────────────────────── Vercel (Next.js, Node runtime) ──────────────────────────────┐
│  UI (React Server + Client Components)                                                    │
│  Route Handlers  /api/*        ── zod validasi ── authz (capability) ── service layer     │
│       │                                                │                                  │
│       │                                    ┌───────────┴───────────┐                      │
│       │                                    │  Domain services       │  (bisnis logic     │
│       │                                    │  pengajuan/approval/   │   murni, TS, diuji │
│       │                                    │  finance/vendor/po)    │   tanpa I/O)       │
│       │                                    └───────────┬───────────┘                      │
│       │                                    ┌───────────┴───────────┐                      │
│       │                                    │  Repository (port)     │  ← bisa diganti    │
│       │                                    │  SheetsRepo (adapter)  │    ke Postgres     │
│       │                                    └──┬─────────┬──────────┘                      │
└───────┼───────────────────────────────────────┼─────────┼──────────────────────────────────┘
        │                                       │         │
        ▼                                       ▼         ▼
  Upstash Redis                          Google Sheets   Google Drive (Shared Drive)
  (lock, cache, rate-limit,              API v4          API v3
   idempotency, revoke sesi,             = SUMBER KEBENARAN DATA   = lampiran & export
   state OTP/kode WA)                    (Trx_*, Master_*, Audit_Log, …)
```

Prinsip: **Sheets & Drive = sumber kebenaran. Redis = koordinasi + cache, boleh hilang kapan saja tanpa kehilangan data bisnis** (kecuali state sementara: kode/OTP WA yang kedaluwarsa dalam menit). Bisnis logic tidak boleh tahu soal Sheets (cuma lewat interface repository) — ini yang membuat jalan keluar ke Postgres tetap terbuka (ADR-001).

### 3.2 Stack yang direkomendasikan

| Lapisan | Pilihan | Alasan singkat |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript strict | Satu repo untuk UI + API; deploy native di Vercel |
| UI | Tailwind + shadcn/ui (Radix) + TanStack Query + react-hook-form + zod | Aksesibel, cepat dibangun, form kompleks (wizard) terkelola |
| Validasi | zod (skema dipakai bersama client & server) | Satu sumber aturan input |
| Google | `googleapis` (Sheets v4, Drive v3), auth service account (atau WIF — S7) | Resmi |
| Redis | Upstash (Vercel Marketplace), `@upstash/redis` + `@upstash/ratelimit` | HTTP-based, cocok serverless; `SET NX PX` untuk lock |
| Sesi | JWT bertanda tangan (`jose`) di cookie `httpOnly; Secure; SameSite=Lax` + daftar revoke di Redis | Ganti `CacheService` |
| Hash password | `crypto.scrypt` bawaan Node (tanpa dependensi native) | Jauh lebih kuat dari SHA-256 berulang; lihat 5.2 |
| PDF/cetak | HTML + CSS `@media print` (paritas dengan `Print_Form.html`); PDF server-side opsional Fase 3 | Pertahankan perilaku yang sudah dipakai |
| Log/error | Sentry (atau sejenis) + log drain eksternal | Runtime log Hobby cuma 1 jam (R-12) |
| Test | Vitest (unit/domain), Playwright (E2E), skema kontrak repo | Bagian 10 |

---

## 4. Deep dive — lapisan data (bagian paling berisiko)

### 4.1 Schema registry (menggantikan `COL` / `COL_USER` / dll di `Config.gs`)

- Satu file TypeScript mendefinisikan tiap tab: nama tab, urutan kolom, tipe (`text | money | date | enum | bool`), dan nama header. **Urutan kolom lama dipertahankan persis** (`COL` 1–48; konvensi lama: kolom baru hanya ditambah di paling kanan).
- Saat cold start dan di `/admin/health`, aplikasi **memvalidasi baris header sheet terhadap registry**. Kalau header tidak cocok (seseorang menyisipkan kolom / mengganti nama header) → mode **read-only + alarm**, bukan menulis ke kolom yang salah. Ini menutup jebakan "kolom bergeser diam-diam" yang tidak ada proteksinya di sistem lama.
- Coercer per tipe: `money` → integer rupiah (round sama dengan `Math.round` di `hitungPajak`), `text` → string tanpa apostrof awal (`clean()` lama), `date` → lihat 4.5.

### 4.2 Jalur baca

| Dataset | Sumber | Cache (Redis) | TTL | Catatan |
|---|---|---|---|---|
| Master_COA, Master_PPh, Master_Setting, Master_User_TTD (org/entitas/kas) | `values.batchGet` 1 request untuk semua tab master | key per dataset + versi | 5 mnt | Setara `cacheGet/cachePut` lama (TTL 600 dtk), tapi tidak ada batas 100 KB |
| Master_Vendor (approved) | batchGet | ya | 2 mnt | invalidasi aktif saat approve/register |
| DB_PO, DB_SJ | batchGet kolom yang perlu saja | ya | 2 mnt untuk tampilan; **fresh read saat submit (I10)** | `assertPOTidakOverbilling_` wajib baca segar |
| Trx_Pengajuan (daftar/antrean) | `values.get` kolom ringkas, bukan 48 kolom | row-index per status | 20–30 dtk | Daftar boleh sedikit basi; keputusan uang tidak pernah dari cache |
| Satu dokumen (detail) | `values.get` 1 baris (cari lewat indeks ID → nomor baris) | `trx:{id}` | 15 dtk | Tulis selalu baca segar (4.3) |
| Trx_Payment_Log (jumlah dibayar per ID) | baca segar saat pembayaran; cache untuk tampilan | `paid:{id}` | 15 dtk | I5: sumber kebenaran = log |
| Audit_Log, Trx_Approval | per dokumen saat buka detail | tidak | – | Append-only, kecil |

**Anggaran kuota baca (service account = 1 user, 60/menit):** halaman biasa harus nol baca Sheets saat cache hit. Satu cache miss menghabiskan 1–2 request (batchGet). Dengan 20 user bersamaan dan TTL di atas, perkiraan baca ke Sheets ≈ 6–15/menit (hanya miss + invalidasi) — masih di bawah 60 tapi **tidak banyak ruang**; makanya S1 mengukur ini dengan beban nyata dan ada tuas cadangan (ajukan kenaikan kuota, TTL lebih panjang untuk master, pre-warm terjadwal).

**Pencarian baris:** `findRowByIdTrx` lama = `TextFinder`. Baru: indeks `id → nomor baris` di Redis, dibangun dari baca kolom A saja (1 request), diverifikasi saat tulis (baca baris target, pastikan kolom A cocok ID — kalau tidak, bangun ulang indeks dan ulangi). **Nomor baris tidak pernah dipercaya dari klien** (lihat R-21: `approveVendor(rowIdx)` lama rawan salah sasaran kalau sheet di-sort).

### 4.3 Jalur tulis — Unit of Work + lock + baca segar + batch atomik

Semua aksi yang mengubah data lewat satu pola (menggantikan `withLock(fn)`):

```
1. authz + validasi input (zod)                          ← murah, sebelum lock
2. kumpulkan kunci lock yang dibutuhkan, URUTKAN (anti-deadlock):
      trx:{id}                    (selalu, untuk dokumen yang diubah)
      po:{poNumber}               (submit Trade  → I10 lintas dokumen)
      inv:{vendor}|{noInvoice}    (create/update → I9)
      vendor-rek:{bank}|{noRek}   (register vendor → I7)
      seq:{TRD|NTR|VND}           (generate ID)
3. SET lock NX PX 30000 dengan token acak (aksi uang: tunggu ≤ ~2 dtk lalu gagal cepat — lihat batas waktu di bawah)
4. BACA SEGAR dari Sheets (bypass cache) hanya yang diperlukan keputusan:
      baris dokumen, approval, payment log/DB_PO/DB_SJ bila relevan
5. Terapkan aturan bisnis murni (transitionStatus, bolehDibayar, plafon PO, SoD, hitungPajak)
   → hasil = daftar mutasi (update baris X, append Y, append audit Z)
6. FLUSH: SATU `spreadsheets.batchUpdate` (updateCells/appendCells lintas tab)
      → atomik: semua berhasil atau tidak ada yang berlaku   [SPIKE S2 konfirmasi]
7. Invalidasi cache terkait; lepas lock (skrip Lua: hapus hanya jika token cocok)
8. Di LUAR lock: kirim WA/email, tulis log; kegagalan notifikasi tidak mempengaruhi hasil (I15)
```

Kenapa ini lebih kuat dari sistem lama:
- Sistem lama memakai **satu lock global per script** (semua aksi antre satu-satu) — aman tapi lambat, dan menyembunyikan bug konkurensi. Lock per-sumber-daya lebih cepat tapi **wajib** mengunci `po:` dan `inv:` dan `vendor-rek:` juga; kalau hanya `trx:{id}`, dua PIC yang submit dokumen berbeda atas PO yang sama bisa sama-sama lolos plafon (R-02).
- Sistem lama menulis **sel per sel** (`set(COL.X, ...)` berkali-kali di `verifyTax`, `updatePengajuanRow_`) lalu `transitionStatus` + `writeAudit` terpisah. Kalau terputus di tengah, baris bisa setengah berubah. Baru: satu batch atomik (R-03).
- Payment: tulis `Trx_Payment_Log` + ringkasan baris + status + audit dalam **satu batch**; plus `Idempotency-Key` supaya klik ganda/retry tidak membayar dua kali (R-04).
- **Bulk (`postJournalBulk`, `executePaymentBulk`):** sistem lama memproses per item di dalam satu lock dan melaporkan sebagian-berhasil. Baru: validasi semua item dulu (baca segar sekali), terapkan yang valid dalam **satu batch**, laporkan yang gagal per item. Satu batch = satu request tulis → bulk 30 pembayaran tidak menghabiskan kuota 60 tulis/menit.
- **Compare-and-set tingkat aplikasi:** langkah 4–5 memverifikasi status/`LAST_UPDATE` yang dibaca masih sama dengan yang dilihat user (kirim `expectedStatus`/`etag` dari UI). Kalau berbeda → 409 "dokumen sudah diproses orang lain, refresh" (menggantikan pesan di `transitionStatus` lama).
- **Batas waktu & TTL lock (direvisi berdasar S1/S5, 2026-10-06):** laptop user menunjukkan ekor panggilan Sheets 3–64 dtk, tetapi dari Vercel `sin1` tidak ada panggilan > 1,5 dtk dalam 90 sampel — ekor itu hampir pasti jaringan laptop. Walau begitu **tidak ada TTL tetap yang aman terhadap panggilan yang menggantung**, jadi pengamannya adalah *batas waktu*, bukan TTL besar:
  1. **TTL lock ≈ 30 dtk** (dulu 15 dtk).
  2. **Timeout keras per panggilan Google 8–10 dtk** (`AbortSignal`); tidak ada panggilan tanpa timeout di critical section.
  3. **Deadline guard:** sebelum `batchUpdate` (langkah 6) cek `elapsed < TTL − margin (≥ 5 dtk)` **dan** token lock masih milik kita; kalau tidak → batalkan *tanpa menulis* (`UPSTREAM_BUSY`, aman di-retry).
  4. **Timeout pada langkah tulis = hasil ambigu** (batch mungkin sudah diterapkan). Klien tidak boleh mengulang buta: retry selalu membawa `Idempotency-Key` yang sama, dan server **baca-ulang** (cari baris/log dengan kunci aksi itu) sebelum menulis lagi; rekonsiliasi terjadwal (9.3) sebagai jaring kedua (R-03/R-04).
  5. **Kontensi lock pada aksi uang → gagal cepat** (≤ ~2 dtk menunggu dengan polling berjitter 100–300 ms, lalu `CONFLICT` "sedang diproses pengguna lain, coba lagi"), bukan antre panjang. S2b: tanpa gagal-cepat polling menghabiskan ±81 command Redis/aksi di bawah kontensi 20 orang pada satu PO dan pengaju terakhir menunggu 16 dtk.
  6. Upload Drive **tidak pernah di dalam lock** (sama seperti keputusan lama di `savePengajuan`).
- **Tidak ada state di memori proses.** Vercel berganti instance antar request (S8: request ke-2 mendarat di instance baru ±24 dtk setelah yang pertama). Cache, lock, counter, indeks ID, dan rate-limiter **wajib di Redis**; variabel modul hanya untuk memoize murah yang boleh hilang kapan saja (mis. token akses Google ±1 jam, judul spreadsheet).

### 4.3b Ketahanan terhadap kuota Sheets (hasil S1, 2026-10-06)

Terukur terhadap spreadsheet dummy (script dari laptop, lalu latensi dari Vercel `sin1`):

| Beban | Hasil |
|---|---|
| Target (20 user, think 10–30 dtk, cache 30 dtk) | puncak baca 19–26/60, tulis 6–16/60, **0× 429** |
| Tanpa cache | puncak baca 54/60 — lolos tapi margin ±10%, p95 aksi 4,2 dtk dari laptop |
| 10× (60 user, think 3–8 dtk), tanpa cache | **70,8% percobaan 429**, 7,7% aksi gagal, p95 58 dtk; retry memperbesar beban (≈3,4 percobaan/aksi) |
| 10× dengan cache 30 dtk | 99,9% aksi sukses tapi p95 37 dtk; hambatan pindah ke kuota **tulis** (terpisah, tidak tertolong cache) |

Kesimpulan: kuota **cukup** untuk beban target; yang perlu dirancang adalah *degradasi anggun* saat lonjakan:
1. **Cache semua jalur baca tampilan + single-flight** pada cache miss (satu loader per kunci); invalidasi saat tulis.
2. **Stale-if-error / stale-while-revalidate** untuk baca tampilan: saat 429/timeout sajikan cache lama berlabel "data per HH:MM" + refresh di latar. Aksi uang **tidak pernah** stale.
3. **Pembatas laju global** (token bucket di Redis, ±45 baca/mnt dan ±45 tulis/mnt per service account — di bawah batas 60) + antrean pendek, alih-alih tiap request retry sendiri-sendiri.
4. **Retry budget kecil** (≤ 2 retry atau ≤ 5 dtk, backoff eksponensial + jitter) lalu `UPSTREAM_BUSY` — jangan biarkan user menunggu 60 dtk.
5. **1 `batchUpdate` per aksi** (bulk 30 pembayaran = 1 panggilan tulis); tulis `Audit_Log`/`Payment_Log` lewat `appendCells` di dalam batch yang sama, bukan `values.append` terpisah (S2: `values.append` tidak andal di tab yang punya baris kosong).
6. Alarm: 429 > 5% dalam 10 menit; laju baca > 45/mnt.
7. Tuas skala (tidak wajib sekarang): service account tambahan (kuota per user), TTL cache master lebih panjang, ajukan kenaikan kuota; tinjau bila pengguna aktif bersamaan > ±40.

Latensi lebih rendah dari Vercel berarti satu user bisa menghasilkan lebih banyak panggilan/menit — **kuota 60/mnt tetap batas keras**; uji beban 10× perlu diulang dari Vercel saat Fase 1 berjalan.

### 4.4 Pembangkit ID

- `TRD-00001`/`NTR-00001`/`VND-0001`: `INCR seq:{prefix}` di Redis, **dalam lock `seq:{prefix}`**. Bootstrap (key belum ada atau Redis kosong): baca ID tertinggi dari kolom A di sheet (logika `generateTransactionID_` lama) lalu set counter — dilakukan di dalam lock yang sama supaya dua instance tidak bootstrap bersamaan.
- Karena Redis boleh hilang, **ID final tetap ditentukan oleh data di sheet**: sebelum flush, pastikan ID baru belum ada (indeks ID dari langkah 4.2). Celah nomor (gap) kalau flush gagal setelah INCR dianggap OK (sistem lama juga bisa berlubang).
- Saat cutover dari Apps Script: counter diinisialisasi dari `max(sheet)` — **bukan** menyalin `SEQ_*` Script Properties (R-27).

### 4.5 Tanggal, angka, teks (sumber bug paling halus)

| Isu | Aturan baru |
|---|---|
| Zona waktu | Server Vercel = UTC; Apps Script memakai `Session.getScriptTimeZone()`. **Semua** konversi tanggal bisnis lewat satu helper `wib()` (Asia/Jakarta). `new Date("2026-10-05")` diparse UTC → jangan dipakai mentah. Rentang export Odoo (`to.setHours(23,59,59)`) dihitung dengan batas hari WIB |
| Tanggal di Sheet | Baca dengan `valueRenderOption=UNFORMATTED_VALUE` + `dateTimeRenderOption=SERIAL_NUMBER`, konversi serial → tanggal WIB. Tulis tanggal invoice/jatuh tempo sebagai serial/`USER_ENTERED` agar tetap sel tanggal sungguhan (laporan & pivot yang sudah dipakai tim tidak rusak) — **keputusan O6 bila mau ISO text** |
| Nomor rekening/NPWP | Tulis `valueInputOption=RAW` sebagai string (nol di depan aman, **tidak perlu apostrof `'`**); saat baca tetap `clean()` untuk data lama. Format kolom diset teks (`@`). Repair.gs menunjukkan masalah "nol hilang" pernah terjadi nyata |
| Uang | Integer rupiah. Hitungan di server pakai aritmetika desimal aman (hindari akumulasi float); pembulatan identik dengan `Math.round` di `hitungPajak` (diuji golden test, 4.7) |
| Formula injection | Nilai teks input user yang diawali `=`, `+`, `-`, `@` ditulis dengan RAW + diawali `'` hanya untuk kolom bebas (deskripsi/catatan) agar tidak dieksekusi bila Sheet dibuka/diexport (CSV Odoo juga di-escape) |

### 4.6 Drive — lampiran & export

- **Penyimpanan:** Shared Drive `P2P-Lampiran` (2.5). Struktur: `/{tahun}/{bulan}/{ID_TRX}/{jenis}_{timestamp}_{nama}` — jenis ∈ `invoice`, `ttd`, `export`. Sistem lama menaruh semua file flat di satu folder (`FOLDER_LAMPIRAN_ID`); struktur baru memudahkan audit & retensi.
- **Kolom `FILE_URL`/`LINK_TTD` tetap diisi** dengan URL Drive (kompatibel dengan sheet & laporan lama) **plus** fileId diekstrak (`extractDriveId_` lama). Aplikasi tidak pernah memberikan link Drive langsung ke user — lihat berikutnya.
- **Akses file lewat proxy aplikasi** `GET /api/pengajuan/:id/files/:fileId`: cek `bisaLihatDokumen_` (I13), baru stream dari Drive pakai kredensial service account. Alasannya: (a) approver/PIC **tidak lagi punya akun Google** (D5), jadi link Drive tidak bisa mereka buka — ini sebenarnya celah di sistem lama pada deployment "Anyone" (tombol "Berkas" di `Approval_Portal.html` memakai `it.fileUrl` langsung); (b) izin tunggal di aplikasi, bukan di Drive.
- **Batas 4,5 MB body Vercel berlaku untuk REQUEST, bukan respons yang di-stream (terukur S4):** POST 3 MB lolos, POST 6 MB → 413 `FUNCTION_PAYLOAD_TOO_LARGE`; respons stream sintetis 50 MB dan file Drive 14 MB sampai utuh.
- **Upload (usulan, keputusan O11):** server membuat **sesi resumable Drive** (header `Origin` disertakan saat inisiasi), browser mem-PUT **langsung ke Google** — terbukti S3 untuk 12 MB (5,4 dtk) dan 30 MB (19,3 dtk) dengan ukuran persis dan CORS lolos. Aturan keamanan: (a) URL sesi = kredensial pembawa → jangan di-log, hanya diberikan ke pemilik aksi; (b) server **mengonfirmasi** sesudah upload (cek `size`, `parents`, nama dibuat server, tipe) sebelum lampiran menempel ke pengajuan; (c) batas ukuran/tipe ditegakkan server (klien tidak tepercaya); (d) file yatim (upload tanpa konfirmasi) dibersihkan oleh cron housekeeping. Belum teruji: putus jaringan di tengah (perlu kueri status sesi + lanjut) dan > 100 MB. Alternatif lebih sederhana: kompres di klien (maks sisi 1800 px, JPEG 0,82) dan batasi ≤ 4 MB lewat fungsi.
- **Download/preview lewat proxy `GET /api/pengajuan/:id/files/:fileId`** dengan stream (tidak pernah di-buffer penuh). **Latensi awal Drive 1–6 dtk dan bervariasi menurut waktu** (S4: ±5 dtk antara 10:31–11:15, lalu ±1–1,5 dtk dari region yang sama; dari laptop ±1–2,9 dtk; Range 1 KB sama lambatnya dengan file penuh → biaya awal tetap). Konsekuensi: lampiran adalah **fitur asinkron** — indikator memuat, `Cache-Control: private` agar buka ulang instan, pra-ambil saat halaman detail terbuka, tidak pernah di jalur kritis approve/bayar. Endpoint `/download/drive/v3/files/{id}?alt=media` ±25–40% lebih cepat pada satu sampel (±0,75 dtk vs ±1,1–1,3 dtk) → dipakai sebagai default dan diukur ulang di Fase 1.
- **Virus/MIME:** whitelist MIME (`application/pdf`, `image/jpeg|png`), cek magic bytes, nama file disanitasi, dikirim ke Drive dengan `Content-Disposition` aman.

### 4.7 Strategi pengujian data layer

- **Golden test** `hitungPajak`: ekspor 200+ baris nyata (dummy) dari Trx_Pengajuan lama → hitung ulang di TS → hasil harus sama persis (I2).
- **Contract test repository**: satu suite dijalankan terhadap `SheetsRepo` (spreadsheet uji) *dan* `InMemoryRepo` — menjamin domain logic tidak bergantung perilaku aneh Sheets, dan menyiapkan `PostgresRepo` bila suatu hari perlu.
- **Race test**: 20 request paralel pada (a) PO yang sama mendekati plafon, (b) invoice yang sama, (c) rekening vendor yang sama, (d) pembayaran dengan sisa kecil, (e) approve dokumen yang sama → invarian I5/I9/I10/I7/I3 tidak boleh bocor.
- **Fault injection**: sengaja gagalkan flush/429 di tengah → tidak boleh ada baris setengah berubah; retry dengan idempotency key tidak menggandakan.

---

## 5. Auth, otorisasi, keamanan

### 5.1 Identitas & peran (semua pakai nomor HP + password — D5)

- Kunci login: `nomor HP` (dinormalisasi lewat logika `normalisasiNomorWA_`). Satu orang = banyak baris di `Master_User_TTD` (brand/dept/level berbeda) dengan hash/salt sama — **struktur sheet tidak diubah**; sesi memuat gabungan `roles[]` seperti `cariBarisApproverByNomor_`.
- **Email tetap kolom wajib** di Master_User_TTD: dipakai sebagai kunci stabil kepemilikan dokumen (`CREATED_BY` di ~semua baris lama berisi email) dan untuk OTP email. Sesi membawa `{email, nomor, nama, roles}`. Cek "pengaju ≠ verifikator" tetap membandingkan email dinormalisasi (I6).
- **Peran Admin (baru):** sistem lama "admin" = orang yang menjalankan fungsi di editor Apps Script. Karena semua aktivitas pindah ke web, perlu peran eksplisit. Usulan: `Level 9 = System Admin` (Brand=ALL, Dept=ALL) di Master_User_TTD — **keputusan O3**.

### 5.2 Password

- Hash: `scrypt` (N=2^15, r=8, p=1, salt 16 byte acak, simpan parameter di string hash). Kolom `Password_Hash`/`Password_Salt` tetap dipakai; format baru diberi prefiks versi (`s1$...`).
- **Migrasi hash lama tanpa memaksa reset:** verifikasi hash lama (SHA-256 ber-salt diulang 3000×, mudah direproduksi di Node) saat login pertama; kalau cocok, langsung hash ulang dengan scrypt dan simpan. User yang belum pernah login tetap lewat link set-password.
- Kebijakan: minimal 8 karakter (lama: 6 — **naik, O7**), blokir daftar password umum, tidak boleh sama dengan nomor HP.
- Set/reset: token sekali pakai (Redis TTL 60 mnt) via WA, sama seperti `kirimLinkSetPasswordApprover`; **lupa password** self-service: minta link ke nomor terdaftar (selalu balas pesan generik; rate-limit per nomor & per IP).

### 5.3 Sesi

- JWT (HS256/EdDSA via `jose`) di cookie `httpOnly; Secure; SameSite=Lax; Path=/`, umur 8 jam dengan idle timeout 30–60 mnt (lama: token 6 jam di variabel JS memori, hilang saat reload — UX lebih baik, keamanan setara bila cookie benar). `jti` disimpan di Redis untuk revoke (logout, ganti password, nonaktifkan user → semua sesi mati).
- **CSRF:** `SameSite=Lax` + cek header `Origin` pada semua mutasi + token CSRF untuk form non-fetch. **CSP** ketat (tanpa inline script; nonce), `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **Rate-limit & lockout** (sistem lama TIDAK punya — R-14): login maks 5 gagal / 15 mnt per (nomor, IP) lalu jeda eksponensial; pesan error selalu generik ("Nomor HP atau password salah.") seperti `loginApprover` lama; semua login/logout/gagal ditulis ke Audit_Log.

### 5.4 Otorisasi — capability, bukan "level persis"

Sistem lama memakai `requireLevel(level)` dengan perbandingan **sama persis** (`r.level === level`), sehingga orang Level 4 tanpa baris Level 3 tidak bisa memakai fungsi Finance (kebetulan aman, tapi bukan desain yang disengaja). Baru: matriks capability eksplisit, dicek di service layer (bukan di UI saja):

| Capability | L1 PIC | L2 Mgr | L3 Fin Staff | L4 Fin Mgr | L5 CFO | L9 Admin |
|---|---|---|---|---|---|---|
| Buat/edit/submit pengajuan (milik sendiri) | ✔ | – | – | – | – | – |
| Lihat dokumen | milik sendiri | brand/dept berwenang | semua | semua | semua | semua (baca) |
| Approve/return (L2) | – | ✔ brand/dept berwenang | – | – | – | – |
| Verifikasi pajak | – | – | ✔ (≠ pengaju) | – | – | – |
| Konfirmasi/approve TTD (L4/L5) | – | – | upload scan (kompat.) | e-approve (Fase 2) | e-approve bila ≥ Rp 5jt (Fase 2) | – |
| Posting jurnal COA | – | – | ✔ | – | – | – |
| Bayar | – | – | ✔ | – | – | – |
| Daftarkan vendor | ✔ | ✔ | ✔ | – | – | ✔ |
| Sahkan/tolak vendor | – | – | ✔ (≠ pendaftar) | – | – | – |
| Export Odoo | – | – | ✔ | ✔ | – | ✔ |
| Laporan | milik sendiri | divisi | semua | semua | semua | semua |
| Kelola user/master/health | – | – | – | – | – | ✔ |

> Matriks ini mereplikasi perilaku lama. Beberapa kelonggaran lama (mis. orang yang sama bisa verifikasi pajak, upload TTD, posting jurnal, dan membayar dokumen yang sama; manager yang juga PIC bisa menyetujui dokumennya sendiri) **sengaja tidak diubah diam-diam** — itu keputusan kontrol keuangan. Ditulis sebagai **O4/O5** di bagian 12 dan R-17/R-18 di risk register.

### 5.5 Webhook WhatsApp

> **S6 (jawaban vendor 2026-10-07):** `X-Gateway-Signature` = **hex** HMAC-SHA256 atas **raw body saja** (secret = "Webhook Secret" per API Consumer); **tanpa** header timestamp dan **tanpa** anti-replay; **tanpa retry** (fire-and-forget, status HTTP respons tidak diperiksa); signature hanya lewat header; `@lid` di-resolve gateway menjadi `<phone>@s.whatsapp.net` atau webhook ditahan (`skipWebhook`). Detail & uji tersisa: `claude/spike-results.md` bagian S6. Pertanyaan lanjutan ke Lixus: asal pemetaan LID→nomor (R-34).

- Route handler Vercel **bisa membaca header**, jadi verifikasi yang mustahil di Apps Script bisa dipasang: `const raw = await req.text()` → `hmac = createHmac('sha256', WA_WEBHOOK_SECRET).update(raw).digest('hex')` → bandingkan dengan header `X-Gateway-Signature` memakai `timingSafeEqual` (panjang disamakan dulu) → **baru** `JSON.parse(raw)`. Tidak ada header → tolak (fail-closed). Karena gateway **tidak punya anti-replay**: (a) dedup `message.key.id` di Redis (TTL ≥ 7 hari); (b) tolak `messageTimestamp` yang lebih tua dari ±10 menit untuk perintah `SETUJU/TOLAK` (timestamp ada di body yang ditandatangani); (c) kode sekali pakai + OTP tetap berlaku. Pengirim yang bukan `<digit>@s.whatsapp.net` (mis. `@lid`) → ditolak. Karena gateway **tidak retry dan tidak memeriksa status respons**, endpoint membalas 200 cepat, **setiap perintah dibalas ke pengirim** (diterima/gagal), pesan yang gagal diproses masuk dead-letter di Redis + alarm, dan status dokumen **tidak pernah** bergantung pada ada-tidaknya webhook. Shared-secret query (`?wh=`) dipertahankan hanya sebagai jalur Apps Script lama sampai cutover.
- Kode `SETUJU/TOLAK <4 digit>`: dipindah dari sheet `WA_Pending_Approval` ke **Redis** (hash kode+nomor, TTL 3 hari = aturan `bersihkanWAPending` lama), kode dibuat dengan `crypto.randomInt` (lama: `Math.random`), aksi tertunda ikut di Redis (lama: Script Properties `WA_ACT_*`). **Per D9, dokumen ≥ Rp 5 jt tidak mendapat kode di digest** — digest hanya menampilkan ringkasan + link ke web; balasan `SETUJU` untuk dokumen ≥ ambang ditolak dengan pesan "Nominal ≥ Rp 5 jt harus disetujui lewat web". Ambang dievaluasi **di server dari nominal tersimpan**, bukan dari isi pesan. Karena itu OTP 6 digit via WA tidak lagi menjadi jalur approval uang besar (kode OTP, bila nanti dipakai di web, `crypto.randomInt`, disimpan sebagai hash, TTL 5 mnt, maks 5 percobaan).
- **Tanpa email OTP (D9/O8, 2026-10-07):** tidak ada penyedia email, tidak ada DWD Gmail — menghapus ketergantungan S7 pada super admin. Faktor terpisah untuk uang besar = **password** (konfirmasi ulang di web, 5.6), bukan saluran WA yang sama. Antarmuka `OtpSender` tetap dibuat tipis supaya email bisa ditambahkan nanti tanpa mengubah domain logic (opsi di `claude/spike-results.md` bagian S7).

### 5.6 Step-up untuk aksi uang di web

Selaras jawaban lo sebelumnya ("ada OTP dan konfirmasi ketika mau approve"): approve manager nominal ≥ Rp 5 jt, dan di Fase 2 e-approve L4/L5 + pembayaran, meminta **konfirmasi ulang password** (faktor terpisah dari WA; D9) dalam modal ringkasan ("Anda menyetujui TRD-00012, Rp 12.500.000, vendor X"). Hasil konfirmasi berlaku 5 menit untuk sesi itu. Ini menutup risiko "sesi terbuka di laptop yang ditinggal", dan karena approval WA ≥ Rp 5 jt dimatikan (D9), password ini juga satu-satunya faktor untuk approval uang besar — maka rate-limit & lockout percobaan password (5.3) berlaku juga di modal ini.

### 5.7 Rahasia & konfigurasi

Disimpan sebagai Environment Variables Vercel (terenkripsi; **terpisah** untuk Preview/Production): `GOOGLE_SA_*` (atau konfigurasi WIF), `SHEET_ID`, `DRIVE_ROOT_ID`, `JWT_SECRET`, `WA_GATEWAY_URL`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`, `UPSTASH_REDIS_*`, `CRON_SECRET`, `APP_BASE_URL`. Tidak ada rahasia di sheet atau repo. Rotasi dijadwalkan (SA key/JWT 90 hari). Aplikasi tidak pernah mengembalikan rahasia ke klien; log tidak boleh memuat nomor rekening penuh/password/OTP (redaksi di logger).

---

## 6. Desain API

- **Gaya:** REST JSON di `/api/*`, versi implisit (breaking change = `/api/v2`). Semua input divalidasi zod; semua output lewat DTO (bukan baris mentah sheet — `NPWP`, `no rekening` hanya dikirim ke role yang berhak).
- **Format error seragam:** `{ error: { code, message, requestId, fields? } }`. Kode: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` (status/etag berubah), `RULE_VIOLATION` (aturan bisnis: overbilling, SoD, duplikat), `RATE_LIMITED`, `UPSTREAM_BUSY` (429 Google → "sistem sibuk, coba lagi", dengan `Retry-After`), `INTERNAL`. Pesan bahasa Indonesia yang sama dengan sistem lama untuk aturan bisnis (user sudah familiar).
- **Idempotensi:** semua POST yang memindahkan uang/status (`submit`, `approve`, `verify-tax`, `journal`, `pay`, `pay-bulk`, `wet-signature`, vendor approve) wajib header `Idempotency-Key` (UUID dari klien, dibuat per niat aksi, bukan per klik). Server menyimpan hasil 24 jam di Redis; request ulang dengan key sama mengembalikan hasil sebelumnya.
- **Konkurensi optimistik:** GET detail mengembalikan `etag` (hash status+`LAST_UPDATE`); mutasi mengirim `If-Match`. Beda → 409 + data terbaru.
- **Pagination/filter:** cursor-based untuk daftar; filter `status`, `brand`, `dept`, `vendor`, `dateFrom/To`, `q` (ID/invoice/vendor), `sort`. Karena sumber Sheets, pencarian teks dilakukan di indeks Redis ringkas (bukan scan 48 kolom tiap request).
- **Rate limit:** per user & per IP untuk auth; per user untuk mutasi; per nomor untuk WA keluar.
- **Observabilitas:** setiap request membawa `requestId` (ditampilkan di toast error supaya user bisa melapor), log terstruktur, metrik: latensi per route, hit-rate cache, jumlah 429 Google, durasi lock, antrean retry.
- **Cron:** `/api/cron/*` hanya menerima header `Authorization: Bearer $CRON_SECRET`. **Hobby: cron maks 1×/hari** (2.3) → selama trial jadwal digest (beberapa kali sehari) dipanggil dari **GitHub Actions `schedule` atau cron-job.org**; di Pro pindah ke Vercel Cron per-menit. Kode route sama.

---

## 7. Desain UI/UX (komprehensif)

### 7.1 Prinsip

1. **Satu pekerjaan, satu layar.** Sistem lama memecah per "halaman" (`?page=ajukan|finance|approval|print`) dan menyuruh user "kembali ke beranda". Baru: satu app shell dengan navigasi berbasis peran; dokumen punya satu *detail page* yang sama untuk semua peran (dengan aksi yang beda).
2. **Antrean kerja dulu, bukan menu.** Landing tiap peran = "yang perlu saya lakukan sekarang" (angka + daftar), bukan kumpulan kartu pintu (`Home.html`).
3. **Uang = konfirmasi eksplisit + ringkasan.** Tiap aksi yang memindahkan uang/status menampilkan apa yang akan terjadi (nominal, vendor, rekening sumber, efek ke status) sebelum tombol final; tombol dikunci setelah klik (anti klik ganda), hasil ditampilkan jelas.
4. **Server yang berhitung; UI hanya preview.** Pola `previewPajak` dipertahankan (debounce 250 ms), dengan rincian DPP/PPN/PPh/netto yang bisa dibuka.
5. **Mobile-first untuk Manager/CFO** (mereka approve dari HP, via link WA). Finance = desktop-first dengan keyboard & bulk.
6. **Bahasa Indonesia, format id-ID, istilah lama dipertahankan** (Pajak, TTD basah, Jurnal COA, Treasury, Plafon budget) — tidak ada kosakata baru yang harus dipelajari ulang. Enum status di database **tidak diubah**; yang berubah hanya label tampilan (7.3).
7. **Aksesibilitas & ketahanan:** kontras WCAG AA, fokus terlihat, label form, navigasi keyboard penuh, state *loading/empty/error* di setiap daftar (skeleton, bukan spinner tak berujung — masalah yang dulu diperbaiki dengan `withFailureHandler`), error boundary dengan `requestId`.

### 7.2 Sitemap

```
/login  /lupa-password  /set-password/[token]
/                     Dashboard (berbeda per peran)
/pengajuan            Daftar (Saya / Semua sesuai hak) + filter, pencarian, tampilan tersimpan
/pengajuan/baru       Wizard pengajuan (Trade / Non-Trade)
/pengajuan/[id]       Detail: ringkasan · lampiran · rincian pajak · timeline approval/audit · pembayaran · aksi
/pengajuan/[id]/edit  Perbaiki draft/revisi
/pengajuan/[id]/voucher   Cetak (paritas Print_Form.html)
/approval             Inbox Manager (split view) — mobile-first
/finance              Ringkasan pipeline
  /finance/pajak      Tahap 1 — verifikasi pajak
  /finance/ttd        Tahap 2 — TTD basah (Fase 2: Persetujuan L4/L5)
  /finance/jurnal     Tahap 3 — jurnal COA (bulk)
  /finance/treasury   Tahap 4 — pembayaran (cicilan & bulk)
  /finance/export     Export Odoo + riwayat export
/vendor               Daftar vendor, daftarkan baru, antrean pengesahan (Finance)
/laporan              Aging AP · Outstanding per vendor · Per brand/dept · Log pembayaran
/audit                Viewer Audit_Log (filter ID/aktor/aksi/tanggal)
/notifikasi           Pusat notifikasi (in-app)
/profil               Ganti password, nomor HP, preferensi notifikasi
/admin/users          Kelola user & peran, kirim link set-password, nonaktifkan
/admin/master         Struktur org, entitas/prefix PO, COA, PPh (read + validator; edit tetap di Sheet fase awal)
/admin/health         Validasi struktur · integritas data · rekonsiliasi pembayaran · kesehatan koneksi (Sheets/Drive/Redis/WA)
```

Navigasi disaring per peran (orang dengan beberapa peran melihat gabungan). Pintasan global: **Ctrl/Cmd+K** (cari ID TRD-/NTR-, vendor, no. invoice, no. PO).

### 7.3 Label status (enum tidak berubah)

| Enum tersimpan | Label tampil | Warna |
|---|---|---|
| Draft | Draft | abu |
| Submitted | Menunggu Manager | biru |
| Manager Approved | Menunggu Verifikasi Pajak | cyan |
| Tax Verified | Menunggu TTD Basah (Fase 2: Menunggu Persetujuan Fin. Mgr/CFO) | kuning |
| Wet Signed | Menunggu Jurnal COA | cyan |
| COA Posted | Siap Dibayar | hijau muda |
| Partially Paid | Dibayar Sebagian | oranye |
| Paid | Lunas | hijau |
| Revision Needed | Perlu Revisi | merah |
| Rejected | Ditolak | merah tua |

Stepper horizontal di detail dokumen menampilkan posisi dokumen di alur, siapa penanggung jawab tahap itu, dan **umur di tahap itu** (chip "3 hari di Verifikasi Pajak", merah bila > ambang SLA yang bisa diatur Admin).

### 7.4 Spesifikasi layar utama

**A. Login** — nomor HP + password, "ingat perangkat ini" (memperpanjang idle timeout saja), tautan lupa password, pesan error generik, indikator lockout bila terkena rate-limit. Halaman set-password: token dari link WA, indikator kekuatan password, aturan terlihat, setelah sukses langsung masuk (tidak perlu login ulang).

**B. Dashboard per peran**
- *PIC:* kartu "Perlu revisi" (merah, di atas), "Draft belum diajukan", "Menunggu approval" + tombol besar "Buat pengajuan"; timeline aktivitas terakhir.
- *Manager:* antrean approval (jumlah, total nominal, yang tertua), shortcut "Setujui semua < Rp 5jt" **tidak** disediakan (sengaja — I14/step-up); ringkasan divisi bulan ini.
- *Finance:* pipeline 4 tahap (jumlah + total Rp + aging), vendor menunggu pengesahan, jatuh tempo ≤ 7 hari (hari ini/besok/minggu ini), tagihan CFO-gated yang tertahan.
- *CFO/Fin Mgr:* antrean persetujuan (Fase 2), total komitmen kas pekan ini.
- *Admin:* kesehatan sistem (header sheet OK? kuota 429? Redis? WA gateway terhubung? trigger cron terakhir berjalan?), temuan struktur (hasil `validateStruktur`).

**C. Wizard Pengajuan** (menggantikan form panjang `Index.html`; autosave draft tiap langkah ke server — draft memang sudah status `Draft` di sistem lama, jadi tidak ada konsep baru)
1. *Jenis & referensi* — Trade: input nomor P.O → "Tarik data P.O" menampilkan kartu PO (vendor, grand total, qty PO vs diterima gudang) dan **gauge plafon** (`plafonSJ`, sudah diajukan, sisa boleh tagih) + daftar dokumen lain yang memakai PO ini (dulu `poBilling`). Non-Trade: langsung ke langkah 2.
2. *Entitas & keperluan* — Brand → Departemen → PIC dependen (cascade dari `GET /api/master/org`, tanpa `setTimeout(…,300)` hack di `JS_Main.html`); peringatan bila divisi belum punya Manager (tombol lanjut dikunci, seperti `adaManager`); nama approver ditampilkan ("akan disetujui oleh …").
3. *Vendor* — combobox dengan pencarian (hanya Approved); kartu rekening vendor read-only (bank, nama rek., no. rek. disamarkan sebagian kecuali saat diperlukan); link "Vendor belum ada? Daftarkan" (Fase 3).
4. *Tagihan & lampiran* — no. invoice (cek duplikat **inline saat blur**, bukan baru gagal saat simpan), tanggal invoice/jatuh tempo (validasi `due ≥ invoice`), jenis pembayaran, nilai/diskon/biaya lain, status PPN; panel hasil hitung (DPP, PPN, netto) + badge **"Butuh TTD CFO"** bila ≥ Rp 5 jt; unggah lampiran drag-and-drop + kompres + pratinjau, indikator ukuran, batas 4 MB dengan pesan jelas.
5. *Tinjau & kirim* — ringkasan seluruh isian + lampiran + siapa yang akan menyetujui; tombol **Simpan draft** dan **Ajukan ke Manager** (modal konfirmasi: "dikunci, tidak bisa diedit setelah dikirim"). Peringatan qty gudang (I11) dan plafon PO (I10) muncul di sini dengan penjelasan yang sama seperti pesan error lama.

**D. Detail dokumen** (satu halaman untuk semua peran): header (ID, status, nominal, badge CFO) · stepper · tab *Ringkasan* / *Lampiran* (viewer PDF/gambar inline, tombol cetak) / *Pajak* (DPP, PPN, PPh, netto — read-only kecuali tahap Finance) / *Pembayaran* (riwayat cicilan dari payment log, total terbayar, sisa) / *Riwayat* (gabungan Trx_Approval + Audit_Log, dengan metode: E-SIGN / WA / Portal) · panel aksi kontekstual di kanan (Setujui/Kembalikan, Verifikasi pajak, Bayar, dst. sesuai peran & status; aksi yang tidak boleh tampil nonaktif dengan alasan — mis. "Anda yang mengajukan; verifikasi harus oleh rekan Finance" seperti baris `isSelfSubmitted` di `JS_Finance.html`).

**E. Inbox Approval (Manager)** — layout dua panel: daftar kiri (urut tertua, nominal, flag CFO, PIC), pratinjau kanan (invoice + ringkasan + riwayat). Aksi: *Setujui* (modal catatan opsional + step-up bila ≥ Rp 5jt), *Kembalikan* (alasan wajib + template alasan umum), pilih-banyak untuk setujui massal (hanya yang di bawah ambang step-up; yang ≥ ambang diproses satu per satu). Di HP: daftar → layar penuh detail dengan tombol aksi menempel di bawah; swipe antar dokumen; deep link dari WA langsung ke detail dokumen (bukan ke daftar).

**F. Finance workspace** — tab tahap dengan hitungan; tiap tabel: sortir, filter brand/vendor/jatuh tempo, pencarian, kolom aging; panel detail di sisi kanan (tanpa pindah halaman); pintasan keyboard (J/K naik-turun, Enter buka, V verifikasi, dst.).
- *Pajak:* form yang sama dengan modal lama (gross, diskon, biaya lain, PPN, jenis PPh) + hitung langsung; tombol "Loloskan" dan "Kembalikan ke PIC" (alasan wajib); dokumen yang diajukan oleh user sendiri ditandai dan dikunci.
- *TTD:* Fase 1–2 awal = alur lama (cetak voucher → upload scan + centang siapa yang TTD); Fase 2 target = **e-approve oleh Fin Mgr/CFO sendiri** (login, step-up, jejak identitas yang benar) — menggantikan wet signature (lihat R-17: sekarang yang tercatat sebagai approver L4/L5 adalah orang yang meng-upload, bukan penandatangan).
- *Jurnal:* tabel bulk dengan cascading COA 5 level yang sama; "isi sama untuk yang dicentang"; validasi kombinasi COA terhadap master; ringkasan sebelum kunci.
- *Treasury:* tabel dengan nominal per baris, tanggal & rekening sumber massal, indikator overpay merah, total batch, **pratinjau batch + idempotency**; modal bayar tunggal dengan riwayat cicilan; setelah sukses tampil bukti (ID pembayaran, ref).
- *Export:* rentang tanggal (WIB) + jenis; hasil = file di Shared Drive + tombol unduh; **riwayat export** (siapa, kapan, rentang, jumlah entry) — menggantikan "buat file baru tiap klik" yang sekarang tidak meninggalkan jejak selain Audit_Log.

**G. Voucher & cetak** — paritas visual `Print_Form.html` (A4, kotak TTD dari `buildSignatureBlocks`, CFO hanya muncul bila wajib); tombol *Cetak voucher / invoice / keduanya*. Fase 3: unduh PDF.

**H. Vendor** — daftar + status (Pending/Approved/Rejected) + pencarian; form daftar (validasi no. rek. 6–20 digit, cek duplikat rekening real-time **tanpa membocorkan** detail vendor lain ke non-Finance); antrean pengesahan untuk Finance menampilkan **perbandingan & peringatan** (rekening mirip vendor lain, NPWP kosong), aksi by kode vendor.

**I. Laporan & audit** (baru) — Aging AP (0–30/31–60/>60 hari dari jatuh tempo), outstanding per vendor, pengeluaran per brand/dept/COA/budget per periode, log pembayaran; ekspor CSV. Viewer audit read-only dengan filter. Semua dihitung dari data yang sama (tidak ada angka ringkasan terpisah yang bisa selisih).

**J. Admin** — user (cari, ubah level/brand/dept lewat form yang menulis ke Master_User_TTD, nonaktifkan = kolom Aktif=NO, kirim link set-password, lihat sesi aktif & paksa logout), health (cek header, `validateStruktur`, `auditDataIntegrity`, rekonsiliasi — aksi repair selalu: snapshot dulu → konfirmasi → jalankan → laporan).

### 7.5 Design system

Token awal dibawa dari `CSS.html`/halaman lama supaya terasa kontinu: header gelap `#1b1f24`, "stat-pill" untuk brand/dept, `cfo-flag` merah untuk gate CFO, angka uang `font-variant-numeric: tabular-nums`. Komponen inti: `StatusBadge`, `MoneyCell`, `CfoFlag`, `Stepper`, `DocTimeline`, `FileViewer`, `ConfirmMoneyDialog` (ringkasan + step-up), `DataTable` (sortir/filter/bulk bar dengan total), `EmptyState`, `ErrorState(requestId)`, `Toast`. Light mode dulu; dark mode opsional Fase 3.

### 7.6 Perbaikan UX yang langsung didapat dari temuan di kode lama

| Masalah di sistem lama | Perbaikan |
|---|---|
| `google.script.run` = tidak ada status progres; upload lambat tanpa kejelasan (timer manual di `JS_Main.html`) | Progress upload nyata, optimistic UI, skeleton |
| Cascade Brand→Dept→PIC dengan `setTimeout 300` saat edit | State form tunggal (react-hook-form), data org di-cache klien |
| Navigasi antar "halaman" lewat `window.top.location` & `getScriptUrl()` (iframe sandbox) | Routing Next.js normal, URL bisa dibagikan/bookmark |
| Link Drive langsung ke approver (tak bisa dibuka tanpa akun Google) | Pratinjau lampiran di dalam app (proxy) |
| Duplikat invoice baru ketahuan saat Simpan | Cek inline saat mengetik |
| Bulk finance: hasil sebagian-berhasil hanya teks panjang di dialog | Tabel hasil per item (berhasil/gagal + alasan) |
| Tidak ada riwayat/penelusuran dokumen selain cetak voucher | Detail + timeline + Ctrl+K |
| Tidak ada laporan | Modul laporan (7.4.I) |

---

## 8. Notifikasi & pekerjaan terjadwal

| Fungsi lama | Padanan baru | Catatan |
|---|---|---|
| `kirimWA_` (UrlFetchApp) | `lib/wa.ts` (fetch ke `WA_GATEWAY_URL` + `X-API-Key`), tak pernah melempar ke pemanggil | Retry terbatas + antrean ringan di Redis; dikirim **di luar lock** (I15) |
| `kirimDigestApproval/Finance` (trigger jam) | `GET /api/cron/digest` | Isi pesan tetap: ringkasan per manager + kode `SETUJU/TOLAK` **hanya untuk dokumen < Rp 5 jt** (≥ 5 jt: tanpa kode, link ke web — D9), ringkasan Finance berisi link ke dashboard; link kini mengarah ke detail dokumen di web app |
| `notifPICDisetujui_`, `notifPICDikembalikan_` | event handler setelah commit | Tetap WA ke PIC |
| `bersihkanWAPending` | `GET /api/cron/housekeeping` | Dengan state di Redis (TTL otomatis), tinggal membersihkan sisa & Idempotency key |
| *(baru)* notifikasi in-app | tabel ringan di Redis + endpoint `/api/notifications` | Pusat notifikasi + badge, tidak menggantikan WA |
| *(baru)* backup harian | `GET /api/cron/backup` | Salin spreadsheet ke folder Drive backup (7 harian + 4 mingguan) — RPO 24 jam (lihat 9.3) |

---

## 9. Skala & keandalan

### 9.1 Estimasi beban (berdasar asumsi 2.4)

- 600 pengajuan/bulan ≈ 30/hari kerja → tiap pengajuan melewati ±8 aksi tulis (draft, submit, approve, pajak, TTD, jurnal, bayar×1–2, audit) ≈ **250 mutasi/hari**, jauh di bawah kapasitas bila di-*batch* (1 mutasi = 1 `batchUpdate`).
- Puncak: 20 user bersamaan membuka daftar ≈ 20–60 request app/menit, dominan cache hit. Baca ke Sheets ≈ 6–15/menit (4.2). Tulis ke Sheets ≈ ≤ 10/menit saat jam sibuk. Anggaran 60/60 aman **dengan** cache + batching; **tanpa** keduanya (meniru pola sistem lama: baca 48 kolom penuh tiap panggilan, tulis sel per sel) akan melanggar kuota dalam hitungan detik saat bulk finance.
- Redis (Upstash free 500K command/bulan ≈ 16K/hari): lock (3–4 command/aksi) + cache (pipelined) + rate-limit ≈ perkiraan 5–10K/hari pada beban di atas — dekat dengan batas free; rencana: pantau, naik ke PAYG ($0,2/100K) bila perlu (biaya sepele).
- Ukuran Sheet: Trx_Pengajuan 48 kolom × 7.200 baris/tahun ≈ 350K sel; batas Google 10 juta sel/spreadsheet → aman bertahun-tahun; yang menjadi masalah duluan adalah **latensi baca penuh**, bukan batas sel — makanya baca selalu kolom/rentang terbatas dan arsip tahunan (pindahkan transaksi Paid > 18 bulan ke tab/file arsip) dijadwalkan di Fase 3.

### 9.2 Mode gagal & respons

| Gagal | Dampak | Respons |
|---|---|---|
| Google 429 (kuota) | Tulis/baca tertunda | Retry budget kecil (≤ 2 retry/≤ 5 dtk, backoff eksponensial + jitter), pembatas laju global, stale-if-error untuk baca (4.3b), `UPSTREAM_BUSY` ke UI; **tulis uang tidak pernah dari cache** |
| Panggilan Google menggantung/lambat (ekor) | Aksi lama, lock tertahan | Timeout keras 8–10 dtk per panggilan, deadline guard sebelum flush; timeout tulis = hasil ambigu → baca-ulang berdasar Idempotency-Key (4.3) |
| Sheets/Drive down | Tidak bisa tulis | Mode read-only dari cache + banner; antrean WA tetap; tidak ada tulis buffer lokal yang bisa mengakibatkan data ganda |
| Redis down | Lock/cache hilang | **Tulis uang ditolak (fail-closed)** — tanpa lock tidak aman; baca jalan langsung ke Sheets dengan pembatasan rate; alarm |
| Fungsi time-out di tengah (300 dtk Hobby) | Flush batch atomik: belum tereksekusi = tidak ada efek | Retry aman lewat idempotency key |
| Lock macet (instance mati) | Dokumen terkunci | TTL otomatis ±30 dtk + deadline guard (4.3) |
| Header sheet berubah | Risiko tulis salah kolom | Mode read-only + alarm (4.1) |
| Webhook WA dobel/replay | Aksi ganda (signature valid dapat diputar ulang; gateway tanpa anti-replay) | Dedup message id + batas umur `messageTimestamp` + `STATUS_FLOW` + kode sekali pakai |
| Webhook WA hilang (gateway tanpa retry; endpoint lambat/mati/Redis down) | Perintah `SETUJU/TOLAK` tidak tercatat, pengirim tak tahu | Balasan eksplisit ke pengirim, dead-letter + alarm, dashboard/digest sumber kebenaran, ganti URL saat cutover di jam sepi |
| Vercel/region outage | App tidak tersedia | Apps Script lama tetap sebagai cadangan baca sampai N minggu setelah cutover (R-25) |

### 9.3 Backup & pemulihan

- Version history Google Sheets (bawaan) + salinan harian otomatis ke folder backup di Shared Drive (cron). Sebelum aksi repair/migrasi: snapshot manual otomatis.
- `Audit_Log` dan `Trx_Payment_Log` append-only; rekonsiliasi `Trx_Pengajuan.TOTAL_PAID` vs log dijalankan terjadwal (`reconcilePayments` versi baca-saja → alarm bila selisih), sehingga korupsi ketahuan dalam hari, bukan saat audit.
- Kerahasiaan salinan: folder backup mewarisi izin Shared Drive; DLP (2.5) bisa dipasang di sana.

### 9.4 Observabilitas & alarm

Dashboard internal `/admin/health` + notifikasi WA/email ke Admin untuk: persentase 429 Google > 5% / 10 mnt, lock gagal didapat > 3×/mnt, mismatch header sheet, rekonsiliasi pembayaran selisih, webhook ditolak berulang, kegagalan login beruntun, cron tak jalan > 25 jam. Karena runtime log Hobby cuma 1 jam, log drain ke penyimpanan eksternal dipasang **sejak hari pertama trial**.

---

## 10. Rencana migrasi per fase

Ukuran relatif: S (beberapa hari) · M (1–2 minggu) · L (3+ minggu) — perkiraan kasar, dikalibrasi ulang setelah Fase 0.

| Fase | Isi | Ukuran | Kriteria selesai (exit) |
|---|---|---|---|
| **0 — Spike & fondasi** | Spike S1–S8 (bagian 13); skrip pembuat **salinan dummy** (anonimisasi: nama vendor, no. rekening, NPWP, nomor HP → nomor uji, email → alias uji); repo, CI, env Preview/Prod, Sentry, log drain; schema registry + `SheetsRepo` + Redis lock + Drive upload lolos contract & race test | M | Semua spike punya hasil tertulis; race test hijau; angka kuota nyata terukur |
| **1 — Auth + Ajukan + Approval** | Login/set-password/lupa password/sesi; master read; PO lookup; wizard pengajuan; daftar & detail; submit (I9–I12); inbox approval + step-up; webhook & digest WA (state di Redis); voucher cetak | L | Semua invarian I1–I3, I6, I8–I15 punya test hijau; UAT dengan 3 PIC + 2 Manager di data dummy; approval via web **dan** via WA berjalan pada dokumen yang sama tanpa bentrok |
| **2 — Finance** | Antrean 4 tahap; verifikasi pajak; TTD (kompat. lalu e-approve L4/L5 — **butuh keputusan O4**); jurnal bulk; treasury bulk + idempotency; return ke PIC | L | I4, I5, I6, I16 hijau; simulasi 30 pembayaran bulk tanpa melewati kuota; uji bayar ganda/klik ganda; UAT dengan 2 Finance Staff + Fin Mgr + CFO |
| **3 — Vendor, Master, Export, Laporan, Admin** | Vendor register/approve (maker-checker); admin users/master/health; export Odoo + riwayat; laporan & viewer audit; arsip tahunan; (opsional) PDF voucher, dark mode | M–L | I7, I16, I17 hijau; skrip repair/health setara `Repair.gs`; laporan cocok dengan perhitungan manual contoh |
| **4 — Go-live** | **Upgrade ke Vercel Pro** (ToS); ganti ke Spreadsheet & Shared Drive produksi (akses hanya service account + admin); pindah cron ke Vercel Cron; pen-test ringan + review keamanan; pelatihan singkat; cutover | M | Checklist go-live (10.2) lengkap |

### 10.1 Lingkungan & data

| Lingkungan | Platform | Data | Catatan |
|---|---|---|---|
| Lokal/Dev | laptop | InMemoryRepo + spreadsheet dev | |
| **Trial (Preview/Hobby)** | Vercel Hobby | **Salinan dummy** + Shared Drive dummy, nomor WA uji | Wajib banner "ENVIRONMENT TRIAL — DATA DUMMY" di UI; tidak ada nomor rekening/NPWP nyata |
| Produksi | Vercel **Pro** | Spreadsheet & Shared Drive produksi | Hanya setelah Fase 4 |

Selama trial, **sistem Apps Script produksi tetap berjalan sendiri di data asli** — tidak ada dual-write, tidak ada risiko ke data nyata (alasan memilih salinan). Konsekuensi: data dummy lama-lama menyimpang dari produksi; refresh dummy bisa diulang kapan pun dengan skrip anonimisasi.

### 10.2 Cutover (Fase 4) — garis besar

1. Freeze tulis di Apps Script (banner "Sistem pindah ke alamat baru"; read-only) di luar jam kerja.
2. Verifikasi header & integritas (`auditDataIntegrity` + validator baru) pada sheet produksi; **backup** salinan penuh.
3. Inisialisasi counter ID dari `max(sheet)`; buat/relink hash password (migrasi lazy 5.2) dan kirim link set-password ke yang belum punya.
4. Arahkan webhook gateway WA ke endpoint baru (HMAC); smoke test approve via WA + web.
5. Pantau 1–2 minggu; Apps Script tetap tersedia read-only sebagai cadangan; baru dinonaktifkan setelah rekonsiliasi bersih.
Rollback = nyalakan lagi tulis di Apps Script + arahkan webhook kembali (karena sheet tetap sumber kebenaran tunggal, tidak ada data yang "terjebak" di sistem baru — keuntungan memakai Sheets).

---

## 11. Trade-off & kapan harus revisit

**Trade-off utama (detail di ADR-001):** Sheets+Drive memberi kontinuitas (tim bisa tetap membuka data, Odoo export & laporan manual tetap jalan, tidak ada migrasi data) dengan harga: kuota rendah, tanpa transaksi/lock/constraint → kita membayar dengan Redis + UoW + cache + pengujian konkurensi yang cermat. Itu **kompleksitas yang sengaja dibeli** supaya keputusan "database = spreadsheet" tetap aman untuk uang.

**Pemicu untuk meninjau ulang ke Postgres (mis. Neon/Supabase) — salah satu cukup:**
- 429 Google > 2% dari request tulis selama 2 minggu berturut-turut setelah cache/batch dioptimalkan dan kenaikan kuota ditolak/tidak cukup.
- p95 aksi tulis > 5 dtk secara konsisten.
- `Trx_Pengajuan` > 50.000 baris aktif (belum diarsipkan) atau > 100 user bersamaan.
- Kebutuhan baru yang butuh query relasional (laporan multi-dimensi realtime, rekonsiliasi bank otomatis).
- Insiden integritas data (selisih TOTAL_PAID vs log, ID ganda) yang akar masalahnya batas Sheets.
Antisipasi: `PostgresRepo` + skrip `sheets → postgres` dengan Sheets jadi mirror laporan (opsi C di ADR).

**Yang gw tinjau lagi saat sistem tumbuh:** pindah cache ke tingkat per-user, antrean tulis (queue) untuk mengurai puncak bulk, pemisahan layanan WA, rotasi ke WIF penuh bila JSON key diblokir, hash-chain di Audit_Log untuk bukti anti-modifikasi.

---

## 12. Keputusan terbuka → status per 2026-10-07

| # | Pertanyaan | Rekomendasi gw | Dampak bila beda |
|---|---|---|---|
| O1 ✅ | Skala nyata: jumlah user, user bersamaan, volume pengajuan/bulan, ukuran PDF invoice terbesar (bagian 2.4) | Konfirmasi angka | Mengubah anggaran kuota & batas 4 MB |
| O2 ✅ | Tenant Workspace: apakah pembuatan **service account key** diizinkan (org policy)? Shared Drive aktif? Siapa admin yang bisa menyetujui | Cek lewat S7 | Pilihan autentikasi (JSON key vs Workload Identity Federation) |
| O3 ✅ | Peran **Admin** (Level 9 di Master_User_TTD) | Setuju | Alternatif: tab `Master_Admin` terpisah |
| O4 ✅ | Fase 2: **e-approve Level 4/5 menggantikan TTD basah?** Dan apakah scan TTD basah tetap boleh sebagai jalur paralel sementara | e-approve, jalur lama dimatikan setelah masa transisi | Menyentuh kontrol uang → minta konfirmasi eksplisit; lihat R-17 |
| O5 ✅ | Tambah pemisahan tugas: (a) approver L2 ≠ pembuat dokumen; (b) pembayar ≠ verifikator pajak ≠ pengunggah TTD | (a) ya — celah nyata di `managerApprove`; (b) pertimbangkan, minimal peringatan | Mengubah perilaku sekarang → butuh persetujuan lo |
| O6 ✅ | Tanggal ditulis sebagai sel tanggal (default) atau teks ISO | Sel tanggal | Kompatibilitas laporan/pivot di Sheet |
| O7 ✅ | Kebijakan password: minimal 8 (sekarang 6) | 8 | Link lama yang minta 6 |
| O8 ✅ | ~~OTP ≥ Rp 5jt: email atau WA~~ → **DIJAWAB 2026-10-07 (D9):** tanpa email; approval WA ≥ Rp 5 jt dimatikan (wajib web + konfirmasi password) | – | Perubahan perilaku I14; dicatat di R-16/R-34 |
| O9 ✅ | Login Admin dengan Google SSO (Enterprise) sebagai tambahan di Fase 3? | Pertimbangkan, tidak wajib | Tidak mengubah D5 untuk user lain |
| O10 ✅ | Retensi & arsip: transaksi Paid dipindah ke arsip setelah berapa bulan | 18 bulan | Ukuran sheet |
| O11 ✅ | Upload lampiran: **langsung browser→Drive** (sesi resumable; terbukti S3; tanpa batas 4 MB; perlu konfirmasi server + penanganan putus jaringan) atau **lewat fungsi ≤ 4 MB** (lebih sederhana; wajib kompres di klien) | Langsung ke Drive sebagai jalur utama | Menentukan batas ukuran file & kerumitan frontend |
| O12 ✅ | Timeout aksi uang: bila Google lambat > 8–10 dtk, tampilkan "sistem sibuk, coba lagi" (gagal cepat) — setuju, atau lebih suka user menunggu lebih lama | Gagal cepat | Pengalaman saat lonjakan; keamanan uang tidak berubah |

**Status keputusan (2026-10-07):** user menyerahkan keputusan ke rekomendasi ("gw ikutin lu") — semua O1–O12 di tabel di atas **mengikuti kolom "Rekomendasi gw"**, kecuali yang sudah dijawab eksplisit: O1 (≤ 60 user, ≤ 600 pengajuan/bulan), O2 (key service account diizinkan, Shared Drive aktif — terbukti S0/S7), O8 (D9: tanpa email OTP; approval WA ≥ Rp 5 jt dimatikan). Ringkas: O3 Level 9 = Admin · O4 e-approve L4/L5 menggantikan TTD basah (jalur scan dimatikan setelah masa transisi) · O5 (a) approver L2 ≠ pembuat dokumen **ya**, (b) pembayar ≠ verifikator pajak ≠ pengunggah TTD **minimal peringatan + penanda di audit** (bukan blokir) · O6 sel tanggal · O7 password minimal 8 · O9 Google SSO Admin opsional (Fase 3) · O10 arsip 18 bulan · O11 upload langsung browser→Drive sebagai jalur utama · O12 aksi uang gagal cepat.

> **Catatan jujur:** O4 dan O5 **mengubah perilaku kontrol uang** sistem lama (R-17, R-18, R-19). Dicatat sebagai disetujui lewat delegasi; **konfirmasi eksplisit final tetap diminta sebelum Fase 2** (gerbang di risk register), dan keputusan tetap bisa dibalik user kapan pun sebelum kode terkait ditulis.

---

## 13. Spike teknis Fase 0 (membuktikan asumsi sebelum membangun)

| ID | Pertanyaan | Cara uji | Hasil yang dibutuhkan |
|---|---|---|---|
| S1 | Berapa baca/tulis Sheets nyata per aksi & per menit pada beban 20 user simulasi? Apakah 60/60 cukup? | Skrip beban (k6) terhadap spreadsheet uji + metrik 429 | Angka p95 + keputusan perlu/tidak ajukan kenaikan kuota |
| S2 | Apakah `spreadsheets.batchUpdate` (updateCells+appendCells lintas tab) benar-benar atomik saat satu request invalid / gagal di tengah? | Uji sengaja (request ke-N invalid) | Konfirmasi atomik atau desain kompensasi |
| S3 | Upload resumable langsung dari browser ke Drive (sesi dibuat server) bisa dari origin Vercel? CORS/kuota? | Prototipe | Layak / tidak (menentukan batas 4 MB) |
| S4 | Respons streaming Vercel untuk file > 4,5 MB: lolos atau terpotong? | Prototipe route stream Drive | Menentukan perilaku invoice besar |
| S5 | Latensi Upstash dari region fungsi Vercel; konsumsi command nyata per aksi | Ukur | Pilih region, perkiraan biaya |
| S6 | Format signature webhook gateway Lixus (algoritma, encoding, yang ditandatangani, timestamp) | Baca spesifikasi/ tanya vendor + uji request nyata | Implementasi HMAC yang benar |
| S7 | **Tenant Workspace Enterprise**: Shared Drive aktif? Kebijakan service-account-key? Delegasi domain tersedia? Audit log Drive tersedia? | Cek Admin console + coba buat SA & key di proyek GCP | Pilihan auth Google (key vs WIF) + penyedia email OTP |
| S8 | Waktu cold start & ukuran bundle di Hobby; build/deploy 100/hari cukup? | Deploy percobaan | Anggaran performa |

**Status per 2026-10-06 (hasil lengkap di `claude/spike-results.md`):**

| ID | Status | Ringkas |
|---|---|---|
| S0 | ✅ selesai | Koneksi Sheets + Shared Drive (7/7 PASS); service account key diizinkan |
| S1 | ✅ selesai | Kuota cukup untuk beban target (0× 429); 10× kena 429 → rancangan degradasi di 4.3b; dari Vercel Sheets baca p50 365 ms, tulis 364 ms |
| S2 | ✅ selesai | batchUpdate atomik untuk kegagalan validasi (18/18); RAW/`stringValue` wajib (R-06 terbukti) |
| S2b | ✅ selesai | Race plafon PO terbukti (bocor Rp 8 jt tanpa lock); lock Redis → tepat 10 diterima, Rp 90 jt |
| S3 | ✅ selesai | Upload langsung browser→Drive 12 & 30 MB lolos, CORS OK (belum: putus jaringan, > 100 MB) |
| S4 | ✅ selesai | Stream > 4,5 MB lolos, request > 4,5 MB 413, file Drive utuh; latensi awal Drive 1–6 dtk bervariasi |
| S5 | ✅ selesai | Redis dari `sin1`: lock p50 5 ms, p95 ≤ 22 ms; primitif lock terbukti |
| S6 | ✅ selesai (jawaban vendor) | Hex HMAC-SHA256 atas raw body; tanpa timestamp/retry/anti-replay; `@lid` di-resolve gateway. Sisa: tanyakan sumber pemetaan LID ke Lixus (R-34) + uji request bertanda tangan asli |
| S7 | ✅ selesai untuk keperluan desain | Key & Shared Drive OK; retensi log Workspace 6 bulan (docs resmi). **Email OTP & DWD tidak diperlukan (D9)**. Sisa non-blocking: ketersediaan audit log Drive di tenant & opsi ekspor (butuh super admin; kontrol tambahan, bukan syarat Fase 1) |
| S8 | ◐ sebagian | Cold start ±0,6 dtk setelah idle; instance berganti antar request; sisa: ukuran bundle |

Hasil spike ditulis sebagai catatan di project (`claude/spike-results.md`), ADR/risk register diperbarui — bukan diam-diam mengubah desain. Perubahan desain akibat spike: 4.3 (TTL/timeout/deadline guard/tanpa state di memori), 4.3b (ketahanan kuota), 4.6 (lampiran asinkron + upload langsung), O11–O12.

**Spike kit:** Fase 0 = `claude/spike-kit-fase0.md` + `claude/spike-kit-source.md` (Node, jalan di laptop); Fase 0b = `claude/spike-kit-0b.md` (Next.js di Vercel Hobby). Semua script menolak jalan di spreadsheet yang judulnya tidak mengandung DUMMY/SPIKE.
