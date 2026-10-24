# RENCANA IMPLEMENTASI FASE 1 — Auth + Ajukan + Approval

**Status:** DISETUJUI (2026-10-08, "gw ikutin lu") — M0 dimulai. Keputusan: P1 = zip per milestone (user yang push/deploy); P2 = O5a ya, dipasang sebagai flag `SOD_APPROVER_NOT_CREATOR` default ON + penanda audit; P8 = berhenti & tunggu review user setelah tiap milestone. P3–P7 menyusul sesuai milestone.
**Dasar:** `claude/vercel-migration-design.md` (bagian 4, 5, 6, 7, 10, 12), `claude/spike-results.md`, `claude/vercel-migration-risk-register.md`.
**Ukuran:** S = beberapa hari · M = 1–2 minggu · L = 3+ minggu (kasar; dikalibrasi ulang setelah M1).

---

## 1. Cara kerja

1. **Vertical slice per milestone**: tiap milestone bisa dijalankan end-to-end di Vercel Hobby (data DUMMY), bukan "semua backend dulu baru UI".
2. **Test dulu untuk invarian uang.** Untuk tiap invarian di bagian 4, test ditulis sebelum/bersama kodenya; milestone tidak dianggap selesai kalau test-nya merah.
3. **Domain murni, I/O di pinggir.** `src/domain` tidak boleh meng-import apa pun dari `infra`/`repo` (dipaksa ESLint boundaries). Itu yang menjaga jalan ke Postgres tetap terbuka (ADR-001).
4. **Perilaku lama = acuan.** Sebelum menulis ulang fungsi `.gs`, gue baca fungsinya lagi dari project (source of truth), bukan dari ingatan. Perubahan perilaku hanya yang sudah diputuskan (D9, O3–O7).
5. **Dummy-only terkunci di kode:** `APP_ENV=trial` menolak Spreadsheet ID yang tidak berjudul DUMMY/SPIKE + banner UI "ENVIRONMENT TRIAL — DATA DUMMY".
6. **Pengiriman:** gue menulis kode di workspace cloud, kirim per milestone sebagai zip (seperti spike kit) atau — kalau lo kasih repo — sebagai commit. Lo yang deploy ke Vercel (lihat bagian 6, keputusan P1).

## 2. Struktur repo (usulan)

```
src/
  domain/        # TS murni: status flow, hitungPajak, plafon PO, SoD, step-up rules, threshold WA
  repo/          # port (interface) + SheetsRepo + InMemoryRepo + schema registry + coercer
  infra/         # redis (lock, cache, idempotency, ratelimit, otp/kode WA), google (auth, sheets, drive), wa, logger (redaksi), sentry
  server/        # service layer (UoW: lock→baca segar→domain→batch→invalidate), authz capability
  app/           # Next.js App Router: pages + app/api/* route handlers (zod di tepi)
  ui/            # komponen (shadcn), wizard, inbox, detail
scripts/         # anonymize-dummy, seed, check-headers, golden-export
tests/           # unit (domain), contract (repo), race, fault-injection, e2e (Playwright)
```

Aturan tegas: route handler hanya parse → authz → panggil service → map error. Tidak ada logika bisnis di route atau komponen.

## 3. Milestone

### M0 — Fondasi (S–M) — ✅ SELESAI 2026-10-08 (kode `p2p-portal-m0.zip`; 42 test hijau di mesin user; salinan DUMMY disiapkan: header 8/8 OK, DB_PO/DB_SJ dibekukan, data teranonimkan, seed user/vendor/Kode Vendor). Sisa kecil non-blocking: Sentry/log drain (P6), `/api/health` belum dipanggil di deploy nyata (butuh env Vercel), hapus tab `Spike_*`/`_REPAIR_REPORT` bila tak perlu, nomor WA uji (P4) menyusul di M6.
- Repo, TS strict, ESLint boundaries, Vitest, Playwright skeleton, CI (lint+typecheck+unit).
- Env per lingkungan (Preview vs Production terpisah), `lib/env.ts` tervalidasi zod (gagal start bila rahasia kurang).
- Format error seragam + `requestId`, logger dengan **redaksi** (nomor HP, no. rekening, password, kode, URL sesi upload, `messageSecret`), Sentry + log drain (log Hobby cuma 1 jam).
- Schema registry semua tab Phase 1 (urutan kolom lama persis), validator header → mode read-only + alarm.
- **Skrip anonimisasi** salinan dummy (nama vendor, rekening, NPWP, nomor HP→nomor uji, email→alias) + banner trial.
- **Exit:** CI hijau; `/api/health` memeriksa header tab terhadap registry di spreadsheet dummy; skrip anonimisasi menghasilkan salinan yang lolos validator.

