# P2P Finance Portal — Next.js (Vercel) · Fase 1 / M0 Fondasi

Status: **M0** (fondasi). Belum ada fitur bisnis. Rencana: `claude/phase1-implementation-plan.md` di project.
**Trial = DATA DUMMY saja** (Vercel Hobby non-komersial). Jangan pernah mengarahkan ke spreadsheet produksi.

## Isi M0
- `src/domain` status flow (I3), ambang CFO (I1) & ambang WA (D9/I14) — murni, tanpa I/O.
- `src/repo/schema.ts` registry kolom (paritas `Config.gs`, 48 kolom Trx_Pengajuan) + `header-validator.ts` (header bergeser → read-only).
- `src/lib` env tervalidasi zod, error seragam + requestId, logger dengan **redaksi**, trial guard (tolak spreadsheet non-DUMMY).
- `src/infra/google.ts` JWT + timeout 9 dtk per panggilan, `readHeaderRows`, `assertSheetAllowed`.
- `GET /api/health` (header `x-health-token`) → cek judul DUMMY + validasi header semua tab terhadap registry.
- `scripts/anonymize-dummy.ts` (membekukan DB_PO/DB_SJ + anonimisasi), `scripts/seed-dummy.ts`, `scripts/check-headers.ts` (semua dry-run/baca-saja kecuali `--yes`).
- ESLint boundaries: domain tidak boleh import infra/lib/repo; dst. Pelanggaran = lint merah.

## Jalankan lokal
```bash
npm install
npm run check          # typecheck + lint + test (157 test)
cp .env.example .env.local   # isi nilai DUMMY; JANGAN commit
npm run dev
```
Cek header salinan dummy tanpa menulis apa pun:
```bash
SHEET_ID=<id salinan> GOOGLE_SA_JSON="$(node -e "console.log(JSON.stringify(require('./sa-key.json')))")" npm run check-headers
```

## Menyiapkan salinan DUMMY (urutan)
Salinan = **Make a copy** spreadsheet (judul mengandung `DUMMY`), service account jadi Editor. Semua perintah memakai:
`SHEET_ID=<id salinan> PROD_SHEET_IDS=<id produksi> GOOGLE_SA_JSON="$(node -e "console.log(JSON.stringify(require(process.env.HOME+'/spike-kit/sa-key.json')))")"`

1. `npm run check-headers` — semua tab harus `OK`.
2. `npm run anonymize` (dry-run) lalu `npm run anonymize -- --yes`:
   - **membekukan DB_PO & DB_SJ** (di sistem asli keduanya IMPORTRANGE LIVE ke sistem PO — salinan masih menarik data nyata) jadi nilai statis, lalu
   - mengganti nama, email, NPWP, rekening, nomor HP, link file dengan data palsu yang konsisten.
3. `npm run seed` (dry-run) lalu `npm run seed -- --yes`: mengisi nomor HP/email user yang kosong, vendor Approved yang cocok dengan DB_PO, dan Kode Vendor di DB_PO.
4. Manual: kosongkan tab `WA_Pending_Approval` kalau ada; hapus tab `_REPAIR_REPORT`/`Spike_*` bila tidak diperlukan.
5. Ganti nomor HP uji (`0800000NNNN`, sengaja BUKAN nomor seluler nyata) untuk 2–3 user dengan nomor WA milik sendiri bila ingin uji WA (M6), dan isi `WA_TRIAL_ALLOWLIST`.

Skrip menolak jalan bila judul tanpa DUMMY atau ID ada di `PROD_SHEET_IDS`; keduanya dry-run kecuali ada `--yes`.

## M1 — lapisan data & koordinasi
Arsitektur (dijaga ESLint boundaries): `ports` (antarmuka Redis/Store) <- `infra` (Upstash, Sheets, lock, idempotensi, cache, rate-limit, retry) <- `server` (UoW `runAction`, audit, row-index, id-gen). `testing` = double (MemoryRedis, MemoryStore dengan injeksi gangguan, FakeClock virtual-time) hanya untuk test.

