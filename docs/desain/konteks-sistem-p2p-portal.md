# KONTEKS SISTEM: P2P Finance Portal (Google Apps Script)

> **Cara pakai file ini:** upload file ini di awal sesi chat baru, BERSAMA
> dengan file `.gs`/`.html` TERBARU yang di-export langsung dari Apps Script
> editor (bukan potongan kode dari chat lama manapun — yang di Apps Script
> editor adalah kebenaran tunggal/source of truth). File ini adalah
> RINGKASAN KEPUTUSAN, bukan pengganti kode aktual.
>
> Terakhir diperbarui: mengikuti sesi diskusi yang menghasilkan dokumen ini.
> Kalau ada perubahan besar setelah ini, perbarui bagian yang relevan.
>
> **Update 2026-09-18 (code review):** review menyeluruh (lihat
> `claude/code-review-2026-09-18.md`) menemukan dokumen ini sempat drift dari
> kode aktual di 2 poin. Anti-overbilling PO sudah DISINKRONKAN (dan
> aturannya SENDIRI direvisi ulang setelah klarifikasi user — lihat bagian
> 3). Kolom CASHOUT DIKOREKSI (ternyata tidak pernah ada di kode). Signature
> webhook WA (bagian 4) sudah DIPERBAIKI — model verifikasi diganti dari HMAC
> (tidak mungkin dibaca Apps Script) ke shared-secret via query string
> `?key=...`, fail-closed, setelah dikonfirmasi lewat screenshot Ops Panel
> Lixus asli bahwa field WEBHOOK URL-nya bebas diisi URL apa saja (termasuk
> path/port custom) — lihat bagian 4 untuk langkah setup produksi yang WAJIB
> dilakukan (isi WA_WEBHOOK_SECRET + update WEBHOOK URL di Ops Panel).
>
> **Update 2026-09-18 (malam) — E-APPROVER Fase 1:** kode untuk approval
> lewat login nomor HP + password (bukan lagi akun Google) SUDAH ditulis
> dan tervalidasi — lihat bagian 4b. Scope: SEMUA level (2, 4, 5) akhirnya
> mau diganti jadi e-approver (bukan cuma Level 2), tapi dikerjakan
> BERTAHAP — sesi ini baru menyelesaikan **Fase 1 (Level 2/Manager saja)**.
> Fase 2 (Level 4/5, gantiin upload TTD basah di `API_Finance.gs`) BELUM
> disentuh sama sekali. Sama seperti fix webhook di bagian 4, kode Fase 1
> ini juga BELUM LIVE — ada langkah manual di Apps Script UI (deployment
> kedua) yang wajib dilakukan dulu, lihat bagian 4b.

> **Update 2026-10-05 — Arah migrasi ke Vercel (DESAIN SAJA, belum ada kode):**
> user memutuskan memigrasi sistem ke web app Vercel (trial di Hobby, go-live
> di Pro), database tetap Google Spreadsheet + Google Drive, semua aktivitas
> di web app, UI/UX dikembangkan lebih komprehensif. Sesi ini hanya
> menghasilkan 3 dokumen (BUKAN kode): `claude/vercel-migration-design.md`,
> `claude/adr-001-vercel-sheets-drive.md`,
> `claude/vercel-migration-risk-register.md`. **Sistem produksi saat ini
> tetap Apps Script** dan tidak berubah — lihat bagian 8 untuk keputusan &
> pertanyaan terbuka. Ketiga dokumen itu menggantikan catatan lama
> "Next.js + Supabase belum diputuskan".

---

## 1. Apa Sistem Ini

**Portal Procure-to-Pay (P2P) Finance** — mengelola pengajuan pembayaran
vendor dari draft hingga dana cair, dibangun di atas **Google Apps Script**
(bukan Next.js/Supabase — itu masih sebatas wacana, lihat bagian 8).

Alur status baku (tidak bisa dilompati, divalidasi server via
`STATUS_FLOW`):

```
DRAFT → SUBMITTED → MANAGER_APPROVED → TAX_VERIFIED → WET_SIGNED
→ COA_POSTED → PARTIALLY_PAID → PAID
(cabang: REVISION_NEEDED, REJECTED)
```

Level otorisasi (`LEVEL` di Config.gs): 1=PIC, 2=Manager Divisi,
3=Staff Finance, 4=Manager Finance, 5=CFO.

---

## 2. Struktur File (per Sept 2026)

**Backend (.gs):**
`Config.gs` (STATUS/COL/LEVEL/CONFIG terpusat) · `Code.gs` (routing doGet/doPost,
+ guard anonim vs Google — lihat bagian 4b) · `Auth.gs` (identitas Google via
Session.getActiveUser UNTUK PIC/Finance/Home — TAPI sejak 2026-09-18 juga
berisi login e-approver nomor HP+password untuk Approval_Portal.html, lihat
bagian 4b) · `Utils.gs` (helper, lock, transitionStatus, + `bandingkanAmanString_`
pembanding string konstan-waktu bersama) · `Calc.gs` (hitung pajak/PPN/PPh) ·
`Approval.gs` (buildSignatureBlocks, recordApproval — kini terima identitas
lewat token ATAU Google, lihat bagian 4b) · `CRUD_Pengajuan.gs` · `CRUD_Vendor.gs`
· `API_Master.gs` · `API_PO.gs` · `API_Finance.gs` (Level 4/5 masih TTD basah —
BELUM disentuh Fase 2) · `API_Print.gs` ·
`Export_Odoo.gs` · `Setup.gs` · `Diagnostics.gs` · `Repair.gs` ·
`Notif_WA.gs` · `WA_Approval.gs` · `WA_Digest.gs`

**Frontend (.html):** `Index.html` (form pengajuan) · `Home.html` (gerbang
akses) · `Approval_Portal.html` (kini punya login nomor HP+password sendiri,
lihat bagian 4b) · `Finance_Index.html` · `Print_Form.html` ·
`SetPassword.html` (BARU 2026-09-18 — halaman set password approver dari
link WA sekali-pakai) · `CSS.html`, `JS_Common.html`, `JS_Main.html`, `JS_Finance.html`