### M1 — Data layer & koordinasi (M) — *paling berisiko, dikerjakan paling awal*
> **Status 2026-10-08: ✅ SELESAI — 93 test hijau di mesin user + `m1-integration` 7/7 lolos terhadap salinan DUMMY & Upstash asli** (diukur dari laptop WSL, BUKAN dari Vercel sin1, jadi latensi lebih tinggi dari spike: lock acquire+holds+release p50 183 ms/p95 760 ms; 8 aksi serial-di-lock 13 s ≈ 1,6 s/aksi; fail-fast uang CONFLICT 2,4 s; tipe data & format DATE_TIME benar; ID unik dan aman saat Redis dibuang). Angka latensi perlu diukur ulang dari Vercel di M4. Catatan lama: `p2p-portal-m1.zip` — 93 test hijau (typecheck + lint + test), termasuk race 20 paralel, plafon PO (tepat 9 dari 20), fault injection (gagal tegas, timeout ambigu berlaku/tidak berlaku), deadline guard, lock hilang, Redis mati (fail-closed), idempotensi, ID generator saat Redis hilang. Mutation check: test terbukti gagal bila lock-sort / holdsAll / collision-check / penanda idempotensi dihapus. **Belum terbukti:** perilaku terhadap Sheets+Upstash sungguhan → `npm run m1-integration` (dijalankan user). Keputusan implementasi: semua aksi tulis (bukan hanya uang) gagal tertutup bila Redis mati; wait lock default uang 2 s / lain 10 s (override `waitMs`); read-back ambigu = scan kolom Notes Audit_Log (jarang; bisa dioptimalkan bila Audit_Log sangat besar); `datetime` jadi tipe kolom baru di schema (format sel `yyyy-mm-dd hh:mm:ss` saat append).
- `SheetsRepo` (batchGet, indeks `id → baris` di Redis + verifikasi saat tulis, RAW/`stringValue`, serial tanggal WIB, `appendCells` di dalam `batchUpdate`).
- Redis: lock NX PX ±30 s + release Lua, lock multi-kunci terurut, fail-fast ≤ ~2 s, cache + single-flight + stale-if-error, token-bucket global (±45/45 per menit), idempotency store 24 jam, ID generator (`INCR` dalam lock + bootstrap dari max sheet).
- Unit of Work: timeout 8–10 s per panggilan Google, **deadline guard** sebelum flush, timeout tulis = ambigu → baca-ulang via Idempotency-Key.
- Audit append-only (I17) dalam batch yang sama dengan mutasi; kegagalan audit **tidak ditelan** (R-32).
- **Exit:** contract test hijau di `SheetsRepo` **dan** `InMemoryRepo`; race test 20 paralel (PO, invoice, rekening, approve ganda) tidak bocor; fault injection (gagal flush / 429 / timeout) tidak meninggalkan baris setengah berubah dan retry tidak menggandakan.