Semua aksi tulis lewat `runAction` (`src/server/uow.ts`): idempotensi -> lock multi-kunci (urut) -> baca segar + aturan -> guard deadline/lock-masih-milik-kita -> SATU `batchUpdate` atomik termasuk baris Audit_Log -> lepas lock. Redis mati = tulis gagal tertutup.

Uji nyata terhadap salinan DUMMY + Upstash (sekali, ~1 menit; membuat & menghapus tab `M1_Scratch`):
```bash
SHEET_ID=<id DUMMY> PROD_SHEET_IDS=<id prod> GOOGLE_SA_JSON="$(node -e "console.log(JSON.stringify(require(process.env.HOME+'/spike-kit/sa-key.json')))")" \
UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npm run m1-integration
```
Baris Audit_Log berlabel `M1_TEST` tertinggal di salinan DUMMY (aman dihapus).

## M2 — Auth (nomor HP + password)
- Semua user login dengan **nomor HP + password** (satu aturan untuk semua level). Struktur `Master_User_TTD` tidak berubah; satu nomor = banyak baris (brand/dept) dengan hash/salt identik, sesi membawa gabungan `roles[]`.
- Password: scrypt (`s1$…`), min 8 karakter, bukan nomor HP, bukan password umum. **Hash lama Apps Script (SHA-256 ×3000) diverifikasi lalu otomatis di-upgrade ke scrypt saat login pertama.**
- Sesi: token acak opak di cookie httpOnly/SameSite=Lax (idle 60 mnt, maks 8 jam), disimpan di Redis di bawah HMAC; ganti password / `revokeAll` mematikan semua sesi nomor itu.
- Lockout: 5 gagal / 15 mnt per (nomor, IP), plafon 30 per nomor & 50 per IP. Pesan gagal selalu sama. Step-up (konfirmasi password, 5 menit) memakai lockout yang sama.
- Mutasi hanya dari origin aplikasi (cek `Origin`/Fetch Metadata). CSP ber-nonce + header keamanan di `src/proxy.ts` → **jangan pakai atribut `style=` inline di UI** (diblokir CSP); pakai class CSS.

Coba lokal (data DUMMY):
```bash
cp .env.example .env.local        # isi: APP_BASE_URL=http://localhost:3000, SHEET_ID (DUMMY), UPSTASH_*, DRIVE_ROOT_ID (isi apa saja; dipakai mulai M4), dst.
                                  # variabel WA_* boleh dikosongkan / dihapus barisnya (baris kosong = tidak diisi)
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env.local
echo "CRON_SECRET=$(openssl rand -hex 16)" >> .env.local && echo "HEALTH_TOKEN=$(openssl rand -hex 16)" >> .env.local
echo "GOOGLE_SA_JSON='$(node -e "console.log(JSON.stringify(require(process.env.HOME+'/spike-kit/sa-key.json')))")'" >> .env.local
npm run issue-setpass -- 08000005001   # nomor user di Master_User_TTD (DUMMY); mencetak link set-password (sekali pakai, 60 mnt)
npm run dev                            # buka link itu, atur password, lalu login di /login
```
Sebelum WA gateway tersambung (M6), "lupa password" di halaman login mencetak link di terminal `npm run dev` (hanya `APP_ENV=trial`).
Respons "lupa password" sengaja dikirim **sebelum** token/link/audit dikerjakan (`after()`), supaya waktu respons tidak membocorkan apakah nomor terdaftar.