**Konvensi wajib:** kolom baru SELALU ditambah paling kanan (`COL_COUNT`
naik), semua akses kolom lewat konstanta `COL`/`COL_USER`/`COL_WA` — TIDAK
PERNAH pakai angka magic (`getRange(row, 32)`). Master_User_TTD sekarang
punya 10 kolom (H=No_HP, I=Password_Hash, J=Password_Salt — lihat bagian 4b).

---

## 3. Keputusan Kontrol Keuangan — dan Kenapa

Ini bagian paling penting: bukan cuma APA yang dibangun, tapi KENAPA,
supaya sesi baru tidak "memperbaiki" sesuatu yang sebenarnya sengaja.

- **Gate CFO ≥ Rp 5.000.000**: TTD basah CFO wajib di atas ini,
  di-enforce di server (`bolehDibayar()`), bukan cuma validasi tampilan.
  Threshold yang sama juga dipakai untuk keputusan lain (lihat notif WA).
- **Segregation of duties — vendor**: pendaftar vendor ≠ pengesah vendor
  (maker-checker).
- **Segregation of duties — pajak**: staff Finance TIDAK BOLEH
  memverifikasi pajak atas dokumen yang ia ajukan sendiri. Diblokir KERAS
  di server (`verifyTax`, dibandingkan `CREATED_BY` vs email login) DAN
  di UI (tombol diganti badge "Ajuan Anda — minta rekan verifikasi").
  Keputusan: TIDAK memblokir tahap TTD basah (level 4/5) dengan cara yang
  sama — hanya tahap verifikasi pajak yang diminta user.
- **Anti-overbilling PO — model RETENSI PELUNASAN (revisi final, 2026-09-18).**
  Bukan lagi proporsional ketat terhadap qty diterima (versi awal yang
  sempat diimplementasikan lalu direvisi setelah klarifikasi user).
  Aturan final:
  - Porsi **BEBAS** = `grandTotal × (1 - CONFIG.PO_RETENSI_PELUNASAN_PCT)`
    (default 90%) boleh ditagih **KAPAN PUN, TANPA syarat Surat Jalan sama
    sekali**. Ini menutupi DP dan cicilan/partial payment biasa.
  - Porsi **RETENSI PELUNASAN** (default 10% terakhir) baru boleh ditagih
    kalau Surat Jalan sudah menunjukkan barang diterima **PENUH**
    (`qtySJ >= qtyPO`). Sebelum itu, plafon mentok di porsi bebas —
    tidak bisa "lunasin sampai bener-bener lunas" walau nominal invoice
    kecil.
  - PO jasa tanpa qty (`qtyPO <= 0`): tidak ada acuan qty sama sekali →
    bebas ditagih penuh dari awal (tidak berubah dari versi manapun).
  - Kumulatif dihitung lintas SEMUA dokumen non-REJECTED atas PO yang sama
    (mendukung cicilan DP → Pelunasan bertahap).
  - Konstanta retensi (`0.10` = 10%) ada di `CONFIG.PO_RETENSI_PELUNASAN_PCT`
    (Config.gs) — user eksplisit bilang boleh disesuaikan, jangan hardcode
    di tempat lain.
  - Diimplementasikan di `hitungPlafonSJ_()` (API_PO.gs, satu-satunya
    sumber kebenaran plafon — dipakai baik untuk **display**
    (`searchPODetails`, info di form pengajuan) MAUPUN **hard guard** saat
    submit (`assertPOTidakOverbilling_()`, dipanggil dari
    `submitPengajuan` di CRUD_Pengajuan.gs)). Divalidasi dengan 10 skenario
    simulasi (DP tanpa SJ sama sekali, pas di batas 90%, coba masuk retensi
    tanpa SJ, pelunasan setelah SJ lengkap, over-receipt, PO jasa, dokumen
    REJECTED diabaikan) — semua sesuai ekspektasi.
  - **Kenapa berubah dari versi proporsional awal** (`plafon = grandTotal ×
    qtySJ/qtyPO`, sempat diimplementasikan lalu direvisi hari yang sama):
    versi itu mensyaratkan SJ bahkan untuk DP sekecil apa pun kalau belum
    ada barang masuk sama sekali (`qtySJ=0` → plafon=0) — user bilang itu
    tidak sesuai praktik lapangan. Kata user persis: *"kalo DP gapapa
    belum ada surat jalan... kalo full payment/partial payment juga
    gapapa, tapi kalo outstanding sisa 10% perlu ada surat jalan dulu,
    jadi gabisa lunasin sampe bener-bener lunas."*
- **Anti-invoice duplikat & anti-overpayment**: nomor invoice unik;
  total pembayaran selalu dihitung ulang dari `Trx_Payment_Log` (bukan
  dari kolom ringkasan yang bisa salah/telat update).
- **Semua kalkulasi nominal (PPN/PPh/final amount) dihitung ulang di
  server saat disimpan** — angka dari browser tidak pernah dipercaya.
- **Export Odoo** memfilter berdasarkan `DATE_INVOICE` (tanggal
  akuntansi dari invoice vendor), BUKAN `TIMESTAMP` (tanggal submit draft)
  — supaya jurnal tidak "hilang" dari rentang ekspor kalau approval lintas
  bulan.
- **Kolom CASHOUT — TIDAK ADA di kode aktual (dikoreksi 2026-09-18).**
  Draft dokumen ini sebelumnya menyebut ada kolom terakhir "CASHOUT" (AW)
  yang menyimpan ringkasan sumber rekening pembayaran gabungan
  (digabung `; ` kalau dibayar bertahap dari rekening berbeda). Setelah
  dicek langsung ke `Config.gs`: `COL_COUNT = 48` dan kolom terakhir
  adalah `QTY_SJ` (AV) — tidak ada kolom AW/CASHOUT, dan tidak ada kode
  manapun yang menulis ringkasan semacam itu ke `Trx_Pengajuan`. Kalau
  butuh ringkasan sumber rekening per dokumen, itu HARUS diturunkan dari
  `Trx_Payment_Log` (sumber kebenaran yang sebenarnya sudah ada), bukan
  diasumsikan sudah tersimpan di kolom AW. Belum ada keputusan untuk
  benar-benar menambahkan kolom ini — kalau mau, ini fitur baru, bukan
  bug fix.