### M2 — Auth (M)
> **Status 2026-10-12: ✅ SELESAI — uji manual lolos di laptop user (WSL) terhadap DUMMY sheet + Upstash asli.** Terbukti: set-password via link sekali-pakai (hash `s1$32768$8$1$…` + salt `s1` tertulis di `Master_User_TTD`), login, logout, login ulang, lockout (5×401 lalu 429, pesan berbeda; audit gagal dibatasi: 1 `LOGIN_FAILED` + 1 `LOGIN_LOCKED` untuk 6 percobaan), lupa-password (balasan identik untuk nomor dikenal/tidak; link hanya untuk nomor terdaftar), reset password (password lama langsung ditolak), audit `ISSUE_SETPASS_LINK`/`SET_PASSWORD`/`LOGIN`/`LOGOUT`/`LOGIN_FAILED`/`LOGIN_LOCKED`/`FORGOT_PASSWORD` dengan nomor ter-mask.
> **Temuan uji manual (semua sudah diperbaiki di patch `m2b`, 161 test):** (a) `SetPasswordForm` gagal membaca token di `npm run dev` — React StrictMode menjalankan effect 2× dan eksekusi ke-2 menimpa token dengan string kosong (bug dev-only, lolos `build`/test); (b) baris `.env` kosong (`WA_GATEWAY_URL=`) gagal validasi → sekarang string kosong = tidak diisi; (c) **oracle timing di `/api/auth/forgot`**: nomor terdaftar 4,6–7,9 dtk vs tidak terdaftar ±1,5 dtk karena token+kirim+audit dikerjakan sebelum membalas → kerja itu dipindah ke `after()` (respons keluar sebelum kerja selesai; test dengan gate + mutation check); (d) format mask nomor di terminal tidak sama dengan audit → disamakan (`maskPhone`); (e) peringatan Turbopack soal lockfile di folder induk → `turbopack.root`.
> **Yang BELUM terbukti / harus ditindaklanjuti:** (1) **Project Apps Script live "P2P Prod" tidak punya `hashPassword_`** (ReferenceError saat dijalankan, 2026-10-08) padahal export di project docs punya bagian E-APPROVER (2026-09-18) → kode live kemungkinan lebih tua dari export, atau Fase 1 belum di-deploy. Vektor hash lama hanya terverifikasi lewat implementasi referensi independen. Cek: `Master_User_TTD` kolom I/J di **prod** (kalau kosong semua, jalur hash-lama tidak akan terpakai) dan cari `E-APPROVER` di `Auth.gs` live. (2) `PROD_SHEET_IDS` saat ini hanya `1Yyz8Y…` (prod, belum ada data); `Config.gs` memakai ID berawalan `1zau0T…` — rekonsiliasi (tambahkan bila sheet lain yang dipakai prod). (3) Latensi terukur dari laptop: login 2–3,5 dtk, forgot 4,6–7,9 dtk (didominasi round-trip Sheets/Redis + mode dev); **ukur ulang dari Vercel di M4** sebelum menilai perlu cache daftar akun. (4) Kotak abu-abu kosong di tepi kiri halaman home saat `npm run dev` — bukan dari kode app (sudah dibaca `page.tsx`/`layout.tsx`/CSS); kemungkinan dev-tools Next atau ekstensi, cek ulang di build produksi. (5) Pastikan token Upstash yang sempat tertempel di chat sudah dirotasi.
> **Deviasi sadar dari design 5.x (alasan):** (1) sesi = token opak di Redis, bukan JWT — `jti` toh wajib dicek ke Redis tiap request, JWT tak memberi keuntungan; `JWT_SECRET` dipakai sebagai pepper HMAC. (2) Audit kegagalan login dibatasi (1 per nomor/15 mnt, maks 10/mnt) — audit tiap kegagalan membuat penyerang bisa menghabiskan kuota tulis Sheets 60/mnt; sisanya ke log terstruktur. Audit login SUKSES wajib (gagal tulis = login gagal). (3) Login terbuka untuk semua level (D5), bukan hanya Level 2 seperti `loginApprover` Fase 1 lama. (4) `canViewDocument` menolak level 99 (lama: `>= 3` meloloskan level tak terbaca). (5) `/api/home` baru memuat identitas + `bisa`; hitungan antrean menyusul M4/M5.
> **Catatan cutover:** lazy-migrate hash ke scrypt **tidak bisa dibalik** — setelah user login di sistem baru, Apps Script lama tidak bisa memverifikasi password-nya; rollback ke sistem lama = user itu perlu link set-password baru. Masukkan ke checklist cutover/rollback. Pengirim link WA = M6 (sementara `DevLinkSender` hanya `APP_ENV=trial`; script `npm run issue-setpass`).
- `POST /api/auth/login|logout|set-password|forgot`, `GET /api/me`.
- scrypt (`s1$…`) + **lazy-migrate hash lama** (SHA-256 ber-salt 3000×) saat login; sesi JWT httpOnly + `jti` revoke di Redis; idle timeout; CSRF (Origin check) + CSP/header keamanan.
- Rate-limit/lockout (5 gagal/15 mnt per nomor+IP), pesan generik, semua login masuk audit.
- Link set-password via WA (token sekali pakai TTL 60 mnt); lupa password self-service (balasan selalu generik).
- **Step-up password** (modal 5.6): endpoint konfirmasi + hasil berlaku 5 menit per sesi, lockout yang sama.
- `getHomeContext` → `/api/home`; roles gabungan lintas baris Master_User_TTD (struktur sheet tidak diubah).
- **Exit:** semua jalur auth punya test; hash lama dari data dummy bisa login lalu otomatis ter-upgrade; percobaan brute-force terkunci.