## M3 — Master data, PO, kalkulasi pajak
- `GET /api/master/{org,entitas,coa,kas,pph}` (cache 10 mnt + stale-if-error 1 jam, `invalidateMaster()` untuk invalidasi), `GET /api/master/vendors?tipe=Trade|Non-Trade` (baca segar, tanpa cache), `GET /api/po/:poNumber[?excludeIdTrx=]`, `POST /api/calc/tax`. Semua wajib login. Org **tanpa email**.
- `/api/po/:no`: 404 = PO tidak ada di DB_PO; **503 `UPSTREAM_BUSY` = DB_PO/DB_SJ (IMPORTRANGE) sedang error/Loading — bukan "tidak ada"**. Deteksi error dipersempit: kolom kunci (PO / PO_ID) di semua baris + kolom terpakai di baris yang cocok; sel error di kolom lain tidak memblokir.
- Keputusan 2026-10-12: di **submit** (M4), PO tak ketemu **atau** tak terbaca = **ditolak** (`gatePoSubmit` di `src/domain/po.ts`; sistem lama meloloskan). Preview `/api/calc/tax` memakai cache tarif PPh; submit/verifikasi wajib baca tarif **segar** (`readPph`).
- Golden test = **keluaran kode lama dijalankan apa adanya** (`node scripts/gen-golden.mjs` → `tests/golden/*.json`; 1.230 vektor pajak, 620 plafon). Ini bukan ekspor data produksi.
- Beda yang disengaja dari sistem lama: tarif PPh di luar 0..1 ditolak (lama: bisa memotong 200%); `Infinity` ditolak; `/api/calc/tax` menerima angka bertipe number + enum PPN (lebih ketat); kode vendor kosong tidak pernah cocok; Master_Setting/COA/PPh dibaca posisional (header aslinya belum terdaftar, `strictHeader:false`).

Coba tanpa UI (dev server jalan, data DUMMY; ganti nomor/PO sesuai sheet):
```bash
curl -s -c jar.txt -H 'Origin: http://localhost:3000' -H 'content-type: application/json' -d '{"phone":"08000005001","password":"PASSWORD_LO"}' localhost:3000/api/auth/login >/dev/null
curl -s -b jar.txt localhost:3000/api/master/pph
curl -s -b jar.txt -H 'Origin: http://localhost:3000' -H 'content-type: application/json' -d '{"invAmount":1000000,"statusPPN":"Exclude PPN"}' localhost:3000/api/calc/tax
curl -s -b jar.txt "localhost:3000/api/po/$(python3 -c 'import urllib.parse as u;print(u.quote("NOMOR_PO_DARI_DB_PO",safe=""))')"
```

## M4a — Pengajuan (server): draft, update, submit, daftar saya
- `POST /api/pengajuan` (buat draft, 201) · `GET /api/pengajuan` (milik saya, terbaru dulu) · `GET /api/pengajuan/:id` (detail, hanya pemilik; orang lain = 404) · `POST /api/pengajuan/:id/update` (hanya Draft / Revision Needed) · `POST /api/pengajuan/:id/submit` (**header `Idempotency-Key` wajib**, 8–64 karakter `A-Za-z0-9_-`; pakai kunci yang sama saat retry).
- **Server menghitung semua angka** (DPP, PPN, final, flag CFO ≥ Rp 5.000.000, qty PO/SJ). Body bersifat strict: kunci asing seperti `finalAmount`, `company`, `pic`, `createdBy`, `status` ditolak 400. Company diturunkan dari Master_Setting; PIC = pengguna yang login (brand/divisi harus ada di peran Level 1 miliknya). Vendor dipilih lewat **kode** dan dibaca segar (Approved + tipe sama).
- Submit (aksi uang, lock `trx:` + invoice + `po:`): baca ulang semuanya di dalam lock, hitung ulang nominal, cek invoice dobel (I9), Trade: PO harus ketemu & terbaca (tak ketemu → 422, tak terbaca → 503), plafon PO kumulatif (I10), barang diterima kecuali DP (I11), Manager Level 2 divisi harus ada, **lampiran wajib** (`FILE_URL`). Satu batch atomik: update baris + `Trx_Approval` Level 1 + 2 baris audit.
- Beda dari sistem lama (keputusan 2026-10-21): kumulatif plafon PO hanya menghitung dokumen yang **sudah diajukan** (Submitted ke atas). **Draft, Revision Needed, dan Rejected tidak menahan kuota**; kuota diperebutkan saat submit dan dijaga lock `po:`. Tampilan `/api/po` memakai aturan yang sama.
- Lampiran upload ke Drive baru di **M4b**. Untuk uji manual M4a, isi kolom `FILE_URL` baris itu dengan URL Drive apa saja di sheet DUMMY.

```bash
J='-H Origin:http://localhost:3000 -H content-type:application/json'
curl -s -b jar.txt $J -d '{"tipe":"Non-Trade","brand":"BRAND","departement":"DEPT","description":"Tes","vendorKode":"KODE","noInvoice":"INV-TES-1","dateInvoice":"2026-10-01","dueDate":"2026-10-31","jenisPembayaran":"Full Payment","invoiceAmount":1000000,"statusPPN":"Non PPN"}' localhost:3000/api/pengajuan
curl -s -b jar.txt $J -H 'Idempotency-Key: tes-0001-abcdef' -X POST localhost:3000/api/pengajuan/NTR-00001/submit
```