- **Header sheet "Soft File"**: kolom T (`FILE_URL`, soft file invoice) dan
  AH (`LINK_TTD`, scan TTD basah) SENGAJA diberi header sama "Soft File"
  atas permintaan user — bukan bug/typo.

---

## 4. Integrasi WhatsApp — Arsitektur & Keputusan Keamanan

**Gateway**: Baileys-based (WhatsApp Web reverse-engineered) — Lixus
WhatsApp Gateway, panel di `https://wa-we-store.lixus.id/api/docs`. Sesuai
OpenAPI spec resmi gateway ini (dikonfirmasi 2026-09-18): gateway ini
**centralized/shared** untuk beberapa consumer app internal ("Mini-CRM",
"Flow Delivery", dan portal ini) — bukan instance yang didedikasikan cuma
untuk P2P Finance Portal. Endpoint kirim: `POST /api/messages/send` dengan
body `{to, text}`, auth via header `X-API-Key`. Kredensial di Script
Properties: `WA_GATEWAY_URL`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`.

**Level 1 (selesai)**: notifikasi satu arah. Manager/PIC dapat WA saat ada
event, link ke portal domain-locked (`/a/macros/<domain>/...` — memaksa
buka akun Google kantor, bukan akun pribadi default browser).

**Level 2 (selesai secara fitur, TAPI verifikasinya rusak)**: approval
manager via balasan WA dengan kode unik 4-digit (`SETUJU 4821` /
`TOLAK 4821 <alasan>`).
- Webhook masuk lewat `doPost(e)` di Code.gs, di-route ke
  `handleWebhookWA()` di `WA_Approval.gs` kalau `?wa=hook`.
- Verifikasi dimaksudkan: HMAC-SHA256 signature (secret di Script
  Properties) + nomor pengirim harus cocok approver berwenang atas
  brand/dept dokumen (`hasAuthority`, sama seperti portal).
- ✅ **STATUS PER 2026-09-18 (sore) — DIPERBAIKI** (code review temuan #3).
  Root cause dikonfirmasi lewat OpenAPI spec resmi gateway ("Lixus WhatsApp
  Gateway API"): *"All webhooks include an `X-Gateway-Signature` header
  (HMAC-SHA256) for verification."* — signature dikirim lewat **HTTP
  HEADER**, dan Apps Script `doPost` TIDAK PERNAH bisa membaca custom HTTP
  header sama sekali (limitasi platform) — jadi desain HMAC lama tidak
  pernah mungkin diverifikasi dari kode ini, apa pun konfigurasinya.
  Dikonfirmasi juga lewat **screenshot Ops Panel gateway asli** (bagian
  "API Consumers" untuk consumer `wa-store.lixus.id`) bahwa: (a) field
  WEBHOOK URL memang free-text (saat dicek isinya masih default/dev
  `http://localhost:18080/api/wa/webh...` — jelas belum pernah diarahkan ke
  Apps Script sama sekali, jadi webhook approval realistanya belum pernah
  benar-benar nyampe ke portal), dan (b) sudah ada **WEBHOOK SECRET**
  ter-generate di sisi gateway (`[REDACTED]`)
  yang BELUM PERNAH disalin ke Script Property `WA_WEBHOOK_SECRET` (yang
  ini masih kosong sama sekali — dicek dari screenshot Script Properties).
  **Fix yang dieksekusi** (`WA_Approval.gs`, `Notif_WA.gs`, `Config.gs`):
  1. Model verifikasi diganti total dari "HMAC atas body/header" (tidak
     mungkin dibaca Apps Script) ke **shared-secret via query string**:
     `verifikasiKeyWebhookWA_()` (baru, `WA_Approval.gs`) membandingkan
     `e.parameter.key` dengan Script Property `WA_WEBHOOK_SECRET`
     (constant-time compare). `ambilHeader_()` (fungsi lama, cuma baca
     `?sig=`) dihapus — sudah tidak relevan.
  2. **FAIL-CLOSED** (disetujui user 2026-09-18): secret kosong ATAU key
     yang dikirim tidak cocok → webhook DITOLAK (`{ok:false, reason:
     "unauthorized"}`), bukan dilewati seperti desain lama.
  3. `cekKonfigurasiWA()` (`Notif_WA.gs`) diperbarui: kalau
     `WA_WEBHOOK_SECRET` sudah terisi, diagnostic ini sekarang mencetak
     **URL webhook lengkap yang harus didaftarkan di Ops Panel**
     (`<url exec>?wa=hook&key=<secret>`), supaya tidak perlu hitung manual.
  4. Divalidasi `node --check` (bersih untuk ketiga file) + simulasi 8
     skenario Node.js untuk `verifikasiKeyWebhookWA_` (secret kosong →
     selalu tolak; key benar → lolos; key salah/kosong/beda kapital/lebih
     pendek/lebih panjang → tolak) — semua sesuai ekspektasi fail-closed.
  - ⚠️ **LANGKAH PRODUKSI WAJIB sebelum deploy versi ini** (belum
    dilakukan user, ini bukan cuma "copy kode ke editor"):
    1. Isi Script Property `WA_WEBHOOK_SECRET` dengan nilai WEBHOOK SECRET
       yang SAMA seperti di Ops Panel gateway (`[REDACTED]` — user perlu ambil nilai LENGKAP/tidak terpotong dari
       panelnya, screenshot yang dikasih ke Claude terpotong).
    2. Update field WEBHOOK URL di Ops Panel gateway (API Consumers →
       `wa-store.lixus.id`) dari `http://localhost:18080/...` ke URL exec
       Apps Script + `?wa=hook&key=<secret yang sama>` (bentuk lengkapnya
       otomatis tercetak oleh `cekKonfigurasiWA()` begitu secret diisi).
    3. Kalau urutannya kebalik (deploy dulu, isi secret belakangan) →
       approve-via-WA berhenti total di antara waktu itu (fail-closed).
