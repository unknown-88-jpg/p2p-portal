# P2P Finance Portal — Next.js (Vercel)

Pengganti sistem Google Apps Script: web app Next.js 16 di Vercel, **Google Sheets sebagai database**, Google Drive (Shared Drive) untuk file, Upstash Redis untuk sesi/lock/idempotensi/rate-limit, login nomor HP + password, WhatsApp lewat gateway Lixus.
**Trial = DATA DUMMY saja** (Vercel Hobby non-komersial; Pro saat go-live). Jangan pernah mengarahkan ke spreadsheet produksi.
Status per 2026-10-24: **Fase 1 / M8 (UAT & penutupan) berjalan.** Rincian terkini: [`docs/STATUS-DAN-ROADMAP.md`](docs/STATUS-DAN-ROADMAP.md). Dokumen desain, hasil UAT, dan risiko ada di Project "P2P Finance Portal" di claude.ai (`claude/phase1-implementation-plan.md`, `claude/m8-uat-hasil.md`, dst.).

## Peta tahapan

| Fase | Isi | Status |
|---|---|---|
| **0** Spike | Sheets/Drive/Upstash/Vercel layak dipakai | ✅ Selesai |
| **1** Auth, Ajukan, Approval | M0 fondasi · M1 lapisan data · M2 auth · M3 master/PO/pajak · M4a–c pengajuan (server, lampiran, UI) · M5 persetujuan Manager · M6 WhatsApp · M7 detail/voucher/dashboard · M8 hardening & UAT | M0–M7 ✅ · **M8 🟡 berjalan** |
| **2** Finance | Verifikasi pajak, e-approve Fin. Mgr/CFO (O4: menggantikan TTD basah, tanpa transisi), jurnal COA, siap dibayar, pembayaran/lunas, digest WA Finance | 🟡 Berjalan: F2-A ✅ (antrean & hak akses), F2-B ✅ (verifikasi pajak), F2-C ✅ (e-approve Fin. Mgr/CFO), F2-D ✅ (jurnal COA bulk), F2-E ✅ (pembayaran), F2-F ✅ (notif, riwayat bayar, digest Finance), F2-G 🟡 (kode & review selesai; UAT menunggu) |
| **3** Pendukung | Vendor, Master, Export (Odoo), Laporan, Admin, arsip | 🟡 Berjalan: F3-A ✅ (vendor), F3-B ✅ (export Odoo), F3-C ✅ (admin), F3-D ✅ (laporan & audit), F3-E 🟡 (backup ✅; arsip kandidat saja — tunggu keputusan) |
| **4** Go-live | Vercel Pro, `PROD_SHEET_IDS`, Upstash terpisah, cutover dari Apps Script | ⬜ Belum mulai |

Detail rencana Fase 2–4 (lingkup, milestone, exit criteria, risiko, keputusan terbuka): [`docs/ROADMAP-FASE-2-4.md`](docs/ROADMAP-FASE-2-4.md).

Alur status dokumen (stepper di UI): Draft → Menunggu Manager → Menunggu Verifikasi Pajak → Menunggu TTD Basah (Fin. Mgr / CFO) → Menunggu Jurnal COA → Siap Dibayar → Lunas. Fase 1 mencakup dua tahap pertama (sampai Manager Approved); tahap sesudahnya dikerjakan di Fase 2.

