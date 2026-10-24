# P2P Finance Portal — aturan kerja untuk Claude Code

Migrasi Google Apps Script → Next.js 16 di Vercel. DB = Google Sheets, file = Drive (Shared Drive), koordinasi = Upstash Redis, WA = gateway Lixus. Auth = nomor HP + password.
**Status sekarang: trial di Vercel Hobby, DATA DUMMY SAJA.** Pro + data produksi baru di Fase 4.

Baca dulu sebelum mengubah apa pun: `README.md` (peta tahapan, keputusan), `docs/STATUS-DAN-ROADMAP.md` (status & temuan terbuka), `docs/ROADMAP-FASE-2-4.md` (rencana ke depan). Perilaku sistem lama (Apps Script) adalah acuan; dokumen desain lengkap ada di project claude.ai "P2P Finance Portal".

## Perintah
- `npm run check` = typecheck + lint + test (WAJIB hijau sebelum commit)
- `npm run build` untuk cek build; `npm run dev` untuk lokal
- Script integrasi (`m1-integration`, `m4b-integration`, `issue-setpass`, `wa-webhook-test`, `load-test`) memakai `.env.local` dan menyentuh sheet/Redis dummy sungguhan — jalankan hanya bila diminta.

## Arsitektur (dipaksa ESLint boundaries)
- `src/domain` TS murni, tanpa I/O (status flow, pajak, plafon PO, SoD, step-up, threshold WA). Tidak boleh import `infra`/`repo`.
- `src/repo` port + SheetsRepo + InMemoryRepo; `src/infra` redis/google/wa/logger; `src/server` service layer (unit of work); `src/app` route handler (parse → authz → service → map error); `src/ui` komponen.
- Route handler pakai `route({method, session, schema})` (CSRF origin check). Tidak ada logika bisnis di route/komponen.
- Semua aksi tulis: lock berurut → baca segar → aturan domain → satu `batchUpdate` → invalidasi cache → audit di batch yang sama. Aksi uang: `Idempotency-Key`, etag/`If-Match`, gagal cepat, fail-closed bila Redis mati, tidak pernah dari cache.
- Tanggal bisnis = WIB lewat helper tunggal; tulis ke Sheets RAW/string; uang = integer rupiah.

## Aturan keras
1. **Jangan pernah membaca, mencetak, atau commit rahasia**: `.env*`, `sa-key.json`, token, API key, webhook secret, hash password. Jangan `cat` file env. Untuk cek konfigurasi pakai script yang hanya mencetak metadata non-rahasia. Jika rahasia muncul tidak sengaja di output, hentikan dan beri tahu user.
2. **Dummy only.** Jangan arahkan ke spreadsheet/Drive produksi. `APP_ENV=trial` menolak ID yang tidak berjudul DUMMY/SPIKE — jangan dilonggarkan.
3. **Tidak ada push langsung ke `main`.** Selalu branch (`feat/…`, `fix/…`, `docs/…`) → commit → push → PR. Merge ke `main` = deploy Production otomatis di Vercel, jadi merge dilakukan manusia setelah review.
4. **Perubahan yang menyentuh kontrol uang atau keamanan** (plafon PO, pajak, approval/SoD, step-up, pembayaran, auth, throttle, webhook, CSRF, authz): jelaskan alasan dan dampak DULU, minta konfirmasi user, baru ubah. Tulis/ubah test invarian bersamaan dengan kodenya.
5. **Jangan mengubah perilaku diam-diam.** Beda dari sistem lama harus tercatat (README / docs) dan diputuskan user. Jangan "memperbaiki" aturan yang tampak aneh tanpa menanyakan (mis. SoD, ambang Rp 5 jt, retensi PO).
6. **Fase 2 (Finance) tidak dimulai** sebelum user mengonfirmasi eksplisit O4/O5 (lihat `docs/ROADMAP-FASE-2-4.md`). Jangan mulai milestone berikutnya tanpa "go".
7. **Berhenti setelah tiap milestone/PR** dan tunggu review. Jangan menggabungkan banyak milestone dalam satu PR.
8. Baca file/fungsi yang relevan sebelum mengubah; jangan menebak dari nama. Kalau ada ambiguitas penting, tanya.
9. Jangan masukkan `node_modules`, `.next`, atau `.env*` ke commit. Jangan menambah dependensi tanpa alasan tertulis.
10. Tidak ada PII/nomor rekening/NPWP nyata di repo, test, atau log.

## Kolaborasi
- Ada kolaborator lain yang membuka PR (mis. aturan PO #16/#17) — selalu `git fetch` dan sinkron dengan `origin/main` sebelum mulai; jangan menimpa pekerjaan mereka.
- PR: ringkas apa & kenapa, daftar risiko, hasil `npm run check`, dan apa yang perlu diverifikasi di Production (Preview tidak bisa login karena origin check ke `APP_BASE_URL` Production).
- Commit message diakhiri atribusi Claude sesuai konvensi tool.

## Operasional
- Vercel Hobby: cron cuma 1×/hari → digest WA dipicu GitHub Actions (`.github/workflows/digest.yml`, secrets `APP_URL`, `CRON_SECRET`). Region sin1. Log runtime hanya 1 jam.
- Kuota Sheets 60 baca + 60 tulis/menit/user: cache + single-flight + satu batch per aksi; jangan menambah pola baca per-sel.
- WA ke Manager hanya lewat digest; dokumen ≥ Rp 5 jt tidak mendapat kode WA dan server menolak approve via WA (wajib web + step-up password).

## Gaya komunikasi
Bahasa campuran Indonesia-Inggris santai, teknis, to the point. Satu langkah manual per pesan bila user harus mengerjakan sesuatu. Catat hasil/temuan penting di `docs/` (atau minta user memperbarui project docs di claude.ai) dan di PR.