## M4b — Lampiran invoice (upload langsung browser → Drive)
- Alur 3 langkah: `POST /api/pengajuan/:id/lampiran/sesi` `{namaAsli,size,mimeType}` → server membuat sesi resumable di Drive dan memberi `{uploadId, sessionUrl}` · browser **PUT langsung** isi file ke `sessionUrl` (respons Drive memuat `id` file) · `POST …/lampiran/konfirmasi` `{uploadId,fileId}` → server memverifikasi lalu menempelkan ke kolom `FILE_URL`. Baca: `GET /api/pengajuan/:id/lampiran` (proxy, stream).
- Server **tidak percaya klien**: tipe hanya PDF/JPG/PNG, maks 10 MB, nama file dibuat server (`invoice_{ID}_{waktu}_{acak}_{nama-bersih}.{ext dari MIME}`), saat konfirmasi dicek nama persis, ukuran persis, induk = folder lampiran, tipe, dan **magic bytes**; gagal = file di-trash. Klien tidak bisa menempelkan file lain (milik orang / file lama) karena nama harus sama dengan yang dibuat server untuk sesi itu.
- Hanya pemilik, dokumen berstatus Draft/Revision Needed. Rate limit 30 sesi/jam/pengguna. `sessionUrl` = kredensial pembawa: tidak di-log.
- Proxy baca (I13): pemilik, Manager berwenang (brand/divisi), atau Finance+; selain itu 404. Tipe di luar whitelist (file lama) dipaksa unduh. Link Drive mentah tidak pernah dikirim ke klien.
- Mengganti lampiran men-trash file lama **hanya bila buatan server**; file warisan sistem lama tidak pernah disentuh.
- File yatim (upload tanpa konfirmasi) > 24 jam di-trash oleh `GET /api/cron/lampiran-yatim` (Bearer `CRON_SECRET`; Vercel Cron harian, lihat `vercel.json`). Cron membatalkan diri bila sheet tak terbaca.
- Guard trial: Shared Drive harus berjudul DUMMY dan folder harus di Shared Drive; dicek sebelum sesi pertama.
- Beda dari design 4.6 (sengaja, lebih sederhana): file ditaruh flat di satu folder (belum `/{tahun}/{bulan}/{ID}/`); struktur subfolder bisa menyusul tanpa mengubah API.
- Uji adapter Drive asli: `npm run m4b-integration` (butuh `DRIVE_ROOT_ID` di `.env.local`).

```bash
# uji manual dengan curl (ganti NTR-xxxxx dan file)
J='-H Origin:http://localhost:3100 -H content-type:application/json'
curl -s -b jar.txt $J -d '{"namaAsli":"tes.pdf","size":SIZE_BYTE,"mimeType":"application/pdf"}' localhost:3100/api/pengajuan/NTR-xxxxx/lampiran/sesi
curl -s -X PUT -H 'content-type: application/pdf' --data-binary @tes.pdf "SESSION_URL"          # balasan memuat "id"
curl -s -b jar.txt $J -d '{"uploadId":"UPLOAD_ID","fileId":"FILE_ID"}' localhost:3100/api/pengajuan/NTR-xxxxx/lampiran/konfirmasi
curl -s -b jar.txt -o hasil.pdf localhost:3100/api/pengajuan/NTR-xxxxx/lampiran
```