- **Nominal ≥ Rp 5.000.000 wajib OTP 6-digit ke email kantor approver**
  (berlaku 5 menit) sebagai faktor kedua sebelum diproses — karena WA
  sendirian dianggap tidak cukup aman untuk nominal besar. Catatan:
  lapisan OTP-email ini TIDAK terpengaruh oleh bug signature di atas
  (jalur email terpisah dari webhook WA) — jadi risiko riil forging
  approval nominal besar tetap dibatasi OTP, meski lapisan HMAC-nya
  sendiri saat ini efektif dekoratif/rusak.
- **KEPUTUSAN SADAR**: user & atasan MEMILIH "semua nominal boleh via WA"
  (tanpa exception wajib-portal untuk nominal sangat besar), meski Claude
  merekomendasikan sebaliknya (≥5jt tetap wajib portal). User menerima
  risiko ini secara eksplisit. Kalau di sesi depan ada insiden atau
  keresahan soal ini, ingat: ini bukan bug, ini keputusan bisnis yang
  sudah didiskusikan dan disetujui.
- **Kenapa BUKAN poll WhatsApp**: vote poll di WhatsApp itu raw/terenkripsi
  dari Baileys, gateway tidak menyediakan cara reliable memetakan
  vote↔dokumen. Kode unik dipilih karena lebih robust.
- **Kenapa BUKAN tombol interaktif**: WhatsApp sudah menonaktifkan
  interactive buttons untuk akun non-official-API sejak pertengahan 2023;
  gateway berbasis Baileys tidak punya endpoint untuk ini.
- Approval via WA tercatat di `Trx_Approval` dengan method="WA" untuk
  jejak audit yang jelas.

**Model notifikasi = DIGEST TERJADWAL, bukan instan per-dokumen.**
Keputusan eksplisit setelah membahas 3 opsi (ringkasan+detail berjeda,
digest terjadwal, tarik-manual "LIHAT") — dipilih digest karena paling
efektif mengurangi frekuensi gangguan, bukan cuma memindah bentuknya.
User secara eksplisit MENOLAK skema "urgent notify instan" (khawatir
menciptakan tekanan menyelesaikan satu dokumen padahal bisa dibatch).
Trigger time-driven manual perlu dipasang user ke fungsi `kirimSemuaDigest`
(memanggil `kirimDigestManager` + `kirimDigestFinance`). Cek status
terpasangnya trigger ini sekarang bisa lewat `cekKonfigurasiWA()`
(ditambahkan 2026-09-18) — sebelumnya tidak ada cara programatik untuk
tahu trigger ini hidup atau mati.

**Finance TIDAK approve via WA** — hanya notifikasi ringkasan gabungan
("3 perlu verifikasi pajak, 2 perlu jurnal COA, 1 siap dibayar") yang
mengarahkan ke dashboard. Alasan: kerjaan Finance (isi data pajak, upload
scan TTD, pilih akun COA, pilih rekening bayar) adalah data entry yang
butuh layar — bukan keputusan ya/tidak yang bisa diringkas jadi balasan
WA.

---

## 4b. E-APPROVER — Login Nomor HP + Password (Fase 1, 2026-09-18)

**Permintaan user:** semua approval (bukan cuma Level 2 Manager — TERMASUK
Level 4/5 CFO/Finance Manager yang tadinya TTD basah) diganti jadi
"e-approver" penuh, dan tiap approver punya akun login dashboard sendiri —
**pakai nomor HP, BUKAN akun Google** ("nomor HP dan Password bro" — kata
user persis). Dikerjakan **bertahap**: sesi ini = **Fase 1 (Level 2 saja)**.
Fase 2 (Level 4/5, gantiin upload TTD basah di `submitWetSignature`,
`API_Finance.gs`) **BELUM dimulai**.

**Keputusan yang sudah eksplisit dikonfirmasi user:**
- Balasan WA (`SETUJU/TOLAK <kode>`, `WA_Approval.gs`) **TETAP ADA** sebagai
  jalur paralel — TIDAK dihapus/diganti. Approver bebas pakai jalur mana pun.
- Login = **nomor HP + password** (bukan OTP-only, bukan tetap Google SSO).
- Provisioning password = **link set-password sekali-pakai via WA** (bukan
  admin set manual, bukan approver pilih sendiri saat pertama daftar).
- Login di `Approval_Portal.html` = **ganti total** dari Google SSO — bukan
  tambahan metode login kedua.
- Soal risiko legal/compliance melepas TTD basah CFO/Finance Manager: user
  minta pendapat Claude ("menurut lu gimana bro?"), Claude menyarankan
  hati-hati (masih ada OTP email + konfirmasi sebagai mitigasi), user
  memilih tetap lanjut dengan alasan sudah ada OTP+konfirmasi approve.
  **Catatan untuk Fase 2 nanti**: ini keputusan bisnis yang sudah dibahas,
  bukan sesuatu yang perlu didebat ulang dari nol — tapi WORTH direview
  kalau ada masukan compliance/auditor eksternal sebelum benar-benar
  dieksekusi ke Level 4/5.

**Kendala platform yang membentuk arsitektur (bukan pilihan desain bebas):**
Google Apps Script **mengecek akses deployment (siapa boleh buka URL)
SEBELUM kode apa pun di project ini sempat jalan** — jadi tidak mungkin
bikin approver "tidak perlu akun Google" kalau satu-satunya deployment
masih diset akses domain-restricted. **Solusinya wajib DUA deployment**:
1. Deployment **UTAMA** (sudah ada) — access: domain kantor. Tetap dipakai
   Home/ajukan/finance/print, identitas Google seperti biasa.
2. Deployment **KEDUA** (BARU, harus dibuat manual) — access: **Anyone**.
   Khusus dipakai approver buka `?page=approval` & `?page=setpass` tanpa
   akun Google sama sekali. Ini **langkah manual di UI Apps Script**
   (Deploy → New deployment → Web app → Who has access: Anyone) — **TIDAK
   BISA dilakukan dari kode**, harus user/admin yang klik di editor.

