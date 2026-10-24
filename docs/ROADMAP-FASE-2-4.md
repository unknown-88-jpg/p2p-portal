# Roadmap Detail — Fase 2, 3, 4

> Dokumen untuk kolaborator. Turunan dari design doc migrasi (`vercel-migration-design.md` bagian 2, 4, 7, 10, 12), rencana Fase 1, dan perilaku sistem Apps Script lama (source of truth perilaku bisnis).
> **Ini rencana, bukan komitmen jadwal.** Ukuran: S = beberapa hari, M = 1–2 minggu, L = 3+ minggu; dikalibrasi ulang setelah Fase 1 ditutup.
> Nama milestone di sini (F2-x, F3-x, F4-x) sementara; bisa digabung/dipecah saat dikerjakan.

## 0. Prinsip yang berlaku di semua fase

1. Vertical slice: tiap milestone jalan end-to-end di Vercel dengan data DUMMY.
2. Test invarian uang ditulis sebelum/bersama kode; milestone tidak selesai kalau test merah.
3. Domain murni (`src/domain`) tanpa I/O; semua tulis lewat Unit of Work (lock berurut → baca segar → aturan → **satu** `batchUpdate` → invalidasi cache → audit di batch yang sama).
4. Baca fungsi `.gs` lama dari project sebelum menulis ulang; perubahan perilaku hanya yang sudah diputuskan (D9, O3–O12) dan dicatat.
5. Aksi uang: idempotency key wajib, `If-Match`/etag (409 bila berubah), gagal cepat bila lock tidak didapat, gagal tertutup bila Redis mati, tidak pernah dari cache.
6. Setelah tiap milestone: STOP, tunggu review (cadence P8), hasil dicatat di project docs.
7. Dummy-only sampai Fase 4. Tidak ada rahasia/PII di repo, log, atau chat.

---

## FASE 2 — Finance (L)

### 2.0 Gerbang sebelum mulai (WAJIB)

Fase 2 menyentuh kontrol uang. Sebelum satu baris kode Fase 2 ditulis, minta konfirmasi **eksplisit final** dari owner (bukan delegasi "ikut rekomendasi"). **Status 2026-10-24: O4, O5a, O5b dijawab eksplisit oleh pemilik → gerbang terbuka.** I6 dan sumber kas list juga sudah dikonfirmasi (lihat tabel). **Semua keputusan gerbang Fase 2 sudah final.**