## M4c — UI pengajuan (wizard 5 langkah)
- Halaman: `/` (beranda + hitungan), `/pengajuan` (daftar, filter status, cari), `/pengajuan/baru` (wizard), `/pengajuan/[id]` (detail baca-saja), `/pengajuan/[id]/edit` (Draft/Perlu Revisi; buka di langkah Tinjau, atau Tagihan bila lampiran belum ada).
- Langkah: Jenis & referensi (tarik data P.O, gauge plafon) → Entitas & keperluan → Vendor → Tagihan & lampiran → Tinjau & ajukan. Angka di layar hanya **perkiraan**; angka final dari server.
- Foto invoice dikecilkan di browser (sisi maks 1800px, JPEG 0,82) sebelum diunggah langsung ke Drive; PDF tidak diubah.
- Autosave: isian disimpan di `sessionStorage` tiap berubah (bisa dipulihkan); draf server dibuat saat Lanjut dari langkah 4 / "Simpan sebagai draft", lalu diperbarui senyap tiap pindah langkah.
- Ajukan memakai `Idempotency-Key` stabil: klik ulang / jaringan putus tidak membuat dokumen ganda.
- CSP `connect-src` kini mengizinkan `https://www.googleapis.com` (PUT langsung ke Drive).
- Ketik angka Rupiah: titik ribuan dari kolom sendiri dibuang saat mengetik; tempel diurai ketat ("1250.50" ditolak, tidak jadi 125050).

## M5 — Persetujuan Manager (web)
- API (per dokumen, bukan bulk): `GET /api/approvals/inbox`, `POST /api/approvals/{id}/approve`, `POST /api/approvals/{id}/reject`. Wajib `Idempotency-Key` + `etag` (dari inbox; basi → 409). Hanya Manager (Level 2) yang berwenang atas brand/dept dokumen; di luar wewenang → 404.
- Approve: Submitted → Manager Approved + baris `Trx_Approval` L2 (E-SIGN, ` [Portal-HP]`) + audit. Reject: → **Revision Needed** (perilaku lama), alasan wajib, `NOTES_FINANCE` = `[DITOLAK MANAGER] …`.
- Step-up password untuk nominal tersimpan ≥ Rp 5.000.000 (`POST /api/auth/step-up`, berlaku 5 menit per sesi). Bulk di UI hanya untuk < 5 jt, dikirim satu per satu.
- **O5a (SoD)**: approver ≠ pembuat dokumen. Flag `SOD_APPROVER_NOT_CREATOR` default ON (hanya nilai persis `off` mematikan; penanda tercatat di audit). Submit juga ditolak bila divisi tak punya Manager selain pembuat.
- UI `/persetujuan`: dua panel di desktop; di HP daftar → detail penuh dengan bar aksi menempel. Deep link `?id=NTR-00001`.
- Dua manager approve dokumen sama bersamaan: tepat satu berhasil, satu 409 (dites di service + terlihat di browser).

## M6 — WhatsApp: notifikasi, digest, balasan SETUJU/TOLAK
- **Pengirim** `WaSender` (gateway Lixus: `POST {to,text}` + `X-API-Key`). Tanpa `WA_GATEWAY_URL`/`WA_API_KEY` = tidak mengirim apa pun. **`APP_ENV=trial`: hanya ke nomor di `WA_TRIAL_ALLOWLIST`** (kosong = tidak ada yang terkirim). Link set-password kini lewat WA bila terkonfigurasi (gagal kirim → `DevLinkSender`, hanya trial).
- **Webhook** `POST /api/webhooks/wa`: raw body → HMAC-SHA256 hex vs `X-Gateway-Signature` (`timingSafeEqual`) → baru parse; secret/header hilang = 401. Dedup `message.key.id` 7 hari; pesan > 10 menit / masa depan > 2 menit ditolak; pengirim harus `<digit>@s.whatsapp.net` (`@lid` ditolak); pengirim tak terdaftar → diam. Kerja jalan setelah 200; **tiap perintah dibalas**; galat tak terduga → dead-letter di Redis (`wa:dlq:*`, penghitung `wa:dlq:count`) + log error.
- **Kode** `SETUJU/TOLAK <4 digit>` di Redis, `crypto.randomInt`, TTL 3 hari, **terikat nomor** dan versi dokumen (etag): dokumen berubah sesudah digest → ditolak. 10 kode salah/jam/nomor → terkunci. **Nominal ≥ Rp 5 jt: tidak diberi kode di digest dan ditolak di server bila kode dipaksa** (dihitung dari nominal tersimpan). OTP email lama dihapus (diganti aturan D9). SoD (O5a) berlaku sama seperti di web.
- Jejak audit WA: `Trx_Approval.Method = WA`, catatan `[via WhatsApp]`, audit `Level 2 (WA)`, tolak = `[DITOLAK MANAGER via WA] …`.
- **Digest** `GET /api/cron/digest` (Bearer `CRON_SECRET`): satu ringkasan per Manager berwenang; pembuat tidak diminta menyetujui dokumennya sendiri (SoD). Kunci 4 menit mencegah pemicu ganda. Pemicu: `.github/workflows/digest.yml` (isi Secrets repo `APP_URL`, `CRON_SECRET`; jadwal 09/12/15/17 WIB hari kerja).
- **Notif PIC** saat disetujui/dikembalikan (web & WA), setelah respons, dedup per transisi. Notifikasi gagal tidak pernah menggagalkan transaksi (I15).
- Uji tanpa gateway: `npm run wa-webhook-test -- 6281200000001 "SETUJU 4821"` (menandatangani sendiri). Housekeeping `bersihkanWAPending` tidak diperlukan: semua state ber-TTL di Redis.
- Digest Finance ditunda ke Fase 2 (tahap Finance belum ada di web).