**Yang sudah dikerjakan & tervalidasi (Fase 1, kode saja — lihat "belum
live" di bawah):**
- `Config.gs`: kolom baru `Master_User_TTD` (I=`Password_Hash`,
  J=`Password_Salt`, lewat `COL_USER`), constant `APPROVER_SESSION_TTL_SEC`
  (6 jam), `APPROVER_SETPASS_TOKEN_TTL_MIN` (60 menit),
  `APPROVER_HASH_ITERASI` (3000).
- `Utils.gs`: `bandingkanAmanString_()` — pembanding string konstan-waktu,
  DISATUKAN dengan yang dipakai `verifikasiKeyWebhookWA_()` (webhook WA,
  bagian 4) supaya cuma 1 implementasi yang perlu dijaga benar.
- `Auth.gs` (fungsi baru): `hashPassword_()` (SHA-256 ber-salt, diulang
  3000x — BUKAN bcrypt/PBKDF2/Argon2 asli, Apps Script tidak punya
  library itu native, tapi jauh lebih baik dari SHA-256 sekali jalan),
  `garamAcakApprover_()`, `cariBarisApproverByNomor_()`,
  `setPasswordUntukNomor_()` (tulis hash/salt ke SEMUA baris milik nomor
  yang sama — satu orang bisa punya banyak baris brand/dept),
  `loginApprover()` (cek password, HANYA lolos kalau roles-nya include
  Level 2 — Fase 1 sengaja menolak Level 4/5 meski passwordnya benar),
  `sesiApprover_()`/`requireSesiApprover_()` (baca sesi dari
  `CacheService`), `logoutApprover()`, `kirimLinkSetPasswordApprover(nomor)`
  + `kirimLinkSetPasswordSemuaManager()` (ADMIN-RUN, dijalankan manual dari
  editor Apps Script — sama pola dengan `tesKirimWA`/`diagnosaEmail`, TIDAK
  diekspos sebagai tombol UI), `setPasswordViaToken()`.
- `Approval.gs`: `getPendingApprovals`, `managerApprove`, `managerReject`
  sekarang menerima `token` sesi login (bukan lagi identitas Google).
  `recordApproval()` **TIDAK breaking** — ditambah parameter opsional
  ke-6 (`identityOverride`); semua caller LAMA (`CRUD_Pengajuan.gs` untuk
  e-sign PIC, `API_Finance.gs` untuk Level 3/4/5 termasuk TTD basah) tetap
  jalan 100% sama seperti sebelumnya karena tidak mengirim parameter itu.
- `Code.gs`: route baru `?page=setpass` (ke `SetPassword.html`), dan guard
  — halaman SELAIN `approval`/`setpass` menolak akses kalau
  `getCurrentEmail() === "unknown@system"` (mencegah deployment "Anyone"
  dipakai buka Home/Index/Finance/Print tanpa akun Google sama sekali).
- `SetPassword.html` (baru) & `Approval_Portal.html` (rewrite total) —
  token sesi disimpan **HANYA di variabel JS in-memory**, BUKAN
  localStorage/cookie (reload halaman = harus login ulang, sesuai
  instruksi eksplisit user).
- `Setup.gs`: `setupDatabase()` sekarang juga melabeli header kolom I/J
  (`Password_Hash`/`Password_Salt`) — tidak menyentuh data, cuma header.
- Validasi: `node --check` bersih di SEMUA file yang diubah, plus 2
  simulasi Node.js — (a) 15 skenario auth (set password multi-baris,
  login benar/salah, akun nonaktif, level bukan Manager ditolak,
  password terlalu pendek, token sekali-pakai tidak bisa dipakai ulang,
  session hilang setelah logout), (b) 13 skenario token-based approval
  (token invalid ditolak sebelum masuk lock, otorisasi per-brand/dept
  tetap benar, `recordApproval` dengan/tanpa `identityOverride` menulis
  identitas yang benar, backward-compat caller lama tidak berubah).

**⚠️ BELUM LIVE — langkah manual WAJIB sebelum approver benar-benar bisa
pakai ini (sama seperti fix webhook di bagian 4, kode selesai ≠ aktif):**
1. Buat **deployment kedua** di Apps Script UI: Deploy → New deployment →
   Web app → **Execute as: Me**, **Who has access: Anyone**. Salin URL
   `/exec`-nya.
2. Isi Script Property `APPROVER_PORTAL_URL` dengan URL dari langkah 1 —
   dipakai `kirimLinkSetPasswordApprover()` untuk menyusun link WA yang
   benar (kalau kosong, fungsi itu menolak jalan & bilang kenapa).
3. Copy SEMUA file yang diubah sesi ini ke Apps Script editor (`Config.gs`,
   `Utils.gs`, `Auth.gs`, `Approval.gs`, `Code.gs`, `Setup.gs`,
   `WA_Approval.gs` — refactor kecil pakai `bandingkanAmanString_`,
   `Approval_Portal.html`, `SetPassword.html` BARU) lalu **Deploy versi
   baru** di deployment UTAMA juga (supaya Approval.gs/Code.gs yang baru
   ikut aktif di sana).
4. Jalankan `kirimLinkSetPasswordSemuaManager()` (atau satu-satu
   `kirimLinkSetPasswordApprover(nomor)`) dari editor Apps Script untuk
   mulai kirim link set-password ke Manager (Level 2) yang mau dipakaikan
   e-approver.
5. Sampai langkah 1-2 selesai, `Approval_Portal.html` masih HANYA bisa
   dibuka lewat deployment utama (artinya approver tanpa akun Google tetap
   tidak bisa masuk) — jalur balas WA tetap satu-satunya opsi bagi mereka
   sampai deployment kedua benar-benar hidup.

---

## 5. Chart of Accounts (COA)

Struktur `Master_COA`: 5 kolom (Level 1 Category → Level 5 Detail Account),
level yang tidak punya turunan diisi `-` (bukan dikosongkan), divalidasi
saat posting jurnal. File COA baru per revisi terakhir: 642 akun "Entry"
(akun transaksi final, header/kategori dikecualikan dari dropdown), plus
kolom tambahan Nomor Akun (6 digit) dan Saldo Normal yang ditambahkan atas
permintaan user (di luar 5 kolom asli, ditaruh di kolom F-G).

---

## 6. Diagnosis Masalah yang Pernah Muncul (referensi kalau muncul lagi)

- **"Email terdaftar tapi ditolak akses"**: kemungkinan besar
  `Session.getActiveUser().getEmail()` mengembalikan string kosong pada
  kombinasi setelan deployment/privasi tertentu → fallback ke
  `getEffectiveUser()` sudah ditambahkan. Tool diagnosa:
  `kenapaAkuDitolak()` (baca email yang BENAR-BENAR terbaca sistem,
  bandingkan ke sheet).
- **"Link selalu ganti tiap deploy"**: root cause selalu karena user
  memilih "New deployment" alih-alih "Manage deployments → Edit → New
  version". URL permanen hanya didapat dari cara kedua.
- **DNS error saat kirim WA**: `WA_GATEWAY_URL` diisi `localhost` —
  server Google tidak bisa akses localhost milik user. Harus URL publik.
- **HTTP 404 saat kirim WA**: path endpoint salah (`send-text` vs `send`
  — beda-beda tiap gateway, selalu cek dokumentasi OpenAPI gateway yang
  ASLI dipakai, jangan asumsi dari gateway generik).
- **Latensi "kadang cepat kadang lambat" di Apps Script**: didiagnosis
  sebagai kemungkinan besar KARAKTER PLATFORM (cold start, overhead
  google.script.run, Sheets API bukan database asli) — bukan bug yang
  bisa ditambal di kode, KECUALI belum pernah dicek: (a) jumlah baris
  Trx_Pengajuan sudah diarsipkan atau belum, (b) CacheService dipakai
  konsisten untuk semua master data, (c) mode deployment
  (USER_DEPLOYING vs USER_ACCESSING).

---

## 7. Preferensi Cara Kerja User (berlaku juga di sesi baru)

- Bahasa campuran Indonesia-Inggris santai ("bro"), teknis to the point.
- User APPRECIATE saat Claude mendorong balik/push-back sebelum eksekusi
  fitur berisiko (contoh: pertanyaan ulang soal threshold OTP, soal
  "semua nominal via WA") — bukan dianggap menghambat, tapi dihargai
  sebagai due diligence. Tetap hormati keputusan final user meski beda
  dari rekomendasi.
- User lebih suka Claude BACA KODE ASLI dulu sebelum menjawab/mengubah
  (bukan menebak dari nama fungsi) — pola berulang: Claude selalu
  `view`/`grep` file relevan sebelum menjawab pertanyaan teknis atau
  membuat perubahan.
- Setiap perubahan kode disertai validasi syntax (`node --check`) dan,
  kalau relevan, simulasi logika (contoh: test normalisasi nomor HP,
  simulasi skenario overbilling PO) sebelum diserahkan.
- User lebih suka file diberikan lengkap per-file (bukan diff/patch
  parsial) saat menerima hasil revisi kode.
- Revisi kode ditimpa ke file/doc yang sama (project docs), TIDAK membuat
  file/doc baru per revisi (keputusan eksplisit 2026-09-18).
- User siap kasih dokumentasi/bukti eksternal (mis. OpenAPI spec gateway,
  screenshot Ops Panel) saat Claude butuh verifikasi sesuatu yang tidak
  bisa disimpulkan dari kode semata — lanjutkan analisis begitu dokumen
  itu diberikan, jangan cuma menunggu tanpa follow-up.

---

## 8. Belum Diputuskan / Masih Dipertimbangkan (JANGAN dianggap final)

- **Migrasi ke Vercel + Sheets + Drive (ARAH DIPUTUSKAN user 2026-10-05,
  desain Proposed, belum dibangun)**: menggantikan catatan lama "Next.js +
  Supabase belum sekarang". Detail lengkap di
  `claude/vercel-migration-design.md`, `claude/adr-001-vercel-sheets-drive.md`,
  `claude/vercel-migration-risk-register.md`. Ringkasan keputusan terkunci:
  - Stack (ADR-001, opsi A): Next.js (App Router, TypeScript) di Vercel;
    Google Sheets = sumber kebenaran data; Drive untuk file (lewat proxy
    aplikasi). Repository layer dibuat bisa diganti ke Postgres kelak.
  - **Tambahan di luar "Sheets + Drive": Upstash Redis** (Vercel Marketplace)
    untuk lock terdistribusi, cache, rate-limit, idempotency, revoke sesi,
    kode/OTP WA. Alasan: Vercel tidak punya `LockService`; tanpa lock ada
    race di plafon PO, invoice unik, rekening vendor, ID, pembayaran (R-02).
    Redis boleh hilang tanpa kehilangan data bisnis; aksi uang fail-closed
    kalau Redis mati.
  - Keputusan terkunci user (design doc bagian 1): D1 trial di Vercel
    **Hobby** (non-komersial → **data DUMMY saja**), lalu **Pro**
    ($20/seat/bulan) saat go-live; D2 DB = Spreadsheet, file = Drive;
    D3 semua aktivitas di web app, UI/UX lebih komprehensif; D4 deliverable
    sesi ini = design + ADR + risk register tanpa kode; D5 SEMUA peran (PIC,
    Manager, Finance, CFO) login nomor HP + password (scrypt, lazy-upgrade
    dari hash lama; email tetap wajib di Master_User_TTD sebagai kunci
    kepemilikan `CREATED_BY`); D6 trial pakai salinan spreadsheet + folder
    Drive dummy (kode menolak ID spreadsheet produksi saat `APP_ENV=trial`);
    D7 fase: Auth+Ajukan+Approval → Finance → Vendor/Master/Export (Fase 0 =
    spike teknis, Fase 4 = cutover); D8 user langganan **Google Workspace
    Enterprise** — dimanfaatkan untuk Shared Drive (file milik organisasi),
    akses Sheet dibatasi ke service account + 2–3 admin, DLP/audit log
    (ketersediaan dikonfirmasi di spike S7). Enterprise **TIDAK menaikkan
    kuota Sheets API** (60 baca + 60 tulis / menit / user / project; service
    account = 1 user).
  - Fakta yang wajib diingat: Hobby cron maks 1×/hari (digest WA butuh
    GitHub Actions/cron-job.org sampai Pro); body request maks 4,5 MB; log
    runtime Hobby 1 jam; service account tak punya storage Drive → wajib
    Shared Drive.
  - **Keputusan terbuka O1–O10** (lihat design doc bagian 12). Yang
    menyentuh kontrol uang dan WAJIB konfirmasi user sebelum diubah:
    **O4** (e-approve Level 4/5 menggantikan TTD basah) dan **O5**
    (pemisahan tugas: approver ≠ pembuat, pembayar ≠ verifikator pajak).
  - **Temuan cacat laten di kode lama** (analisis statis, belum direproduksi;
    jangan disalin ke sistem baru): R-17 (approval L4/L5 tercatat atas nama
    pengunggah scan, gate CFO = atestasi), R-18 (manager yang juga PIC bisa
    approve dokumennya sendiri), R-19 (satu Finance memegang seluruh rantai),
    R-21 (`approveVendor(rowIdx)` rawan salah sasaran bila sheet di-sort),
    R-14 (login tanpa lockout + oracle enumerasi nomor), R-16 (OTP pakai
    `Math.random`, plaintext, tanpa batas percobaan), R-32 (`writeAudit`
    menelan error). Perilaku lama TIDAK diubah di Apps Script sampai user
    memutuskan.
  - **Spike Fase 0 (S1–S8)** harus dijalankan sebelum membangun: S1 kuota di
    bawah beban, S2 atomisitas `batchUpdate`, S3/S4 upload/stream file besar,
    S5 latensi Upstash, S6 format signature webhook Lixus (belum terverifikasi
    — docs butuh PIN), S7 tenant Workspace/Shared Drive/kebijakan key/audit
    log, S8 cold start & limit deploy.
  - **Spike kit Fase 0 sudah ditulis** (2026-10-05): `claude/spike-kit-fase0.md`
    (README + panduan) dan `p2p-spike-kit.zip` (S0/S1/S2/S2b/S5, hanya untuk
    spreadsheet DUMMY). Divalidasi lewat mock (logika script), BELUM dijalankan
    terhadap Google/Upstash asli — hasilnya menunggu user. S3/S4/S8 = Fase 0b.
    Hasil spike dicatat di `claude/spike-results.md` — per 2026-10-06: S0 lolos,
    S1 kuota lolos 4/4 variasi normal (0× 429; tanpa cache puncak baca 54/60) dan
    titik patah ditemukan (60 user tanpa cache → 429 70,8%, 7,7% aksi gagal;
    mitigasi stale-if-error + pembatas laju + retry budget); tapi
    ekor latensi 3–6 dtk dan satu kasus 64 dtk → lock TTL perlu timeout+deadline
    guard), S2 lolos 18/18 (`batchUpdate` atomik pada kegagalan validasi; RAW wajib untuk
    teks, USER_ENTERED merusak nol di depan/`=`/notasi ilmiah), service account
    key diizinkan di tenant. S2b lolos (race PO terbukti: tanpa lock bocor Rp 8 jt, dengan lock tepat),
    S5 lolos (primitif lock Upstash terbukti). Drive: upload/download ke Shared Drive lolos
    (folder My Drive biasa gagal 403 — R-09 terbukti). S3, S4, S6, S7(audit log,
    delegasi, email OTP), S8 masih terbuka.
  - **Fase 0b selesai (2026-10-06, Vercel Hobby `sin1`, data dummy)**; kit di
    `claude/spike-kit-0b.md`. Dari Vercel: Redis lock p50 5 ms; Sheets baca p50
    365 / p95 509 ms, tulis p50 364 ms (aksi tulis uang ≈ 0,8 dtk; ekor laptop
    bukan dari Google); cold start ±0,6 dtk setelah idle; Vercel berganti
    instance antar request (state wajib di Redis). Stream respons > 4,5 MB lolos,
    request > 4,5 MB → 413; upload langsung browser→Drive 12/30 MB lolos (CORS
    OK); unduh file Drive lewat fungsi utuh tapi latensi awal 1–6 dtk (bervariasi
    menurut waktu) → lampiran = fitur asinkron + cache. Design doc diperbarui:
    4.3 (TTL ±30 dtk, timeout 8–10 dtk, deadline guard, gagal cepat pada kontensi
    lock, tanpa state di memori), 4.3b (ketahanan kuota), 4.6 (lampiran), O11–O12.
    S6 dijawab vendor 2026-10-07: hex HMAC-SHA256 atas raw body di header
    `X-Gateway-Signature`, TANPA timestamp/anti-replay/retry (fire-and-forget,
    status respons tidak diperiksa), `@lid` di-resolve gateway (asal pemetaan
    masih ditanyakan, R-34). Masih terbuka: S7 sisa (checklist Admin console,
    email OTP/O8), S8 ukuran bundle;
  - **Keputusan 2026-10-07 (D9, O8):** tanpa email OTP; approval via WA nominal
    ≥ Rp 5 jt DIMATIKAN (wajib web + konfirmasi ulang password), < Rp 5 jt tetap
    SETUJU via WA — mengubah perilaku sistem lama (I14). Tidak perlu DWD/mailbox
    no-reply; S7 non-blocking.
  - **Keputusan terbuka O1–O12 dijawab 2026-10-07** (user: "gw ikutin lu" =
    ikut rekomendasi design doc bagian 12): Level 9 Admin, e-approve L4/L5
    menggantikan TTD basah (O4), SoD L2≠pembuat (O5a) + peringatan untuk
    pembayar/verifikator/pengunggah (O5b), tanggal sebagai sel tanggal, password
    min 8, arsip 18 bulan, upload langsung browser→Drive, aksi uang gagal cepat.
    O4/O5 menyentuh kontrol uang → konfirmasi eksplisit final sebelum Fase 2.
    Belum ada kode/scaffold; langkah berikut = review akhir design doc lalu
    rencana implementasi Fase 1.
    user perlu hapus key service account + deploy dummy + DB Upstash setelah selesai.