| # | Keputusan | Rekomendasi saat ini | Catatan |
|---|---|---|---|
| O4 | e-approve Level 4/5 menggantikan TTD basah | **Keputusan pemilik 2026-10-24 (final)**: **e-approve, cut-off langsung, TANPA masa transisi** — jalur unggah scan TTD basah tidak dibangun di portal baru | Menutup R-17. Konsekuensi: syarat "Link TTD terisi" di `bolehDibayar` (I4) diganti "approval L4 (+ L5 bila CFO wajib) tercatat atas nama penandatangan"; enum status `Wet Signed` tetap (kompat sheet), label tampil "Disetujui Fin. Mgr/CFO" |
| O5a | Approver L2 ≠ pembuat dokumen | **Keputusan pemilik 2026-10-24 (final)**: **ya** (sudah aktif di Fase 1, flag `SOD_APPROVER_NOT_CREATOR`) | Selesai |
| O5b | Pembayar ≠ verifikator pajak ≠ approver L4/L5 | **Keputusan pemilik 2026-10-24 (final)**: **peringatan + penanda audit, bukan blokir** (sesuai rekomendasi) | "Pengunggah TTD" tidak ada lagi (O4 tanpa scan); peringatan berlaku untuk pembayar = verifikator pajak / approver L4/L5 |
| I6 | Pengaju ≠ verifikator pajak | **Keputusan pemilik 2026-10-24 (final): blokir keras** (sama dengan perilaku lama) | Dipindah dari Fase 1 ke Fase 2; diterapkan di F2-B |
| — | Aturan PO (#16 retensi dihapus, #17 I11 dihapus + Full Payment isi otomatis) | **Final** — dikonfirmasi pemilik 2026-10-24 (README M3) | Selesai; tinggal uji ulang U6 dengan aturan baru |
| — | Kas list / rekening sumber bayar | **Keputusan pemilik 2026-10-24 (final): menyatu dengan Master_COA** | Sudah ada di kode: `bangunKas` (`src/domain/master.ts`) = akun COA di bawah "KAS DAN SETARA KAS" (Level 2 struktur baru atau Level 3 struktur lama). Dipakai F2-E |

Sisa dari Fase 1 yang harus tutup dulu: PR `patch2-wa-uat` merge, verifikasi Production (F-13 iPhone, F-12 link kedaluwarsa), pembersihan data dummy, F-16.

### 2.1 Lingkup (parity dengan `API_Finance.gs`)

| Fungsi lama | Route baru | Role |
|---|---|---|
| `getFinanceQueues` | `GET /api/finance/queues?stage=` | L3+ |
| `verifyTax` | `POST /api/finance/:id/verify-tax` | L3 (≠ pengaju) |
| `submitWetSignature` | **Tidak diport** (O4: tanpa jalur scan). Diganti `POST /api/finance/:id/approve` e-approve L4/L5 | L4/L5 |
| `postJournalBulk` | `POST /api/finance/journal` | L3 |
| `executePayment`, `executePaymentBulk`, `bolehDibayar` | `POST /api/finance/:id/pay`, `POST /api/finance/pay-bulk` | L3 |
| `getPaymentHistory`, `getTotalPaidFromLog` | `GET /api/pengajuan/:id/payments` | sesuai akses dokumen |
| `financeReject` | `POST /api/finance/:id/return` | L3 |
| `kirimDigestFinance` | digest WA Finance (ringkasan + link, tanpa kode) | cron |

Status alur: Manager Approved → Tax Verified → Wet Signed → COA Posted → Partially Paid → Paid. Enum tidak berubah, hanya label tampil.

### 2.2 Milestone

**F2-A — Fondasi Finance & antrean (S–M)** — ✅ selesai 2026-10-24 (README §F2-A)
- Capability matrix L3/L4/L5 di service layer (bukan `requireLevel` sama-persis seperti lama).
- `GET /api/finance/queues` per tahap (hitungan, total Rp, aging), kolom ringkas saja (hemat kuota).
- UI `/finance` + tab tahap, tabel sortir/filter/cari, panel detail kanan.
- Exit: matriks authz tiap peran × tahap hijau; level tak berwenang 403.

**F2-B — Verifikasi pajak (M)** — ✅ selesai 2026-10-24 (README §F2-B)
- Form gross/diskon/biaya lain/PPN/PPh; hitung ulang server (`hitungPajak`, golden sudah ada dari M3); CFO flag dihitung ulang (I1).
- **I6** blokir keras server-side (email dinormalisasi) + UI (badge "Ajuan Anda — minta rekan verifikasi").
- "Loloskan" dan "Kembalikan ke PIC" (alasan wajib), keduanya idempotent + etag.
- Exit: I1, I2, I3, I6 hijau; race dua Finance verifikasi dokumen sama → satu berhasil, satu 409.

**F2-C — Persetujuan L4/L5 / TTD (M–L, bergantung O4)**
- **O4 (final 2026-10-24): e-approve saja, tanpa jalur transisi scan.** Fin. Mgr (L4) dan CFO (L5, wajib bila `REQUIRE_CFO`) login sendiri + step-up password + identitas dari sesi (menutup R-17: lama tercatat atas nama pengunggah).
- `bolehDibayar` (I4) tidak lagi mensyaratkan link TTD; diganti approval L4 (+ L5 bila CFO wajib) yang tercatat atas nama penandatangan. Dokumen yang sudah Wet Signed di sistem lama sebelum cutover tetap sah (catatan cutover F4-D).
- `loginApprover` lama menolak level selain 2; di sistem baru login terbuka semua level (sudah, D5).
- Exit: approval L4/L5 tercatat atas nama penandatangan sebenarnya; gate CFO enforced server-side; test urutan L4 → L5.

**F2-D — Jurnal COA bulk (M)**
- Cascading COA 5 level (level tanpa turunan = `-`), validasi kombinasi terhadap `Master_COA`, Sub COA & Budget wajib.
- Bulk: validasi semua item dulu (baca segar sekali), terapkan yang valid dalam **satu batch**, laporan per item (berhasil/gagal + alasan). "Isi sama untuk yang dicentang".
- Exit: bulk 30 dokumen = 1 panggilan tulis; sebagian gagal tidak menggagalkan sisanya; tidak ada baris setengah berubah (fault injection).

**F2-E — Treasury / pembayaran (L, paling berisiko)**
- `bolehDibayar` (I4): status COA Posted/Partially Paid; approval L2, L3, L4 ada; L5 bila CFO wajib; Sub COA, Budget, Link TTD terisi.
- **I5 anti-overpay:** `nominal ≤ sisa + PAYMENT_TOLERANCE (1000)`; total dibayar dihitung dari `Trx_Payment_Log`, bukan kolom ringkasan.
- Cicilan (Partially Paid → Paid), rekening sumber, tanggal bayar; satu batch menulis Payment_Log + ringkasan + status + audit.
- Bayar tunggal dan **bulk** dengan `Idempotency-Key`; klik ganda/retry tidak membayar dua kali; timeout tulis = ambigu → baca-ulang sebelum menulis lagi.
- Step-up password untuk pembayaran; pratinjau batch + total sebelum konfirmasi; modal ringkasan (nominal, vendor, rekening sumber, efek status).
- Peringatan O5b (pembayar = verifikator/pengunggah) + penanda audit.
- Exit: I4, I5 hijau; race 20 paralel pembayaran sisa kecil tidak ada overpay; uji klik ganda; simulasi 30 bayar-bulk tanpa melewati kuota; rekonsiliasi `TOTAL_PAID` vs log nol selisih.

**F2-F — Return ke PIC, riwayat, digest Finance (S–M)**
- `financeReject` → Revision Needed (alasan wajib) + notifikasi PIC.
- Tab Pembayaran di detail dokumen (riwayat cicilan, total terbayar, sisa).
- Digest WA Finance: ringkasan gabungan ("N perlu verifikasi pajak, N perlu jurnal, N siap dibayar") + link dashboard; **tanpa kode SETUJU/TOLAK** (Finance tidak approve via WA).
- Hitungan antrean Finance di `/api/home`.
- Exit: I15 untuk notifikasi Finance; digest tidak menggagalkan transaksi.

**F2-G — Hardening & UAT Finance (M)**
- Uji beban ulang dari Vercel termasuk skenario bulk bayar; review keamanan jalur uang.
- UAT: 2 Finance Staff + Fin. Mgr + CFO, dokumen yang sama dari Submit sampai Lunas, termasuk cicilan, return, dan dokumen ≥ Rp 5 jt.
- Exit (design doc bagian 10): I4, I5, I6, I16 hijau; temuan UAT ditutup/dijadwalkan.

### 2.3 Risiko Fase 2
- Perubahan kontrol uang (O4/O5) tanpa konfirmasi eksplisit → jangan mulai.
- Pembayaran adalah satu-satunya aksi yang tak bisa di-undo di dunia nyata; ambang kehati-hatian tertinggi di sini (fail-closed, tanpa cache, tanpa retry buta).
- Mengganti TTD basah = keputusan compliance, bukan cuma teknis.
- Paritas perhitungan (pajak, plafon) dengan sistem lama: golden test + pencocokan manual 5 dokumen.
- Kuota tulis 60/menit saat bulk besar: satu batch per aksi, bukan satu per item.

---

## FASE 3 — Vendor, Master, Export, Laporan, Admin (M–L)

### 3.1 Lingkup

| Fungsi lama | Route baru | Role |
|---|---|---|
| `submitNewVendor`, `generateVendorID_` | `POST /api/vendors` | PIC+ |
| `getPendingVendors`, `approveVendor(rowIdx)`, `rejectVendor(rowIdx)` | `GET /api/vendors?status=pending`, `POST /api/vendors/:kode/{approve,reject}` (**by kode, bukan nomor baris** — R-21) | L3 (≠ pendaftar) |
| `exportJurnalOdoo` | `POST /api/finance/export/odoo` + riwayat | L3, L4, Admin |
| `validateStruktur`, `diagnosaEmail`, `kenapaAkuDitolak`, `clearMasterCache` | `/admin/health`, `/admin/users`, `POST /api/admin/cache/clear` | Admin |
| `auditDataIntegrity`, `repairNoRekening`, `reconcilePayments`, `cekBarisHantu`, `diagnosaKecepatan` | `/admin/health` (audit baca-saja dulu; repair = snapshot → konfirmasi → jalan → laporan) | Admin |
| `kirimLinkSetPassword*` (admin-run editor) | `POST /api/admin/users/:id/send-setpass` (+ bulk) | Admin |
| (baru) laporan, viewer audit, pusat notifikasi, profil | `/laporan`, `/audit`, `/notifikasi`, `/profil` | sesuai peran |

### 3.2 Milestone

**F3-A — Vendor register & approve (M)**
- Daftar vendor: validasi rekening 6–20 digit; **I7** rekening (bank+no) unik — lock `vendor-rek:`; cek duplikat real-time tanpa membocorkan detail vendor lain ke non-Finance.
- Maker-checker: pendaftar ≠ pengesah. Approve/reject **by kode vendor** (R-21).
- Antrean pengesahan Finance dengan peringatan (rekening mirip vendor lain, NPWP kosong).
- ID `VND-xxxx` via `INCR` dalam lock `seq:VND`, bootstrap dari max sheet.
- Exit: I7, I8 hijau; race pendaftaran rekening sama; pendaftar tidak bisa mengesahkan sendiri.

**F3-B — Export Odoo (M)**
- Dua jenis jurnal (pembelian, pembayaran); filter `DATE_INVOICE` (fallback timestamp), batas hari **WIB** (bukan UTC server).
- Output file ke Shared Drive + unduh; **riwayat export** (siapa, kapan, rentang, jumlah entry). CSV di-escape terhadap formula injection.
- Golden test: hasil identik dengan `Export_Odoo.gs` lama untuk set dokumen contoh.
- Exit: I16 hijau; selisih nol terhadap ekspor lama pada dummy.

**F3-C — Admin: user, master, health (M)**
- Peran Level 9 = System Admin (O3). Kelola user (cari, ubah level/brand/dept via form yang menulis ke `Master_User_TTD`, nonaktifkan, kirim link set-password, paksa logout sesi).
- Master: org/entitas/COA/PPh read + validator (edit tetap di Sheet pada awal).
- `/admin/health`: validasi header, `validateStruktur`, `auditDataIntegrity`, rekonsiliasi pembayaran (baca-saja + alarm), kesehatan koneksi Sheets/Drive/Redis/WA, status cron terakhir.
- Aksi repair selalu: snapshot → konfirmasi → eksekusi → laporan.
- Exit: setara `Repair.gs`/`Diagnostics.gs`; aksi admin masuk audit.

**F3-D — Laporan & viewer audit (M)**
- Aging AP (0–30/31–60/>60 hari dari jatuh tempo), outstanding per vendor, per brand/dept/COA/budget per periode, log pembayaran; ekspor CSV.
- Viewer `Audit_Log` read-only (filter ID/aktor/aksi/tanggal). Semua dihitung dari data yang sama (tidak ada angka ringkasan terpisah).
- Exit: laporan cocok dengan perhitungan manual contoh.

**F3-E — Arsip, backup, polish (M)**
- Arsip: dokumen Paid > 18 bulan (O10) ke tab/file arsip; ID, audit, dan link tetap bisa ditelusuri.
- Cron backup harian: salin spreadsheet ke folder backup di Shared Drive (7 harian + 4 mingguan). Cron housekeeping (file Drive yatim, idempotency key).
- Opsional: PDF voucher server-side, dark mode, Google SSO untuk Admin (O9), Apps Script `onEdit` → `/api/cache/bust`, Ctrl+K menyeluruh, pusat notifikasi in-app.
- Exit: restore dari backup dicoba sekali; arsip tidak merusak laporan.

### 3.3 Risiko Fase 3
- Repair/admin action = risiko merusak data produksi → snapshot dulu, selalu.
- Skala Sheets: latensi baca penuh muncul sebelum batas sel → baca kolom terbatas, arsip tepat waktu.
- Edit manual di Sheet oleh admin → cache basi (R-07) → bust cache.
- Pemicu revisit ke Postgres (design doc bagian 11) dievaluasi dengan data nyata di akhir fase.

---

## FASE 4 — Go-live (M)

### 4.1 Prasyarat
- Fase 2 dan 3 selesai dan UAT bersih.
- **Upgrade Vercel Pro** (Hobby non-komersial per ToS; seat = developer yang deploy).
- Keputusan penanggung jawab go-live dan jendela cutover (di luar jam kerja).

### 4.2 Pekerjaan

**F4-A — Infrastruktur produksi**
- Spreadsheet & Shared Drive produksi; akses hanya service account (Editor) + 2–3 admin + auditor (Viewer). Tambahkan ID sheet prod ke `PROD_SHEET_IDS`; `APP_ENV` produksi; hapus guard/banner trial.
- Upstash **terpisah** dari `p2p-spike` (nama/DB baru), hitung ulang kuota dengan pengguna nyata (free 500K/bln vs PAYG).
- Env var Preview vs Production terpisah; rotasi: kunci service account baru, `JWT_SECRET`, `CRON_SECRET`, API key WA consumer baru; **cabut consumer/kunci lama** (`payment-approval-we`, `p2p-portal-trial`) dan kunci spike.
- Pindahkan digest dari GitHub Actions ke Vercel Cron per-menit (kode route sama); nonaktifkan workflow lama.
- Sentry/log drain tujuan final; alarm (429 > 5%/10 mnt, lock gagal > 3×/mnt, header mismatch, rekonsiliasi selisih, login gagal beruntun, cron tak jalan > 25 jam).

**F4-B — Keamanan & kualitas**
- Review keamanan menyeluruh + pen-test ringan (CSP, CSRF, enumerasi nomor, throttle, redaksi log, authz matriks).
- ~~Perbaiki desain throttle `setpass` global~~ — selesai 2026-10-24 (`SETPASS_RULE`: per IP 10, plafon global 500 / 15 mnt).
- Uji beban ulang dengan Pro, region sin1.
- Ukuran bundle, a11y dasar, cek F-02 (cetak gabungan invoice PDF), F-13 (iOS print) tuntas.

**F4-C — Migrasi data & akun**
- Inisialisasi counter ID dari `max(sheet)` (bukan menyalin `SEQ_*` Script Properties — R-27).
- Verifikasi header & integritas sheet produksi (`auditDataIntegrity` + validator); **backup penuh** sebelum cutover.
- Kirim link set-password ke yang belum punya; bersihkan baris user dummy; cek nomor HP semua akun (kasus F-16).
- Bandingkan 5 voucher dengan sistem lama (exit M7 yang tersisa).

**F4-D — Cutover**
1. Freeze tulis di Apps Script (banner "pindah alamat", read-only), di luar jam kerja.
2. Verifikasi + backup (lihat F4-C).
3. Arahkan webhook gateway Lixus ke endpoint baru (HMAC); smoke test approve via WA + web; hapus allowlist trial.
4. Pantau 1–2 minggu; Apps Script tetap read-only sebagai cadangan; matikan setelah rekonsiliasi bersih.

**Rollback:** sheet tetap sumber kebenaran tunggal sehingga data tidak terjebak. Catatan penting: **lazy-migrate hash password ke scrypt tidak bisa dibalik** — user yang sudah login di sistem baru butuh link set-password baru bila kembali ke Apps Script. Masukkan ke checklist.

**F4-E — Pelatihan & hypercare**
- Pelatihan singkat per peran (PIC, Manager, Finance, CFO, Admin), panduan 1 halaman.
- Hypercare 2 minggu: pantau error, kuota, WA, rekonsiliasi harian; jalur laporan masalah (requestId di toast).

### 4.3 Checklist go-live (ringkas)
- [ ] Semua invarian I1–I17 punya test hijau
- [ ] Vercel Pro aktif; env produksi terisi dan terpisah dari Preview
- [ ] Spreadsheet/Shared Drive produksi, akses terkunci; `PROD_SHEET_IDS` benar
- [ ] Upstash produksi terpisah; kuota dihitung
- [ ] Rahasia lama dirotasi/dicabut; tidak ada rahasia di repo/log
- [ ] Backup penuh + restore teruji
- [ ] Webhook WA diarahkan, smoke test lulus; allowlist trial dilepas
- [ ] Cron produksi aktif, alarm aktif
- [ ] Rencana rollback dibaca semua pihak (termasuk catatan hash)
- [ ] Pelatihan selesai; penanggung jawab hypercare ditunjuk

---

## Ringkasan ketergantungan

```
Fase 1 selesai (PR merge + verifikasi Prod + cleanup dummy)
   └─ Gerbang O4/O5 (konfirmasi eksplisit)
        └─ Fase 2: F2-A → F2-B → F2-C → F2-D → F2-E → F2-F → F2-G
             └─ Fase 3: F3-A, F3-B, F3-C, F3-D (sebagian paralel) → F3-E
                  └─ Fase 4: F4-A/B/C → F4-D (cutover) → F4-E
```
F3-A (vendor) tidak bergantung pada Fase 2 kecuali pilihan dummy; boleh dimajukan bila ingin, atas keputusan owner.

## Keputusan terbuka yang perlu jawaban owner

1. ~~O4~~ — final 2026-10-24: e-approve L4/L5, cut-off tanpa transisi.
2. ~~O5b~~ — final 2026-10-24: peringatan + penanda audit (bukan blokir).
3. ~~Konfirmasi final aturan PO #16/#17~~ — sudah final (pemilik, 2026-10-24).
4. ~~Sumber data kas list~~ — final 2026-10-24: menyatu dengan Master_COA (`bangunKas`).
5. Opsional: Google SSO Admin (O9), PDF server-side, dark mode.
6. Tanggal target go-live dan jendela cutover.