### M3 — Master, PO, kalkulasi (S–M) — ✅ KODE SELESAI 2026-10-12 (menunggu review user)
> **Hasil M3:** domain murni (`tax.ts`, `po.ts`, `master.ts`) + golden dari **kode lama yang dijalankan apa adanya** (1.230 vektor pajak, 620 plafon, CFO, prefix; BUKAN ekspor produksi). 197 tes hijau, `next build` OK, mutation check: 16 mutasi aturan uang/org terdeteksi (mutan yang tak mengubah hasil pembulatan = ekuivalen). **Keputusan 2026-10-12:** PO tak ketemu / DB_PO tak terbaca saat submit → **TOLAK** (`gatePoSubmit`; enforcement di M4). Beda disengaja dari lama: tarif PPh di luar 0..1 ditolak, Infinity ditolak, kode vendor kosong tak pernah cocok, org tanpa email, input `/api/calc/tax` ketat. Deteksi error IMPORTRANGE dipersempit (kolom kunci semua baris + kolom terpakai baris cocok). **Terbuka:** header asli Master_Setting/COA/PPh belum diketahui (dibaca posisional, `strictHeader:false`); preview pajak pakai tarif cache, submit M4 wajib tarif segar.
> **Temuan 2026-10-08 (dari salinan dummy):** `DB_PO` dan `DB_SJ` di sistem asli adalah **IMPORTRANGE live** dari spreadsheet sistem PO lain (`Trans_PO_Headers`, `Trans_GR_Headers`), bukan data yang ditulis portal. Konsekuensi: (a) nilai error rumus (`#N/A`, `#REF!`, "Loading...") bisa muncul sewaktu-waktu → pembacaan PO/SJ **wajib** memperlakukan error sebagai `UPSTREAM_BUSY` dan menolak submit, bukan menganggap "PO tidak ada"; sistem lama (`assertPOTidakOverbilling_`) justru **meloloskan** submit bila PO tidak ketemu — celah yang harus diputuskan user di M3/M4 (gue sarankan: tolak submit Trade bila PO tidak terbaca); (b) header tab datang dari sumber → validator header menjaga bila sumber mengubah kolom; (c) kolom `Kode Vendor` di DB_PO berisi `#N/A` untuk PO yang vendornya tak punya kode di sumber; (d) salinan dummy harus **dibekukan** (script anonimisasi melakukannya) supaya tidak menarik data nyata.
- `GET /api/master/*` (1 payload org, entitas, COA, kas, PPh) dengan cache + invalidasi.
- `GET /api/po/:poNumber` (`hitungPlafonSJ_` model retensi 90/10, kumulatif non-Rejected, jasa tanpa qty bebas).
- `POST /api/calc/tax` = fungsi murni; **golden test** `hitungPajak` terhadap 200+ baris dummy hasil ekspor sistem lama (pembulatan identik `Math.round`).
- **Exit:** golden test 100% sama; plafon PO lolos 10 skenario simulasi lama (DP tanpa SJ, tepat 90%, masuk retensi tanpa SJ, pelunasan setelah SJ lengkap, over-receipt, PO jasa, dokumen Rejected diabaikan).

### M4 — Pengajuan: wizard, lampiran, submit (L)
- CRUD draft/update (I12) + `submit` (I9 invoice unik, I10 plafon baca-segar dalam lock `po:`/`inv:`, I11 barang diterima penuh, I1 CFO flag, I2 hitung ulang server).
- Upload lampiran **langsung browser→Drive** (O11): sesi resumable dibuat server (header `Origin`), konfirmasi server (size/parents/nama/tipe), whitelist MIME + magic bytes, batas ukuran di server, **cron housekeeping membersihkan file yatim**, URL sesi tidak pernah di-log. Untuk putus-jaringan: kueri status sesi + lanjut (belum teruji di S3 → **test tersendiri di milestone ini**).
- Proxy lampiran `GET …/files/:fileId` (I13, stream, `/download/drive/v3/…`, `Cache-Control: private`, indikator memuat; **tidak pernah di jalur kritis approve**).
- UI wizard 5 langkah (autosave draft, cek duplikat invoice inline, gauge plafon PO, badge CFO), daftar "Pengajuan saya".
- **Exit:** I1, I2, I9–I12 hijau; race test submit paralel; UAT kecil: 3 PIC membuat Trade & Non-Trade di data dummy.