- **Migrasi ke ERPNext**: dipicu rekomendasi pihak lain (bukan masalah
  konkret user sendiri). Opsi hosting yang disukai: Frappe Cloud (bukan
  self-host). Belum divalidasi apakah alur custom (gate CFO, TTD basah,
  approval WA) bisa dikonfigurasi tanpa developer Frappe/Python, atau
  fitur spesifik apa dari ERPNext yang benar-benar dibutuhkan dibanding
  sistem custom yang sudah ada.
- **Vercel vs VPS**: SUDAH diputuskan Vercel (lihat bullet migrasi di atas).
  Hobby hanya untuk trial data dummy (ToS non-commercial); Pro $20/seat/bulan
  ("seat" = orang yang pegang deployment, BUKAN per user aplikasi) saat
  go-live. VPS tidak dipilih (user "coding pas-pasan", maintenance server).
- **Penyebab laten belum di-diagnosis tuntas** — baru sampai tahap
  hipotesis (lihat bagian 6). User belum memastikan jumlah baris
  Trx_Pengajuan saat ini atau status arsip.
- **Kolom CASHOUT**: belum diputuskan apakah benar-benar mau
  diimplementasikan (lihat bagian 3) atau dilupakan sepenuhnya dari
  rencana.
- **Redesign verifikasi signature webhook WA**: kode SUDAH dieksekusi
  (lihat bagian 4) — tapi belum LIVE, karena 2 langkah manual di Ops Panel
  gateway + Script Properties belum dilakukan (isi `WA_WEBHOOK_SECRET`,
  update WEBHOOK URL di panel). Sampai kedua langkah itu selesai DAN kode
  ini di-deploy, approve-via-WA masih dalam kondisi fail-open lama (secret
  kosong) di production — bukan otomatis lebih aman hanya karena project
  doc sudah diupdate.