### Sisa M8 (penutupan Fase 1)
1. Patch 2 (F-11…F-14) sudah di `main` (PR #18). Sisa: pastikan ter-deploy, lalu verifikasi ulang F-13 (cetak voucher 1 halaman) di iPhone asli.
2. Uji ulang U6 dengan aturan P.O baru yang sudah **final** (retensi dihapus, I11 dihapus; lihat M3): plafon = grand total P.O penuh, Full Payment/Pelunasan tetap bisa diajukan walau SJ belum lengkap. Hasil U6 lama berlaku untuk kode sebelum 2026-10-24.
3. U21 Android, U23 (unggah PDF besar dari ponsel), cek baris audit di sheet (U3/U18).
4. Pembersihan data dummy (nomor Dummy 002 dikembalikan, baris peran tambahan, dokumen uji, reset password) dan cek akun Manager bernomor lama.
5. ~~Konfirmasi eksplisit O4/O5~~ — selesai 2026-10-24 (lihat `docs/ROADMAP-FASE-2-4.md` §2.0).

### Aturan kerja bersama
- **Data dummy saja** selama trial. Jangan menempel `.env*`, kunci, token, atau secret di chat/PR/screenshot.
- Perubahan kontrol uang/keamanan (plafon, SoD, step-up, ambang Rp 5 jt, jalur WA) dijelaskan dan dikonfirmasi pemilik sebelum merge.
- Kerja lewat branch + PR; `npm run check` hijau (typecheck + lint + test) sebelum merge.
- Rute tanpa sesi (`session: 'none'`) dikunci oleh `tests/m8-security.test.ts`; menambahnya harus disengaja dan diberi alasan.

## M0 — Fondasi
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
npm run check          # typecheck + lint + test (581 test per Patch 2)
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
- Keputusan 2026-10-24 (**final, dikonfirmasi pemilik**): **retensi 10% sistem lama dihapus**. Plafon tagihan P.O = **grand total P.O penuh** (`hitungPlafonSJ`/`cekPlafonPO` di `src/domain/po.ts`), tidak lagi bergantung pada kelengkapan Surat Jalan. Golden test plafon sengaja berbeda dari sistem lama. Aturan I11 (pembayaran non-DP Trade wajib barang diterima penuh) juga **dihapus**: pengajuan tetap bisa diajukan walau Surat Jalan belum lengkap; layar tinjau hanya menampilkan info, tidak memblokir.
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
- Submit (aksi uang, lock `trx:` + invoice + `po:`): baca ulang semuanya di dalam lock, hitung ulang nominal, cek invoice dobel (I9), Trade: PO harus ketemu & terbaca (tak ketemu → 422, tak terbaca → 503), plafon PO kumulatif (I10), Manager Level 2 divisi harus ada, **lampiran wajib** (`FILE_URL`). Satu batch atomik: update baris + `Trx_Approval` Level 1 + 2 baris audit.
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
- **Pengirim** `WaSender` (gateway Lixus: `POST {to,text}` + `X-API-Key`). Tanpa `WA_GATEWAY_URL`/`WA_API_KEY` = tidak mengirim apa pun. **`APP_ENV=trial`: hanya ke nomor di `WA_TRIAL_ALLOWLIST` atau nomor user AKTIF di Master_User_TTD dummy** (keputusan user 2026-10-24, opsi 1: tidak perlu menambah nomor manual; sheet gagal dibaca = hanya allowlist env; Production tanpa allowlist). Link set-password kini lewat WA bila terkonfigurasi (gagal kirim → `DevLinkSender`, hanya trial).
- **Webhook** `POST /api/webhooks/wa`: raw body → HMAC-SHA256 hex vs `X-Gateway-Signature` (`timingSafeEqual`) → baru parse; secret/header hilang = 401. Dedup `message.key.id` 7 hari; pesan > 10 menit / masa depan > 2 menit ditolak; pengirim harus `<digit>@s.whatsapp.net` (`@lid` ditolak); pengirim tak terdaftar → diam. Kerja jalan setelah 200; **tiap perintah dibalas**; galat tak terduga → dead-letter di Redis (`wa:dlq:*`, penghitung `wa:dlq:count`) + log error.
- **Kode** `SETUJU/TOLAK <4 digit>` di Redis, `crypto.randomInt`, TTL 3 hari, **terikat nomor** dan versi dokumen (etag): dokumen berubah sesudah digest → ditolak. 10 kode salah/jam/nomor → terkunci. **Nominal ≥ Rp 5 jt: tidak diberi kode di digest dan ditolak di server bila kode dipaksa** (dihitung dari nominal tersimpan). OTP email lama dihapus (diganti aturan D9). SoD (O5a) berlaku sama seperti di web.
- Jejak audit WA: `Trx_Approval.Method = WA`, catatan `[via WhatsApp]`, audit `Level 2 (WA)`, tolak = `[DITOLAK MANAGER via WA] …`.
- **Digest** `GET /api/cron/digest` (Bearer `CRON_SECRET`): satu ringkasan per Manager berwenang; pembuat tidak diminta menyetujui dokumennya sendiri (SoD). Kunci 4 menit mencegah pemicu ganda. Pemicu: `.github/workflows/digest.yml` (isi Secrets repo `APP_URL`, `CRON_SECRET`; jadwal 09/12/15/17 WIB hari kerja).
- **Kirim WA manual (F-15, 2026-10-24):** di beranda, dokumen PIC yang Menunggu Manager punya tombol **Kirim WA** → `POST /api/pengajuan/{id}/kirim-wa`. Maks. **1x per hari WIB per dokumen** (kunci Redis `wa:manual:{id}:{tanggal}` ber-TTL sampai tengah malam WIB; ke-2 = 429). Penerima & kode memakai aturan yang sama dengan digest (`itemPerManager`: wewenang brand/dept, SoD, kode hanya < Rp 5 jt). Hanya pemilik (lainnya 404); gagal kirim ke semua Manager = jatah dikembalikan; audit `WA_REMINDER_MANUAL`. Catatan jadwal otomatis di kartu Ringkasan status diambil dari `JADWAL_DIGEST_WIB` (test menjaga sama dengan cron `digest.yml`).
- **Notif PIC** saat disetujui/dikembalikan (web & WA), setelah respons, dedup per transisi. Notifikasi gagal tidak pernah menggagalkan transaksi (I15).
- Uji tanpa gateway: `npm run wa-webhook-test -- 6281200000001 "SETUJU 4821"` (menandatangani sendiri). Housekeeping `bersihkanWAPending` tidak diperlukan: semua state ber-TTL di Redis.
- Digest Finance ditunda ke Fase 2 (tahap Finance belum ada di web).
- **Terbukti dengan gateway nyata (UAT 2026-10-23):** consumer khusus `p2p-portal-trial` di Ops Panel Lixus (API key & webhook secret sendiri; consumer lain tidak disentuh), webhook ke `/api/webhooks/wa`, allowlist trial hanya nomor penguji. Digest → balas `SETUJU <kode>` → status maju, badge **WA**, konfirmasi terkirim; kode sekali pakai ditolak; 10 kode salah → kunci; WA lalu web dari tampilan basi → 409, tepat satu baris persetujuan. Event gema/status dari gateway (`bukan message.received`, `pesan sendiri`) diabaikan dengan sengaja.
- **WA ke Manager hanya lewat digest**, bukan otomatis saat submit. Pemicu otomatis: GitHub Actions `digest-approval` (hari kerja 09/12/15/17 WIB; secret repo `APP_URL` & `CRON_SECRET`; juga bisa dijalankan manual dari tab Actions). Akun yang nomornya di luar allowlist trial tercatat `gagal` di hasil digest (diharapkan).

## M7 — Detail dokumen, voucher, dashboard, Ctrl+K
- **Detail** `/pengajuan/[id]` (+ `GET /api/pengajuan/[id]/detail`): ringkasan, pajak, stepper alur, umur di tahap, timeline (Audit_Log `STATUS_CHANGE` + Trx_Approval, email → nama). **I13** lewat `canViewDocument`: pemilik, Manager berwenang, Level ≥ 3 (bukan 99). Selain itu **404** (sama dengan ID tak ada). Rekening disamarkan di layar; link Drive mentah & email pembuat tidak dikirim ke klien.
- **Voucher** `/pengajuan/[id]/voucher`: paritas `Print_Form.html` (A4, kotak TTD hasil port `buildSignatureBlocks`, kotak COA, riwayat bayar, catatan CFO). Rekening **penuh** hanya di voucher. Tombol cetak voucher / invoice / keduanya; invoice gambar lewat proxy lampiran (blob), PDF dibuka di tab baru (CSP `object-src 'none'`).
- Beda dari sistem lama (keputusan user 2026-10-25): kotak TTD voucher **hanya level alur P2P 1–5**. Admin (L9, brand/dept ALL) mengatur sistem dan tidak lagi muncul sebagai kotak "Mengetahui," (sistem lama memasukkan semua level yang cocok brand/dept).
- Beda dari sistem lama (keputusan user 2026-10-25, temuan audit C7): kotak TTD voucher hanya memakai persetujuan **siklus sekarang**. Baris sebelum pengajuan (L1) terakhir diabaikan; Fin. Mgr/CFO hanya yang setelah verifikasi pajak (L3) terakhir, sama dengan gerbang bayar. Dokumen yang dikembalikan lalu diajukan ulang tidak lagi menampilkan tanda tangan lama sebagai "E-Signed" (sistem lama `getApprovalMap` mengambil APPROVED terakhir dari seluruh riwayat). Waktu tak terbaca = kotak dianggap belum ditandatangani.
- **Dashboard** di `/`: PIC (revisi/draft/menunggu + aktivitas terakhir), Manager (antrean, total nominal, tertua, ringkasan divisi bulan ini).
- **Ctrl/⌘+K** `GET /api/search?q=` (min 2 huruf, maks 8 hasil, hanya dokumen yang boleh dilihat).
- Uji: `tests/m7.test.ts` (matriks I13 8 peran, paritas signature block, timeline, pencarian, dashboard).

## M8 — Hardening & UAT
- **Cache baca tampilan** (`server/view-cache.ts`): halaman memakai salinan per-instance (TTL 15 dtk) yang divalidasi versi tab di Redis (`tabver:<tab>`, dinaikkan tiap tulis di `runAction`, juga saat tulis ambigu). Single-flight; Redis mati = lewati cache; Google gagal = salinan < 5 mnt dipakai (stale-if-error). **Aksi (submit/approve/dst.) tidak pernah memakai cache** - selalu baca segar di dalam lock. Beranda Manager: 3 baca penuh -> 1.
- **Keamanan:** pagar inventaris route (`tests/m8-security.test.ts`: route baru wajib lewat `route()`, `session:'none'` hanya auth publik & cron ber-Bearer), header COOP/CORP, CSP `sandbox` untuk gambar lampiran, batas 40 pencarian/menit/pengguna, cookie rusak = 401 (bukan 500).
- **A11y:** skip link, landmark `main`, judul halaman, axe-core (WCAG 2.0/2.1 A+AA) bersih di login, beranda, persetujuan, detail, voucher, palet cari (Chromium harness); nav mobile bisa digeser.
- **Uji beban** `npm run load-test` (lihat header skrip): fase baca + fase 10 approve paralel per dokumen. Menolak host selain `*.vercel.app`/localhost.
- **UAT**: runbook di project docs `claude/m8-uat-runbook.md`; hasil berjalan di `claude/m8-uat-hasil.md` (temuan F-01…F-16).
- **Patch 1** (F-01…F-09): label revisi, SoD di label antrean, antrean/ringkasan hanya dokumen relevan, pesan upload, cache vendor 15 dtk + single-flight (submit tetap validasi vendor segar).
- **Patch 2** (F-11…F-14): pesan kunci login menyebut durasi; `POST /api/auth/set-password/cek` (rute publik, hanya mengintip validitas link tanpa menghanguskan atau membocorkan data akun; pembatas sendiri 20 kegagalan/IP/15 mnt, terpisah dari `setpass`); CSS cetak voucher dipaksa tata letak A4 agar 1 halaman; parser WA mengabaikan penanda format WhatsApp di sekitar perintah/kode.
- **Bukti kapasitas (Vercel Hobby sin1, 2026-10-22):** Sheets API puncak ±15% dari batas baca, Vercel 0% error/timeout, Upstash ±19K dari 500K command/bulan, bundle client 748 KB; load test CONC=10/30 tanpa 5xx dan tanpa persetujuan ganda.
- **Pembatas `setpass` (diperbaiki 2026-10-24):** dulu plafon global 10 kegagalan (dari IP mana pun) mengunci set-password semua orang 15 menit. Sekarang `SETPASS_RULE`: 10 link tak valid / 15 mnt **per IP**, plafon global longgar 500 / 15 mnt (rem penyalahgunaan massal). Token 256-bit.

## Fase 2 / F2-A — Fondasi Finance & antrean (2026-10-24)
- **Hak akses** (`src/domain/finance.ts`, capability `finance.view`): melihat antrean = Finance Staff (L3), Fin. Mgr (L4), CFO (L5); PIC/Manager/Admin → 403 (halaman: diarahkan ke beranda). Bertindak per tahap mengikuti level persis seperti lama: L3 pajak/jurnal/bayar, L4 & L5 persetujuan. Capability `sign.upload` dihapus (O4: tanpa TTD basah).
- **`GET /api/finance/queues?stage=pajak|persetujuan|jurnal|bayar`** (port `getFinanceQueues`): pemetaan status sama dengan lama (Manager Approved → pajak, Tax Verified → persetujuan, Wet Signed → jurnal, COA Posted/Partially Paid → bayar), lintas brand/divisi. Ringkasan per tahap: jumlah, total Rp (tahap bayar = sisa tagihan), umur tertua. Kolom ringkas saja: **tanpa NPWP, rekening, email pembuat** (detail lewat `/pengajuan/{id}`, I13). Bacaan tampilan ber-cache; flag `basi` bila salinan lama dipakai. Ajuan sendiri ditandai (`ajuanSendiri`, untuk I6 di F2-B).
- **UI `/finance`**: tab 4 tahap (jumlah + total), cari, urut (terlama / jatuh tempo / nominal), kartu daftar (badge CFO, "Ajuan Anda", lewat jatuh tempo), panel detail + lampiran, panel rincian. Menu "Finance" di sidebar; beranda Finance menampilkan 4 kartu antrean. Aksi tiap tahap menyusul (F2-B..F2-E).
- Label status `Tax Verified` kini "Menunggu Fin. Mgr / CFO" (O4).

## Fase 2 / F2-B — Verifikasi pajak (2026-10-24)
- **`POST /api/finance/{id}/verifikasi-pajak`** (port `verifyTax`, `src/server/finance-aksi.ts`): hanya Finance Staff (L3). Input `{etag, invAmount, diskon, biayaLain, statusPPN, jenisPPh, notes?}` STRICT, rupiah bulat. Di dalam lock dari baca segar: status harus Manager Approved (I3) → etag → **I6 blokir keras** (pengaju = verifikator, email dinormalisasi; percobaan dicatat `TAX_VERIFY_BLOCKED_SOD`) → **I2** DPP/PPN/PPh/nominal akhir dihitung ulang server dengan **tarif PPh SEGAR** (bukan cache) & NPWP vendor dari baris → **I1** `REQUIRE_CFO` dihitung ulang. Satu batch: baris (→ Tax Verified, `OS_BALANCE`) + approval Level 3 atas nama verifikator + `STATUS_CHANGE` (+ `TAX_ADJUST` bila nominal berubah, `CFO_FLAG` bila flag CFO berubah). Idempotency-Key wajib; dua Finance bersamaan → satu berhasil, satu 409.
- **`POST /api/finance/{id}/kembalikan`** (port `financeReject`): L3, alasan wajib (≥ 3 huruf) → Revision Needed, `NOTES_FINANCE` = `[DITOLAK FINANCE] …` (PIC melihat "Dikembalikan Finance: …"), approval L3 REJECTED. Dari Manager Approved / Tax Verified / Wet Signed / COA Posted. Pengaju sendiri boleh mengembalikan (tidak melepaskan uang, sama dengan lama).
- **UI** di panel kanan tab Verifikasi pajak: isian gross/diskon/biaya lain, Status PPN, Jenis PPh (Master_PPh), pratinjau DPP/PPN/PPh/nominal akhir (tampilan; angka final dari server), peringatan bila nominal berubah & badge CFO, dialog konfirmasi Loloskan dan dialog Kembalikan (template alasan). Ajuan sendiri: tombol Loloskan dikunci.
- Notifikasi WA ke PIC saat dikembalikan Finance menyusul di F2-F.

## Fase 2 / F2-C — e-approve Fin. Mgr / CFO (2026-10-24, O4)
- **`POST /api/finance/{id}/setujui`** `{etag, sebagai: 'finmgr'|'cfo', notes?}` (`setujuiFinance`): menggantikan unggah scan TTD basah (`submitWetSignature` **tidak diport**, O4 tanpa transisi). Identitas dari **sesi** (menutup R-17); **step-up password wajib** setiap e-approve (5 menit per sesi); Idempotency-Key & etag wajib; status harus Tax Verified.
- **Urutan & aturan** (`cekEApprove`, `statusPersetujuan` di `src/domain/finance.ts`): Fin. Mgr (L4, level persis) dulu; CFO (L5) hanya bila `REQUIRE_CFO` = YES, setelah Fin. Mgr, dan **oleh orang berbeda** dari Fin. Mgr. Persetujuan dibaca **segar** dari `Trx_Approval` dan hanya yang dicatat **setelah verifikasi pajak terakhir** yang berlaku (dokumen yang dikembalikan lalu diverifikasi ulang tidak membawa persetujuan lama). Fin. Mgr tanpa CFO, atau CFO → **Wet Signed** (enum lama, label "Menunggu Jurnal COA"); Fin. Mgr saat CFO wajib → tetap Tax Verified ("Menunggu CFO").
- **Penanda SoD (bukan blokir, selaras O5b):** penyetuju = pengaju / verifikator pajak → `[Penanda SoD: …]` di catatan approval & audit.
- **Kembalikan ke PIC** dari tahap persetujuan kini juga oleh Fin. Mgr / CFO (approval L4/L5 REJECTED); Finance Staff tetap bisa dari semua tahap Finance.
- **Voucher:** kotak TTD L4/L5 kini E-Signed (`SIGN_METHOD`); catatan lama ber-Method `WET` tetap tampil "TTD Basah — Terverifikasi".
- **UI** tab Persetujuan: daftar periksa Fin. Mgr / CFO (siapa sudah menyetujui), tombol "Setujui sebagai Fin. Mgr/CFO" sesuai giliran → dialog 2 langkah (konfirmasi → password), badge "Menunggu CFO" di kartu.

## Fase 2 / F2-D — Jurnal COA (2026-10-24)
- **`POST /api/finance/jurnal`** `{items: [{id, etag, lvl1..lvl5, budget, notes?}]}` (port `postJournalBulk`, `jurnalCoa`): Finance Staff (L3), **1–30 dokumen**, ID ganda dalam satu permintaan ditolak, Idempotency-Key wajib untuk seluruh batch.
- Lock semua `trx:` (berurut) → **satu** baca segar `Trx_Pengajuan` + `Master_COA` → validasi per dokumen (status Wet Signed, etag, kombinasi COA, budget) → yang valid diterapkan dalam **satu batch tulis** (30 dokumen = 1 panggilan tulis); yang gagal dilaporkan per dokumen tanpa menggagalkan sisanya; semua gagal = 422 berisi alasan. Fault injection: tulis gagal = tidak ada dokumen setengah berubah.
- Aturan lama (`validasiJurnal`): Level 1 & 2 wajib, budget wajib (huruf besar), kombinasi harus ada di Master_COA ("-" = level tidak dipilih), `SUB_COA` = level terdalam yang dipilih; `CATEGORY_COA`/`HEAD_COA`/`BUDGET` terisi, `NOTES_FINANCE` diganti catatan jurnal; → **COA Posted** ("Siap Dibayar"); audit `STATUS_CHANGE` + `COA_POST` per dokumen.
- **Beda dari sistem lama (keputusan user 2026-10-25): Plafon budget DINONAKTIFKAN di semua tempat.** Isian budget dihapus dari form jurnal dan tidak lagi wajib (`validasiJurnal`); kolom `BUDGET` tidak ditulis lagi (data lama dibiarkan); **syarat "budget terisi" dihapus dari `cekBolehDibayar` (I4)**; export Odoo tetap punya kolom *Analytic Account* tapi kosong (format CSV/template import tidak berubah); dimensi rekap "Budget" dan baris "Plafon budget" di voucher dihapus. Field `budget` dari klien lama masih diterima API tapi diabaikan.
- **UI** tab Jurnal COA: centang beberapa dokumen → isian sama diterapkan ke semua ("isi sama untuk yang dicentang"); dropdown COA bertingkat 5 level (level tanpa turunan otomatis "-"), budget, catatan, pratinjau akun yang dijurnal, dialog konfirmasi, ringkasan hasil per dokumen.

## Fase 2 / F2-E — Pembayaran (2026-10-24)
- **`POST /api/finance/bayar`** `{items: [{id, etag, nominal}], tglBayar, sumberRekening, refNo?, konfirmasiDuplikat?}` (port `executePayment`/`executePaymentBulk`, fungsi `bayar`): Finance Staff (L3), **step-up password wajib**, Idempotency-Key wajib, 1–30 dokumen, ID ganda ditolak, tanggal tidak boleh di masa depan, rekening sumber harus akun kas dari Master_COA (`bangunKas`).
- Lock semua `trx:` → **satu** baca segar Trx_Pengajuan, Trx_Approval, Trx_Payment_Log, Master_COA → per dokumen: **I4** `cekBolehDibayar` (COA Posted/Partially Paid; Manager, verifikasi pajak, Fin. Mgr, CFO bila wajib; Sub COA & budget; **tanpa** syarat scan TTD, O4) → etag → **pembayaran kembar** (ID+tanggal+nominal+ref sama dalam 10 menit) butuh `konfirmasiDuplikat` (R-04) → **I5** `hitungBayar`: total dibayar dari **Trx_Payment_Log** (bukan kolom ringkasan), nominal ≤ sisa + Rp 1.000, sisa dalam toleransi = lunas. Yang valid: **satu batch** (log append + `TOTAL_PAID`/`OS_BALANCE`/`PAY_STATUS`/`LAST_PAY_DATE` + status Partially Paid/Paid + audit `STATUS_CHANGE` & `PAYMENT`); yang gagal dilaporkan per dokumen; semua gagal = 422 (kembar = 409 `duplikat`).
- **O5b:** pembayar = verifikator pajak / Fin. Mgr / CFO dokumen itu → peringatan di UI + `[Penanda SoD O5b: …]` di audit, **bukan blokir**.
- Teruji: race 20 pembayaran paralel tidak pernah overpay; kolom ringkasan yang dirusak tidak membuka overpay; klik ulang dengan kunci sama = satu pembayaran; fault injection = tidak ada log setengah tercatat.
- **UI** tab Siap dibayar: centang beberapa dokumen; nominal per dokumen (default sisa, petunjuk lunas/cicilan), tanggal transfer, rekening kas, no. ref, total; badge "Belum boleh dibayar" + alasan; peringatan O5b; dialog konfirmasi berisi tabel hasil per dokumen → password → hasil; dialog konfirmasi pembayaran kembar.

## Fase 2 / F2-F — Notifikasi, riwayat bayar, digest Finance (2026-10-24)
- **Notif WA ke PIC saat dikembalikan Finance** (Finance Staff / Fin. Mgr / CFO): "dikembalikan oleh Finance" + alasan + link revisi, dikirim **setelah** respons (`after()`), dedup per transisi (terpisah dari pengembalian Manager); gagal kirim tidak pernah menggagalkan aksi (I15).
- **Riwayat pembayaran** (port `getPaymentHistory`/`getTotalPaidFromLog`): `GET /api/pengajuan/{id}/payments` dan bagian **Pembayaran** di detail dokumen (tanggal, nominal, rekening sumber, ref, oleh; total dibayar & sisa) — dihitung dari `Trx_Payment_Log`; akses = I13 (selain itu 404).
- **Digest WA Finance** (`kirimDigestFinance`, ikut dipicu `GET /api/cron/digest` di jadwal yang sama): satu ringkasan per pengguna Finance yang punya antrean untuk **ditindak** — Finance Staff: verifikasi pajak (tanpa ajuan sendiri, I6), jurnal, siap dibayar (yang lolos I4; total sisa); Fin. Mgr: belum disetujui Fin. Mgr; CFO: sudah Fin. Mgr & butuh CFO (bukan yang dia setujui sebagai Fin. Mgr). Link ke `/finance?tahap=…`, **tanpa kode SETUJU/TOLAK**. Kunci 4 menit; gagal kirim dihitung, tidak melempar; gagal digest Finance tidak menggagalkan digest Manager.
- **`/api/home`**: `bisa.finance` = L3/L4/L5; `antreanFinance` = jumlah per tahap (beranda Finance sudah menampilkan 4 kartu sejak F2-A).

## Fase 2 / F2-G — Hardening & UAT Finance (2026-10-24)
- **Review keamanan jalur uang** (independen, adversarial): tidak ada bypass otorisasi, bayar ganda, overpay, atau celah gerbang I4. Temuan yang diperbaiki:
  - akun **tanpa email** tidak boleh bertindak di jalur uang (sebelumnya satu orang ber-L4+L5 tanpa email bisa memberi dua tanda tangan; penanda O5b juga buta);
  - verifikasi pajak dengan **nominal akhir 0** ditolak (dokumen tidak macet di Siap Dibayar);
  - **wajib CFO** = `REQUIRE_CFO` = YES **atau** nominal tersimpan ≥ Rp 5 jt (`wajibCFO`) di persetujuan, gerbang bayar, dan antrean — baris lama/diedit manual tidak bisa melewati CFO;
  - waktu verifikasi pajak tak terbaca → persetujuan L4/L5 lama **tidak** dihitung (gagal tertutup);
  - form menangani hasil "dipulihkan" setelah tulis ambigu ("sudah tersimpan, muat ulang");
  - riwayat bayar tidak menampilkan email mentah pembayar (fallback "Finance");
  - digest Manager & Finance saling independen (yang satu gagal tidak menghentikan yang lain).
- **Kuota**: bayar / jurnal 30 dokumen = 1 panggilan tulis + baca terbatas (≤ 5 / ≤ 4), dites dengan penghitung panggilan.
- **Matriks otorisasi** semua aksi Finance × level 1/2/3/4/5/9 dites (tidak berwenang = 403 sebelum menyentuh data).
- **Uji beban** `npm run load-test`: `LOAD_FINANCE` (Fase A ikut membaca antrean Finance), **Fase C** opt-in (`LOAD_PAY_DOCS`, `LOAD_PAY_REK`; mengubah data dummy) = 10 pembayaran paralel + replay → lulus bila ≤ 1 sukses & tanpa overpay.
- **UAT**: `docs/desain/f2-uat-runbook.md` (F1–F21) — **menunggu dijalankan** di Vercel trial.

## Fase 3 / F3-A — Pendaftaran & pengesahan vendor (2026-10-24)
- **`POST /api/vendors`** (port `submitNewVendor`, `src/server/vendor.ts`): PIC / Manager / Finance Staff / Admin. Validasi lama (nama, tipe Trade/Non-Trade, bank, nama pemilik, rekening **6–20 digit**; huruf besar; spasi/titik/strip di nomor rekening dibuang) → status **Pending**, pendaftar & tanggal dari server, kode **VND-xxxx** lewat `nextId` dalam lock `seq:VND` (bootstrap dari nomor tertinggi di sheet).
- **I7 rekening unik** (bank + nomor) dicek dari baca segar di dalam lock `vendor-rek:{bank}:{no}` (dua pendaftaran bersamaan → satu). Vendor **Rejected tidak menghalangi** pendaftaran ulang (lama: semua baris). Pesan duplikat: Finance melihat vendor pemilik rekening; pendaftar lain hanya pesan umum (tidak membocorkan data vendor lain). Audit `VENDOR_CREATE` tanpa nomor rekening penuh.
- **Pengesahan berdasarkan KODE** (`POST /api/vendors/{kode}/approve|reject`, menutup **R-21**): Finance Staff; di dalam lock dari baca segar: status harus Pending (Rejected tidak bisa dihidupkan), rekening yang dilihat pengesah harus sama dengan sheet (409), **maker-checker** pendaftar ≠ pengesah (menolak miliknya sendiri boleh), I7 dicek ulang saat mengesahkan. Tolak: alasan wajib (dicatat di audit `VENDOR_REJECT`).
- **`GET /api/vendors?status=pending`**: antrean pengesahan (Finance Staff) dengan peringatan (NPWP kosong, nomor rekening sama di bank lain, nama vendor sama); tanpa parameter = vendor yang saya daftarkan (rekening disamarkan).
- **UI `/vendor`** + menu "Vendor": form daftar, daftar vendor saya + status, tab "Menunggu pengesahan" (Sahkan / Tolak + dialog); wizard langkah Vendor menautkan "Daftarkan vendor baru". Vendor baru dipakai di pengajuan setelah Approved (I8).

## Fase 3 / F3-B — Export jurnal Odoo (2026-10-24, I16)
- **`POST /api/finance/export/odoo`** `{dari, sampai, jenis}` (port `exportJurnalOdoo`, `src/domain/odoo.ts` + `src/server/export-odoo.ts`): capability `export.odoo` (Finance Staff / Fin. Mgr / Admin). Baca **segar** Trx_Pengajuan + Trx_Payment_Log (tidak dari cache).
- Dua jurnal persis sistem lama: **Pembelian** (status COA Posted / Partially Paid / Paid, difilter `DATE_INVOICE`, kosong → `TIMESTAMP`; beban = DPP + biaya lain − diskon, PPN Masukan, Hutang PPh, Hutang Usaha = nominal akhir) dan **Pembayaran** (per baris Payment Log: debit Hutang Usaha, kredit akun kas `Sumber_Rekening`; kosong → Hutang Usaha seperti lama). Akun perantara tetap `1-10500 PPN Masukan`, `2-10100 Hutang Usaha`, `2-10300 Hutang PPh`. Nama file `Odoo_{jenis}_{yyyyMMdd}_{yyyyMMdd}.csv`.
- **Rentang = hari WIB inklusif** (lama: zona script; server baru UTC → dibandingkan per tanggal WIB). Golden test `tests/golden/odoo.json` = hasil rumus lama untuk set contoh (selisih nol).
- **Beda dari lama (tercatat):** (1) sel teks yang diawali `= + - @ TAB CR` diberi apostrof (anti formula injection; `-` tunggal tetap); (2) **peringatan** tanpa mengubah CSV: entry debit ≠ kredit (pembulatan), pembayaran tanpa akun kas, tanggal invoice kosong; (3) maks. 6 export/menit/pengguna.
- File CSV disimpan ke folder Shared Drive (`DRIVE_ROOT_ID`, prefix `Odoo_` — tidak tersentuh pembersih lampiran yatim yang hanya `invoice_`) **dan** langsung terunduh di browser. **Riwayat** = baris Audit_Log `EXPORT_ODOO` (siapa, kapan, jenis, rentang, jumlah entry, nama+ID file); `GET /api/finance/export/odoo` daftar terbaru, `GET /api/finance/export/odoo/{fileId}` unduh ulang — hanya file yang tercatat di riwayat dan masih di folder.
- **UI `/export`** + menu "Export Odoo".

## Fase 3 / F3-C — Admin: user, master, health, repair (2026-10-24)
- Semua di bawah `admin.manage` (**Level 9 saja**), UI **`/admin`** (tab Pengguna · Kesehatan · Integritas data · Master · Repair), `src/server/admin.ts` + `src/domain/admin.ts`.
- **Pengguna** (`GET/POST /api/admin/users`): daftar Master_User_TTD (hash/salt tidak pernah keluar, hanya penanda "belum punya password"); tambah/ubah satu baris lewat form (**wajib password/step-up**; ubah = nomor baris + etag isi baris, dicek dari baca segar di lock `admin:users` + `user:{hp}` → 409 bila basi). Nomor dinormalisasi `62…`, level ∈ 1/2/3/4/5/9, email wajib (bukan `@domain.com`), brand/dept wajib (ALL untuk Finance/CFO/Admin). Peran kembar (nomor+brand+dept+level sama) ditolak. Password ikut nomor: nomor yang sudah punya password → hash/salt disalin (aturan lama identik per nomor), nomor baru → kosong. **Tidak boleh menyisakan nol System Admin aktif.** Sesudah simpan, semua sesi nomor lama & baru dicabut. `POST /api/admin/users/link` kirim link set-password ke WA (link tidak ditampilkan ke admin); `POST /api/admin/users/logout` paksa logout. Audit `USER_CREATE/USER_UPDATE` (nomor disamarkan), `ISSUE_SETPASS_LINK`, `FORCE_LOGOUT`.
- **Kesehatan** (`GET /api/admin/health`): uji Redis (tulis+baca), Sheets, folder Drive, WA terkonfigurasi; cron terakhir (`cron:last:*` dicatat digest & lampiran-yatim); validator header semua tab (`runHealth`).
- **Integritas** (`GET /api/admin/integritas`): port `auditDataIntegrity` baca-saja (rekening vs Master_Vendor + nol hilang, kelebihan bayar, TOTAL_PAID/OS vs payment log, log tanpa dokumen, prefix PO, SJ yatim, PO Trade tak ada, vendor rekening kembar/tanpa rekening, user tanpa email/nomor, ada L4/L5 aktif); unduh CSV. Beda: laporan tampil di halaman (lama: tab `_REPAIR_REPORT`); pesan user disesuaikan login nomor HP.
- **Master** (`GET /api/admin/master`): jumlah baris + validator (prefix PO ganda, brand tanpa company, COA bolong/ganda, tarif PPh bukan desimal 0–1, jenis PPh ganda). Edit tetap di Sheet.
- **Repair** = pratinjau (snapshot rencana, Redis 15 mnt, tidak menulis) → konfirmasi → eksekusi (`POST /api/admin/repair/jalankan`: password + Idempotency-Key; rencana dihitung ulang dari baca segar di dalam lock `trx:{id}` semua baris; beda dari pratinjau → 409) → laporan. Satu batch: perubahan + audit `REPAIR` + audit `REPAIR_ROW` per baris berisi nilai sebelum/sesudah (rollback manual). Maks. 100 baris/eksekusi.
  - **Rekonsiliasi pembayaran** (port `reconcilePayments`): TOTAL_PAID/OS_BALANCE/PAY_STATUS dari Trx_Payment_Log; kelebihan bayar → Paid + dilaporkan. Beda: hanya baris ber-ID yang punya pembayaran dan nilainya berbeda (lama menulis ulang semua baris termasuk baris kosong).
  - **Nol di depan rekening** — **perlu konfirmasi user:** port `repairNoRekening` DIPERSEMPIT ke kasus nol hilang saja. Lama menimpa rekening/bank/NPWP/nama/kode SEMUA dokumen dari Master_Vendor per nama vendor, yang bisa mengalihkan tujuan bayar dokumen belum dibayar; kasus lain tetap dilaporkan di Integritas untuk ditangani manual.

## Fase 3 / F3-D — Laporan & viewer audit (2026-10-24)
- **UI `/laporan`** + menu "Laporan" (`src/domain/laporan.ts`, `src/server/laporan.ts`). Capability baru (keputusan default, bisa diubah user): **`report.view`** = Finance Staff, Fin. Mgr, CFO, Admin; **`audit.view`** = Fin. Mgr, CFO, Admin.
- **Satu sumber angka:** semua laporan dihitung dari baris Trx_Pengajuan + Trx_Payment_Log yang sama; "dibayar" selalu = jumlah Payment Log (bukan kolom TOTAL_PAID), sama dengan rekonsiliasi. Dibaca lewat cache tampilan 15 dtk (laporan baca saja; penanda "salinan lama" bila Sheets sibuk).
- `GET /api/laporan/aging`: **aging AP** dokumen yang sudah lolos Manager dan belum lunas (Manager Approved … Partially Paid), umur dari **jatuh tempo** (WIB): belum jatuh tempo / 0–30 / 31–60 / > 60 hari / tanpa jatuh tempo; ringkasan per kelompok + **outstanding per vendor** (sisa, lewat terlama) + rincian.
- `GET /api/laporan/rekap?dari&sampai&dimensi=brand|dept|coa|vendor`: rekap per periode (tanggal invoice, kosong → submit — sama dengan export Odoo; dokumen Submitted … Paid, tanpa Draft/Revisi/Ditolak): jumlah dokumen, nominal, dibayar, sisa + total.
- `GET /api/laporan/pembayaran?dari&sampai`: log pembayaran per tanggal bayar + total.
- `GET /api/audit?id&aktor&aksi&dari&sampai`: **viewer Audit_Log** baca-saja, terbaru dulu, maks. 300 baris (jumlah cocok tetap ditampilkan); penanda idempotensi disembunyikan.
- Semua tabel bisa diunduh CSV (sel teks di-escape anti formula). Test `tests/f3d-laporan.test.ts` memakai contoh perhitungan manual (total sisa Rp 16.000.000, dsb.).

## Fase 3 / F3-E — Backup, arsip (kandidat), housekeeping (2026-10-24)
- **Backup harian** (`/api/cron/backup`, Vercel Cron `30 18 * * *` UTC = 01:30 WIB, Bearer `CRON_SECRET`): salin spreadsheet ke folder **`DRIVE_BACKUP_ID`** (env baru, opsional; Shared Drive terpisah dari lampiran karena salinan memuat hash password; trial: drive harus berjudul DUMMY). Nama `BACKUP_P2P_YYYY-MM-DD` (tanggal WIB), sekali per hari (idempoten). **Retensi 7 harian + 4 mingguan**; hanya file bernama format backup yang di-trash. Audit `BACKUP`. Env kosong → "dilewati" (tercatat di Admin › Kesehatan).
- **Status cron** (`cron:last:*` di Redis): digest, lampiran-yatim, backup → tampil di Admin › Kesehatan.
- **Housekeeping:** file lampiran yatim (sudah ada, harian); kunci idempotensi & lock di Redis kedaluwarsa sendiri (TTL) — tidak perlu cron.
- **Arsip (O10) — baru kandidat, perlu keputusan user:** Admin › Arsip & backup menampilkan dokumen Paid yang lunas > 18 bulan (baca saja). Pemindahan **belum** diimplementasikan karena: (1) menghapus baris menggeser nomor baris yang dipakai aksi lain yang sedang berjalan (R-21) — usulan aman: salin ke tab `Arsip_Pengajuan` lalu **kosongkan** baris asli (tanpa geser), di bawah lock per dokumen; (2) butuh tab baru di sheet (header validator akan memblokir tulis sampai tab dibuat); (3) detail/voucher/pencarian/laporan harus ikut membaca tab arsip agar "ID tetap bisa ditelusuri" dan "arsip tidak merusak laporan". Data dummy belum punya dokumen > 18 bulan, jadi belum bisa di-UAT.
- **Opsional** (PDF voucher server-side, dark mode, SSO admin, `onEdit` → bust cache, pusat notifikasi) belum dikerjakan.
- Runbook UAT Fase 3 + uji restore: `docs/desain/f3-uat-runbook.md`.

## Lonceng "perlu tindakan" (2026-10-24)
- Ikon lonceng di bar atas **untuk semua peran** (`src/ui/Lonceng.tsx`, `GET /api/notifikasi`, `src/domain/notifikasi.ts`). Angka merah = jumlah hal yang menunggu pengguna INI; klik → daftar dengan tautan langsung ke antreannya. Dimuat saat halaman dibuka, tiap 60 dtk selama tab terlihat, dan saat tab aktif lagi.
- Isi per peran: PIC (pengajuan dikembalikan, draft), Manager (antrean persetujuan berwenang, tanpa ajuan sendiri), Finance Staff (verifikasi pajak tanpa ajuan sendiri/I6, jurnal, siap bayar yang lolos gerbang I4, vendor menunggu pengesahan bukan daftaran sendiri), Fin. Mgr (belum ada persetujuan Fin. Mgr), CFO (≥ Rp 5 jt yang sudah disetujui Fin. Mgr lain), Admin (cron gagal/dilewati/tidak jalan > 25 jam).
- Semua bacaan lewat cache tampilan 15 dtk (tidak menambah beban kuota Sheets); sumber yang gagal dibaca dilewati. Baca saja — penjaga aksi tetap di server.
- Warna alert: tab/chip antrean yang menunggu tindakan Anda (mis. "Menunggu pengesahan" vendor, tahap Finance yang bisa Anda kerjakan) berlatar merah muda dengan angka merah. `/vendor?tab=pengesahan` dan `/admin?tab=…` membuka tab langsung.

## Kirim WA di tahap persetujuan Finance (2026-10-24)
- Panel tahap **Persetujuan Fin. Mgr / CFO** punya tombol **Kirim WA** di atas "Kembalikan ke PIC" (`src/ui/KirimWaFinance.tsx`, `POST /api/finance/{id}/kirim-wa`, `src/server/wa-manual-finance.ts`). Bisa ditekan Finance (L3/L4/L5).
- Tujuan otomatis = penyetuju **berikutnya**: Fin. Mgr (semua L4 aktif ber-nomor WA); setelah Fin. Mgr menyetujui dan dokumen butuh CFO (≥ Rp 5 jt / REQUIRE_CFO) → **CFO** (tidak termasuk orang yang sudah menyetujui sebagai Fin. Mgr). Persetujuan lengkap → tombol hilang.
- **Manual maks. 1x per tujuan** per siklus verifikasi (kunci Redis `wa:fin-manual:{id}:{finmgr|cfo}:{siklus}`; dikembalikan lalu diverifikasi ulang = siklus baru). Pengingat berikutnya lewat digest Finance terjadwal. Tidak ada yang terkirim → jatah dikembalikan.
- Pesan tanpa kode balasan (persetujuan Finance hanya lewat web + password, O4). Audit `WA_REMINDER_MANUAL` (Level 4 / Level 5).

## Ruang kerja verifikasi pajak (desain 2, 2026-10-24)
- Tahap **Verifikasi pajak** (Finance Staff): daftar tampil sebagai kartu; klik kartu membuka ruang kerja penuh — jejak "← Antrean verifikasi pajak / ID", header (status, vendor, peringatan, **Nominal akhir** + "dari nilai invoice"), baris info (pengaju, brand/dept, tipe, keperluan, no. invoice, jatuh tempo, detail lengkap), tiga kolom **Lampiran invoice** (gambar tampil langsung; PDF lewat "Tab baru" karena CSP `object-src 'none'`) · **Form verifikasi** (penjelasan status PPN, status NPWP) · **Rincian perhitungan & catatan**, dan footer **Kembalikan ke PIC / Loloskan verifikasi**.
- Peringatan (tampilan saja, tidak memblokir): diskon ≥ 20% dari nilai invoice, nominal akhir berubah, ajuan sendiri (Loloskan tetap terkunci, I6). Logika, endpoint, idempotensi, dan hitung ulang server (I2) tidak berubah.

## Urutan daftar: terbaru dulu (2026-10-24, keputusan user)
- Semua daftar di dashboard kini **terbaru dulu**: antrean Finance (default "Terbaru"; pilihan "Terlama di tahap" / jatuh tempo / nominal tetap ada), inbox persetujuan Manager, antrean pengesahan vendor, daftar user Admin, rincian aging AP (jatuh tempo terbaru dulu, tanpa jatuh tempo di akhir), kandidat arsip. Yang sudah terbaru dulu: pengajuan saya, vendor saya, beranda, log pembayaran, audit, riwayat export, pencarian.
- Beda dari sebelumnya: antrean Finance & inbox Manager dulu tertua dulu (FIFO). Timeline riwayat di detail dokumen tetap kronologis.

## Deploy
- **Trial (sekarang):** repo GitHub privat `unknown-88-jpg/p2p-portal`, branch `main` otomatis ter-deploy ke Vercel (team FAT, Hobby, project `p2p-portal`, URL produksi `https://p2p-portal-flax.vercel.app`). `vercel.json` memaksa region `sin1`. Banner "ENVIRONMENT TRIAL — DATA DUMMY" tampil selama `APP_ENV=trial`.
- **Environment variable** (nama saja; nilai jangan pernah masuk repo/chat): `APP_ENV`, `APP_BASE_URL` (harus sama dengan URL yang dibuka; dipakai cek origin/CSRF, jadi login di URL preview akan ditolak), `SHEET_ID`, `PROD_SHEET_IDS`, `DRIVE_ROOT_ID`, `GOOGLE_SA_JSON`, `JWT_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET`, `HEALTH_TOKEN`, `WA_GATEWAY_URL`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`, `WA_TRIAL_ALLOWLIST`. Perubahan variabel butuh redeploy.
- **GitHub Actions:** secret repo `APP_URL` dan `CRON_SECRET` untuk `digest.yml`.
- **Memindahkan nilai rahasia tanpa menampilkannya:** salin lewat clipboard (`... | clip.exe`), jangan `cat` file env di layar/screenshot. Jika terlanjur tampil, anggap bocor dan rotasi (kunci service account, `JWT_SECRET`, token Upstash, `CRON_SECRET`, `HEALTH_TOKEN`, API key gateway).
- **Alur perubahan:** branch → PR → `npm run check` hijau → review → merge ke `main` → Vercel deploy → uji di Production.
- **Go-live (Fase 4):** upgrade ke Vercel Pro (cron & batas Hobby), `PROD_SHEET_IDS`/spreadsheet produksi, database Upstash terpisah dan diberi nama baru (sekarang `p2p-spike`), hitung ulang kuota Upstash dengan jumlah user nyata, API key gateway lama dirotasi bersama Script Properties.