### M5 — Approval Manager di web (M)
- `GET /api/approvals/inbox`, `POST /api/approvals/approve|:id/reject` (idempotent, `If-Match`/etag → 409 bila sudah berubah), transisi hanya lewat `STATUS_FLOW` (I3).
- Step-up password untuk nominal ≥ Rp 5 jt (I14/D9); tanpa tombol "setujui semua" di atas ambang.
- **O5a: approver L2 ≠ pembuat dokumen** — lihat P2 (butuh konfirmasi sebelum milestone ini).
- UI inbox dua panel, mobile-first, deep link dari WA ke detail dokumen.
- **Exit:** I3, I14 (sisi web) hijau; dua manager approve dokumen sama bersamaan → tepat satu berhasil, satu 409.

### M6 — WhatsApp: webhook, digest, housekeeping (M)
> **Pengaman trial (wajib):** lapisan kirim WA menolak nomor di luar `WA_TRIAL_ALLOWLIST` saat `APP_ENV=trial`. Nomor uji dummy memakai `0800000NNNN` (bukan rentang seluler nyata) supaya pesan tak pernah nyasar ke orang asli; nomor WA uji milik sendiri diisi manual dan dimasukkan ke allowlist.
- `POST /api/webhooks/wa`: `await req.text()` → HMAC hex → `timingSafeEqual` → baru `JSON.parse`; fail-closed; dedup `message.key.id` (TTL ≥ 7 hari); tolak `messageTimestamp` > ~10 menit untuk SETUJU/TOLAK; pengirim bukan `<digit>@s.whatsapp.net` ditolak; **balas ke setiap perintah**; dead-letter + alarm; 200 cepat.
- Kode `SETUJU/TOLAK <4 digit>` di Redis (`crypto.randomInt`, TTL 3 hari, terikat nomor). **Dokumen ≥ Rp 5 jt tidak diberi kode & balasan SETUJU ditolak** dengan pesan arahkan ke web; ambang dihitung server dari nominal tersimpan.
- Digest (`/api/cron/digest`) + housekeeping; selama Hobby dipicu GitHub Actions/cron-job.org (cron Hobby cuma 1×/hari). Notifikasi gagal tidak menggagalkan transaksi (I15).
- Test vektor S6 (`test-secret` → `95a77c64…a8e2`) masuk unit test.
- **Exit:** I14 (sisi WA), I15 hijau; replay webhook dengan signature valid tidak menggandakan aksi; SETUJU dari approver nyata (nomor uji) tercatat method=WA.

### M7 — Detail dokumen, voucher, dashboard (M)
- `/pengajuan/[id]` (ringkasan · lampiran · pajak · timeline Trx_Approval+Audit_Log), voucher cetak (paritas `Print_Form.html`, `buildSignatureBlocks`), dashboard PIC & Manager, Ctrl+K dasar.
- **Exit:** voucher tercetak sama dengan sistem lama untuk 5 dokumen contoh; I13 diuji (pemilik / manager berwenang / Finance boleh, lainnya 403).

### M8 — Hardening & UAT (M)
- Uji beban 10× **dari Vercel** (ulang S1) dengan pembatas laju + cache aktif; target: tidak ada aksi uang yang hilang/ganda, degradasi anggun (stale label, `UPSTREAM_BUSY`).
- Review keamanan (CSP, CSRF, enumerasi nomor, logging redaksi), a11y dasar, ukuran bundle (sisa S8).
- UAT: 3 PIC + 2 Manager, approval web **dan** WA pada dokumen yang sama.
- **Exit:** semua kriteria Fase 1 di design doc bagian 10 terpenuhi + daftar temuan UAT ditutup/dijadwalkan.

**Urutan & ketergantungan:** M0 → M1 → (M2 ∥ M3) → M4 → M5 → M6 → M7 → M8. M2 dan M3 bisa paralel setelah M1. Total kasar: ±L+L (lebih dari 2 bulan kerja kalender tergantung kecepatan review lo); angka nyata dikalibrasi setelah M1.

## 4. Peta invarian → milestone → jenis test

| Invarian | Milestone | Test |
|---|---|---|
| I1 CFO ≥ 5 jt dihitung ulang | M3/M4 | unit + golden |
| I2 hitung ulang server | M3/M4 | golden 200+ baris |
| I3 `STATUS_FLOW` + audit transisi ilegal | M1/M5 | unit tabel transisi + race approve |
| I8 vendor Approved & nama persis | M4 | unit + contract |
| I9 invoice unik per vendor | M4 | race 20 paralel |
| I10 plafon PO (lintas dokumen) | M3/M4 | 10 skenario + race pada PO sama |
| I11 barang diterima penuh (Trade non-DP) | M4 | unit |
| I12 edit hanya pemilik, Draft/Revision | M4 | unit + authz |
| I13 akses lihat dokumen/lampiran | M4/M7 | matriks authz (tiap peran × dokumen) |
| I14 WA: kode terikat nomor, ≥ 5 jt tidak via WA, step-up web | M5/M6 | unit ambang + e2e kedua jalur |
| I15 notif gagal ≠ transaksi gagal | M6 | fault injection |
| I17 audit append-only | M1 → semua | contract + fault injection |
| I4, I5, I6, I16 | **Fase 2/3** | (bukan Fase 1) |