## M7 — Detail dokumen, voucher, dashboard, Ctrl+K
- **Detail** `/pengajuan/[id]` (+ `GET /api/pengajuan/[id]/detail`): ringkasan, pajak, stepper alur, umur di tahap, timeline (Audit_Log `STATUS_CHANGE` + Trx_Approval, email → nama). **I13** lewat `canViewDocument`: pemilik, Manager berwenang, Level ≥ 3 (bukan 99). Selain itu **404** (sama dengan ID tak ada). Rekening disamarkan di layar; link Drive mentah & email pembuat tidak dikirim ke klien.
- **Voucher** `/pengajuan/[id]/voucher`: paritas `Print_Form.html` (A4, kotak TTD hasil port `buildSignatureBlocks`, kotak COA, riwayat bayar, catatan CFO). Rekening **penuh** hanya di voucher. Tombol cetak voucher / invoice / keduanya; invoice gambar lewat proxy lampiran (blob), PDF dibuka di tab baru (CSP `object-src 'none'`).
- **Dashboard** di `/`: PIC (revisi/draft/menunggu + aktivitas terakhir), Manager (antrean, total nominal, tertua, ringkasan divisi bulan ini).
- **Ctrl/⌘+K** `GET /api/search?q=` (min 2 huruf, maks 8 hasil, hanya dokumen yang boleh dilihat).
- Uji: `tests/m7.test.ts` (matriks I13 8 peran, paritas signature block, timeline, pencarian, dashboard).

## M8 — Hardening & UAT
- **Cache baca tampilan** (`server/view-cache.ts`): halaman memakai salinan per-instance (TTL 15 dtk) yang divalidasi versi tab di Redis (`tabver:<tab>`, dinaikkan tiap tulis di `runAction`, juga saat tulis ambigu). Single-flight; Redis mati = lewati cache; Google gagal = salinan < 5 mnt dipakai (stale-if-error). **Aksi (submit/approve/dst.) tidak pernah memakai cache** - selalu baca segar di dalam lock. Beranda Manager: 3 baca penuh -> 1.
- **Keamanan:** pagar inventaris route (`tests/m8-security.test.ts`: route baru wajib lewat `route()`, `session:'none'` hanya auth publik & cron ber-Bearer), header COOP/CORP, CSP `sandbox` untuk gambar lampiran, batas 40 pencarian/menit/pengguna, cookie rusak = 401 (bukan 500).
- **A11y:** skip link, landmark `main`, judul halaman, axe-core (WCAG 2.0/2.1 A+AA) bersih di login, beranda, persetujuan, detail, voucher, palet cari (Chromium harness); nav mobile bisa digeser.
- **Uji beban** `npm run load-test` (lihat header skrip): fase baca + fase 10 approve paralel per dokumen. Menolak host selain `*.vercel.app`/localhost.
- **UAT**: runbook di project docs `claude/m8-uat-runbook.md`.

## Deploy (nanti, saat ada fitur)
`vercel.json` memaksa region `sin1`. Env Preview & Production terpisah. Jangan kirim isi `.env`/`GOOGLE_SA_JSON`/token ke siapa pun.

edit