- **E-Approver Fase 2 (Level 4/5, gantiin TTD basah CFO/Finance Manager)**:
  BELUM DIMULAI sama sekali — sengaja ditunda user ("bertahap aja bro
  sequence by sequence"). Fase 1 (Level 2, lihat bagian 4b) harus stabil
  di production dulu sebelum Fase 2 mulai dikerjakan. Kalau sesi depan
  diminta lanjut ke Fase 2: yang akan disentuh adalah
  `submitWetSignature()` di `API_Finance.gs` (upload scan TTD basah →
  diganti approve digital lewat token, mirip `managerApprove`), dan
  `loginApprover()` di `Auth.gs` (baris `if (!approver.roles.some(r =>
  r.level === LEVEL.MANAGER))` perlu diperluas menerima Level 4/5 juga).
- **E-Approver Fase 1 belum LIVE**: kode selesai & tervalidasi (bagian 4b),
  tapi deployment kedua ("Anyone" access) belum dibuat user, jadi
  `APPROVER_PORTAL_URL` juga belum terisi. Sampai itu terjadi, approver
  tanpa akun Google masih belum bisa login dashboard sama sekali — WA
  tetap satu-satunya jalur bagi mereka.

---

## 9. Pertanyaan yang Sebaiknya Ditanyakan Claude di Sesi Baru (jangan asumsi)

- Apakah ada perubahan struktur kolom/sheet sejak dokumen ini ditulis?
- Apakah keputusan "semua nominal via WA" masih berlaku, atau sudah
  direvisi setelah dipakai beberapa waktu?
- Sudah sempat cek jumlah baris Trx_Pengajuan & status arsip tahunan?
- Kalau bahasan lanjut ke migrasi platform: sudah ada keputusan final,
  atau masih di tahap yang sama seperti dijelaskan di bagian 8?
- Sudah ada laporan DP/cicilan yang tertolak gara-gara guard
  anti-overbilling PO (mis. ternyata butuh retensi lebih/kurang dari 10%)?
- Apakah `WA_WEBHOOK_SECRET` sudah diisi di Script Properties, dan apakah
  WEBHOOK URL di Ops Panel gateway Lixus sudah diupdate ke bentuk
  `<url exec>?wa=hook&key=<secret>` (bukan `http://localhost:18080/...`
  yang lama)? Kalau belum, approve-via-WA belum benar-benar terlindungi di
  production meski kodenya sudah fixed di project docs.
- Apakah deployment KEDUA ("Anyone" access) untuk e-approver (bagian 4b)
  sudah dibuat, dan `APPROVER_PORTAL_URL` sudah diisi? Kalau belum, jangan
  jalankan `kirimLinkSetPasswordApprover()`/`kirimLinkSetPasswordSemuaManager()`
  dulu — approver akan menerima link yang tidak bisa dibuka tanpa akun
  Google.
- Kalau diminta lanjut ke E-Approver Fase 2 (Level 4/5): sudah benar-benar
  siap gantiin TTD basah CFO/Finance Manager, atau masih mau evaluasi
  Fase 1 dulu di production selama beberapa waktu? User sebelumnya bilang
  "bertahap" — konfirmasi belum berubah pikiran sebelum mulai sentuh
  `submitWetSignature()`.
- Kalau bahasan lanjut ke migrasi Vercel: tiga dokumen
  `claude/vercel-migration-*` + ADR-001 sudah dibaca? Apakah O1–O10 (design
  doc bagian 12) sudah dijawab — terutama O1 (skala sebenarnya: jumlah user
  & transaksi/bulan, ukuran PDF invoice), O2 (tenant Workspace: Shared
  Drive, kebijakan JSON key service account), O4 (e-approve Level 4/5),
  O5 (pemisahan tugas)? Jangan mulai scaffold kode sebelum Fase 0 (spike
  S1–S8) selesai dan user sudah mereview desain.
- Apakah user sudah menyiapkan: spreadsheet SALINAN dummy, folder/Shared
  Drive dummy, akun Vercel + repo personal (Hobby tidak bisa repo milik
  organisasi GitHub), Upstash Redis? Pastikan trial TIDAK memakai data
  produksi.