> **Catatan koreksi:** design doc bagian 10 mencantumkan I6 (pengaju ≠ verifikator pajak) di exit Fase 1, tetapi `verifyTax` ada di Fase 2 (parity matrix 2.1). Gue pindahkan I6 ke Fase 2 di plan ini; design doc akan disesuaikan kalau lo setuju.

## 5. Di luar Fase 1 (sengaja)
Finance (4 tahap, bayar, jurnal), e-approve L4/L5, vendor register/approve, export Odoo, laporan, admin UI, arsip tahunan, PDF server-side, dark mode, Google SSO Admin. `OtpSender` tidak dibangun (D9) — cukup antarmuka tipis bila nanti perlu.

## 6. Yang gue butuhkan dari lo (keputusan & persiapan)

| # | Butuh | Kenapa / kapan |
|---|---|---|
| P1 | **Cara serah-terima kode:** (a) zip per milestone seperti spike kit, lo yang push ke repo, atau (b) repo GitHub **personal** (Hobby tidak bisa repo org) dan gue kerja lewat PR | Sebelum M0. Gue sarankan (a) dulu — tidak perlu memberi akses ke gue |
| P2 | **Konfirmasi O5a** (approver L2 ≠ pembuat dokumen). Ini mengubah perilaku `managerApprove` yang jalan di Fase 1, bukan Fase 2 seperti kesan di gerbang risk register | Sebelum M5. Kalau belum yakin: gue pasang sebagai feature flag `SOD_APPROVER_NOT_CREATOR` + penanda audit, default sesuai keputusan lo |
| P3 | Salinan spreadsheet **DUMMY** hasil skrip anonimisasi (atau izin gue menulis skripnya untuk lo jalankan) + Shared Drive dummy | M0 |
| P4 | Nomor WA uji (2–3) + API Consumer uji di Lixus dengan URL webhook ke deploy Preview | M6 |
| P5 | Jawaban Lixus soal asal pemetaan LID→nomor (R-34), plus uji request bertanda tangan asli | Sebelum M6 selesai (bukan blocker mulai) |
| P6 | Sentry (atau sejenis) + tujuan log drain | M0 |
| P7 | Ukuran bundle fungsi dari dashboard Vercel (sisa S8) | M8 (bisa lebih awal) |
| P8 | Cadence review: setelah tiap milestone (gue berhenti dan tunggu lo) vs tiap 2 milestone | Sebelum M0 |

## 7. Risiko plan ini (jujur)

- **M1 menentukan segalanya.** Kalau race/fault test di M1 mengungkap perilaku Sheets yang tak terduga, desain data layer berubah dan semua estimasi bergeser. Makanya M1 sebelum UI apa pun.
- **Putus jaringan saat upload langsung (O11)** belum pernah diuji. Kalau ternyata rapuh, fallback = kompres klien + upload lewat fungsi ≤ 4 MB (sudah jadi alternatif di design doc).
- **Paritas voucher & plafon PO** rawan selisih kecil yang baru ketahuan di UAT → golden test + 5 voucher contoh dicocokkan manual.
- **WA tanpa retry & tanpa anti-replay** (S6): ketahanan bergantung pada dedup + balasan eksplisit + digest sebagai sumber kebenaran; kehilangan pesan tetap mungkin (dead-letter hanya mengurangi, bukan menghilangkan).
- **Estimasi waktu kasar.** Jangan jadikan komitmen sebelum M1 selesai.
- **Hobby:** log 1 jam, cron 1×/hari, 100 deploy/hari — workaround sudah dirancang (log drain, cron eksternal) tapi tambah titik gagal selama trial.

## 8. Definition of done (berlaku tiap milestone)
Typecheck + lint + test hijau; test invarian terkait ditulis & lulus; tidak ada rahasia/PII di repo/log; perilaku yang berubah dari sistem lama tercatat di design doc/risk register (bukan diam-diam); catatan hasil + temuan ditulis ke project docs (menimpa dokumen yang ada); lo review sebelum milestone berikutnya dimulai.
