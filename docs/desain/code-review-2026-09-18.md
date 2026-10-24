# Code Review: P2P Finance Portal (2026-09-18)

Review menyeluruh atas semua file .gs/.html di project (29 file backend+frontend), dengan lensa architecture, system design, debug, dan code review (security/performance/correctness/maintainability). Semua kode dibaca langsung dari project knowledge (source of truth), bukan ditebak dari nama fungsi/context doc.

> **Update 2026-09-18 (malam):** SEMUA temuan (#1, #2, #4, #5, #6, #7) sudah **diperbaiki** di project docs, termasuk temuan #3 (webhook signature WA) yang tadinya paling pending — root cause dikonfirmasi via OpenAPI spec gateway Lixus + screenshot Ops Panel asli, dan fix-nya (shared-secret via query string, fail-closed) sudah dieksekusi ke `WA_Approval.gs`/`Notif_WA.gs`/`Config.gs`. Temuan #4 juga sudah **direvisi ulang** setelah klarifikasi user soal aturan DP/pelunasan — guard sekarang pakai model "porsi bebas 90% + retensi pelunasan 10%". ⚠️ **Penting:** semua fix ini baru ada di copy project docs (Claude Project), BELUM di live Apps Script editor/deployment. Untuk temuan #3 khususnya, ADA 2 LANGKAH MANUAL TAMBAHAN di luar copy-paste kode (isi `WA_WEBHOOK_SECRET`, update WEBHOOK URL di Ops Panel gateway) — lihat bagian 3 dan "Catatan penting" di bawah.

## Ringkasan

Sistem ini secara umum **well-engineered untuk ukuran Apps Script**: locking konsisten, audit trail di semua tempat, segregation-of-duties di-enforce di server (bukan cuma UI), kalkulasi uang selalu dihitung ulang server-side, dan tooling ops (Diagnostics.gs, Repair.gs) jauh lebih matang dari kebanyakan sistem GAS. Tapi ada **beberapa celah broken access control yang serius** (data finance & vendor bisa dibaca siapa saja yang terdaftar, bukan cuma yang berwenang), dan **dua kontrol yang didokumentasikan di `konteks-sistem-p2p-portal.md` ternyata tidak ada di kode aktual** — dokumen konteks sudah drift dari source of truth.

## 🔴 KRITIS

### 1. `getFinanceQueues()` tidak ada guard level — semua data finance kebaca siapa saja yang terdaftar
**File:** `API_Finance.gs`

✅ **STATUS: FIXED** (project doc, 2026-09-18) — ditambahkan `requireLevel(LEVEL.FINANCE_STAFF)` di baris pertama `getFinanceQueues()`, menggantikan `getUserProfile()` biasa.

`getFinanceQueues()` hanya memanggil `getUserProfile()` (cukup terdaftar di `Master_User_TTD`, level berapa pun) lalu langsung mengembalikan **seluruh** antrean pajak/TTD/COA/treasury — termasuk nominal invoice, NPWP vendor, nomor rekening, deskripsi — tanpa `requireLevel(LEVEL.FINANCE_STAFF)`. Bandingkan dengan `verifyTax`, `submitWetSignature`, `postJournalBulk`, `executePayment(Bulk)` yang semuanya benar memanggil `requireLevel()`.

Karena Apps Script web app mengekspos **semua** fungsi server ke `google.script.run` dari halaman manapun (tidak ada isolasi per-page), seorang PIC Level 1 yang login normal ke `?page=ajukan` bisa buka console browser dan panggil:
```js
google.script.run.withSuccessHandler(console.log).getFinanceQueues()
```
dan langsung dapat seluruh data finance perusahaan lintas brand/divisi. Ini bertentangan langsung dengan model need-to-know yang sudah dibangun hati-hati di tempat lain (SoD pajak, maker-checker vendor, OTP WA).

**Rekomendasi:** tambahkan `requireLevel(LEVEL.FINANCE_STAFF)` di baris pertama `getFinanceQueues()`.

### 2. `getPrintData()` / `getInvoiceFileData()` tidak cek kepemilikan/otorisasi — IDOR
**File:** `API_Print.gs`, `Code.gs`

✅ **STATUS: FIXED** (project doc, 2026-09-18) — ditambahkan helper baru `bisaLihatDokumen_()` di `Auth.gs` (true kalau pemanggil = `CREATED_BY`, ATAU manager brand/dept via `hasAuthority`, ATAU level Finance 3-5), dipanggil di awal `getPrintData()` dan `getInvoiceFileData()`. `Code.gs` (routing halaman print, tanpa role gate) **belum disentuh** — masih worth ditambah guard di level `doGet` juga kalau mau defense-in-depth, tapi fix inti (data leak lewat RPC) sudah tertutup di layer fungsi.

Kedua fungsi ini menerima `idTrx` dari parameter URL/argumen tanpa cek apakah user yang memanggil punya hak atas dokumen itu (bukan PIC-nya, bukan manager brand/dept-nya, bukan finance). ID transaksi berpola predictable (`TRD-00001`, `NTR-00002`, dst — sequential dari `generateTransactionID_`), jadi siapa pun user domain yang terdaftar bisa iterasi ID dan menarik **voucher lengkap + file invoice asli (base64)** dari transaksi siapa pun, termasuk nomor rekening & NPWP vendor.

Halaman `?page=print&id=...` di `doGet` (Code.gs) juga tidak melakukan pengecekan role sama sekali — server hanya mengecek `idTrx` ada, bukan siapa yang minta.

**Rekomendasi:** minimal, `getPrintData`/`getInvoiceFileData` harus memverifikasi salah satu: pemanggil adalah `CREATED_BY` dokumen tsb, ATAU `hasAuthority` manager brand/dept-nya, ATAU level Finance (3-5). Ini penting karena data yang bocor adalah rekening bank vendor — data yang justru paling dijaga di alur pendaftaran vendor (maker-checker).

### 3. Verifikasi HMAC webhook WA kemungkinan besar tidak pernah benar-benar berjalan
**File:** `WA_Approval.gs` (`ambilHeader_`, `verifikasiSignatureWA_`)

✅ **STATUS: FIXED** (project docs, 2026-09-18 malam) — root cause dikonfirmasi via OpenAPI spec resmi gateway WA Lixus (`wa-we-store.lixus.id/api/docs`): *"All webhooks include an `X-Gateway-Signature` header (HMAC-SHA256) for verification."* — signature dikirim lewat **HTTP header**, dan **Apps Script `doPost` secara platform tidak bisa membaca custom HTTP header sama sekali** — jadi desain HMAC lama tidak pernah mungkin diverifikasi dari kode di sini, terkonfirmasi bukan cuma asumsi.

Dikonfirmasi lebih lanjut lewat **screenshot Ops Panel gateway asli** yang dikirim user (bagian "API Consumers", consumer `wa-store.lixus.id`): (a) field WEBHOOK URL memang free-text — isinya saat dicek masih `http://localhost:18080/api/wa/webh...` (jelas dev/default, belum pernah diarahkan ke Apps Script — webhook approval realistanya belum pernah benar-benar nyampe ke portal sampai saat ini), dan (b) sudah ada WEBHOOK SECRET ter-generate di gateway yang **belum pernah disalin** ke Script Property `WA_WEBHOOK_SECRET` (dicek dari screenshot Script Properties terpisah — properti itu belum pernah ada sama sekali, cuma `SEQ_NTR`/`WA_API_KEY`/`WA_GATEWAY_URL`).

Gateway ini juga bukan instance khusus untuk portal ini — dari spec-nya, gateway yang sama dipakai juga oleh app lain (Mini-CRM, Flow Delivery), jadi ini platform WA bersama, bukan sesuatu yang bisa diubah semaunya dari sisi kita.

**Fix yang dieksekusi:**
- `WA_Approval.gs` — model verifikasi diganti total dari "HMAC atas body/header" ke **shared-secret via query string**: `verifikasiKeyWebhookWA_(providedKey)` (baru) membandingkan `e.parameter.key` dengan Script Property `WA_WEBHOOK_SECRET` (constant-time compare). `ambilHeader_()` (lama, cuma baca `?sig=`) dan `verifikasiSignatureWA_()` (lama, hitung HMAC) dihapus/diganti. `handleWebhookWA` diupdate untuk pakai fungsi baru.
- **FAIL-CLOSED** (disetujui user 2026-09-18): secret kosong ATAU key tidak cocok → webhook `{ok:false, reason:"unauthorized"}`, bukan dilewati seperti desain lama.
- `Notif_WA.gs` — `cekKonfigurasiWA()` diupdate: kalau `WA_WEBHOOK_SECRET` sudah terisi, sekarang mencetak URL webhook lengkap yang harus didaftarkan di Ops Panel (`<url exec>?wa=hook&key=<secret>`).
- `Config.gs` — komentar `WA_APPROVAL_ENABLED` diperbarui menjelaskan mekanisme baru.
- Divalidasi `node --check` (bersih untuk `WA_Approval.gs`, `Notif_WA.gs`, `Config.gs`) + simulasi 8 skenario Node.js untuk `verifikasiKeyWebhookWA_` (secret kosong → selalu tolak termasuk dengan key apa pun; key benar → lolos; key salah/kosong/beda-kapital/lebih-pendek/lebih-panjang dari secret → tolak) — semua sesuai ekspektasi fail-closed.

⚠️ **Kode sudah fixed di project docs, TAPI belum LIVE dan belum efektif di production** — 2 langkah manual di luar kode masih WAJIB dilakukan user sebelum deploy:
1. Isi Script Property `WA_WEBHOOK_SECRET` dengan nilai WEBHOOK SECRET yang **sama persis** dengan yang tercatat di Ops Panel gateway (user cuma kasih screenshot yang terpotong — perlu nilai lengkap).
2. Update field WEBHOOK URL di Ops Panel gateway dari `http://localhost:18080/...` ke URL exec Apps Script + `?wa=hook&key=<secret yang sama>` (bentuk lengkapnya otomatis tercetak oleh `cekKonfigurasiWA()` begitu secret diisi).

Kalau urutan kebalik (deploy dulu, isi secret belakangan) → approve-via-WA berhenti total sampai secret diisi (ini konsekuensi fail-closed yang sudah disetujui user).

## 🟠 TINGGI

### 4. Dokumen konteks proyek sudah drift dari kode aktual (dua kontrol yang didokumentasikan ternyata tidak ada)
**File:** `konteks-sistem-p2p-portal.md` vs `API_PO.gs`, `CRUD_Pengajuan.gs`, `Config.gs`

✅ **STATUS: FIXED** (project docs, 2026-09-18, **direvisi ulang sore ini** setelah klarifikasi aturan bisnis dari user) — dua bagian, ditangani beda karena user memilih opsi (a) untuk sub-temuan pertama:

- **Guard anti-overbilling PO** — **diimplementasikan**, lalu **direvisi** setelah user mengklarifikasi aturan bisnis yang sebenarnya. Aturan final: *"DP gapapa belum ada surat jalan, full payment gapapa, partial payment juga gapapa, tapi outstanding sisa 10% (retensi pelunasan) perlu Surat Jalan dulu — jadi gabisa lunasin sampe bener-bener lunas."* Diimplementasikan sebagai model **"porsi bebas + retensi pelunasan"**:
  - `Config.gs` — konstanta baru `PO_RETENSI_PELUNASAN_PCT: 0.10` (10%, bisa disesuaikan).
  - `API_PO.gs` — `hitungPlafonSJ_(grandTotal, qtyPO, qtySJ)` dihitung ulang: porsi **90% dari grand total PO bebas ditagih kapan saja** (DP, cicilan, partial — TANPA syarat SJ sama sekali); porsi **10% terakhir (retensi)** baru boleh ditagih kalau `qtySJ >= qtyPO` (barang diterima **penuh** secara qty). PO jasa/tanpa acuan qty (`qtyPO <= 0`) tetap bebas penuh dari awal (tidak ada dasar untuk retensi).
  - `assertPOTidakOverbilling_(poNumber)` (baru, di `API_PO.gs`, dipanggil dari `submitPengajuan()` untuk semua pengajuan Trade dengan PO) — direkomputasi fresh dari `DB_PO`+`DB_SJ` (zero-trust, tidak pakai QTY_PO/QTY_SJ snapshot di baris), menolak submit kalau total nilai yang diajukan atas satu PO (kumulatif, termasuk dokumen ini, REJECTED diabaikan) melebihi plafon dari `hitungPlafonSJ_`. Pesan error membedakan dua kasus: "melebihi plafon karena masih di porsi bebas" vs "ini sudah masuk porsi retensi pelunasan terakhir, butuh SJ lengkap".
  - `CRUD_Pengajuan.gs` — hanya komentar di call-site yang diperbarui untuk menjelaskan aturan baru (logic call-site sendiri tidak berubah).
  - `JS_Main.html` — label info plafon di form pengajuan (`#btnCheckPO` success handler) diperbaiki, supaya tidak lagi menyiratkan "plafon = nilai barang yang sudah diterima" (yang sudah tidak benar di model baru, karena porsi bebas 90% tidak menunggu SJ apa pun).
  - **Diverifikasi dengan 2 ronde simulasi Node.js** (total ±20 skenario lintas kedua desain: boundary pas 90%, DP dengan qtySJ=0 harus LOLOS, cicilan bertahap, over-receipt, PO jasa qtyPO=0, dokumen REJECTED diabaikan dari total, pelunasan 100% setelah SJ lengkap harus LOLOS, coba lunasin sebelum SJ lengkap harus DITOLAK) — semua sesuai ekspektasi. `node --check` bersih untuk semua file yang diubah.
  - ⚠️ Guard versi **pertama** (sebelum klarifikasi ini) sempat tidak mengecualikan DP sama sekali — itu sudah diganti sepenuhnya oleh desain di atas, jadi kalau ada catatan/riwayat lama yang menyebut "DP akan ditolak kalau qtySJ=0", itu **sudah tidak berlaku**.
- **Kolom `CASHOUT` (AW)** — **dikoreksi di dokumen** (bukan diimplementasikan sebagai kolom baru — user tidak diminta soal ini secara spesifik, jadi diambil opsi paling aman: dokumentasi disesuaikan ke kenyataan kode, bukan nambah fitur baru sepihak). `konteks-sistem-p2p-portal.md` sekarang menyatakan dengan jelas kolom ini tidak ada, dan kalau dibutuhkan ringkasan sumber rekening per dokumen, itu harus diturunkan dari `Trx_Payment_Log` (sumber kebenaran yang sudah ada). Kalau ternyata kolom ini memang dibutuhkan sebagai fitur baru, itu keputusan terpisah — tinggal bilang.

Detail asli temuan:
- **Guard anti-overbilling PO** — dokumen bilang ada fungsi `assertPOTidakOverbilling_()` yang dipanggil saat SUBMIT untuk mem-block pengajuan yang melebihi `plafon = grandTotal × (qtySJ/qtyPO)`. **Fungsi ini tidak ada di kode manapun** (saat review awal). Yang ada di `API_PO.gs` (`hitungPlafonSJ_`, `sisaBolehTagih`) cuma dipakai untuk **tampilan** di `searchPODetails()` (info di UI form pengajuan). Guard di `submitPengajuan` (CRUD_Pengajuan.gs) cuma cek **qty** SJ vs PO (barang diterima penuh atau tidak) — sama sekali tidak membandingkan **nominal** invoice yang diajukan terhadap plafon rupiah. Artinya: PIC bisa mengetik nominal invoice berapa pun (asal barang sudah diterima penuh secara qty) dan submit — sistem tidak pernah menolaknya walau jauh melebihi nilai PO. Ini gap kontrol keuangan riil, bukan cuma dokumentasi usang.
- **Kolom `CASHOUT` (AW)** — dokumen bilang ada kolom terakhir yang menyimpan ringkasan sumber rekening pembayaran gabungan. Di `Config.gs`, `COL_COUNT = 48` dan kolom terakhir adalah `QTY_SJ` (AV) — **tidak ada kolom AW/CASHOUT sama sekali**, dan tidak ada kode manapun yang menulis ringkasan semacam itu ke `Trx_Pengajuan`.

**Kenapa ini penting:** instruksi project sendiri bilang "kode di editor Apps Script adalah source of truth, file context adalah ringkasan keputusan" — di sini terbukti ringkasannya sudah tidak sinkron pada 2 poin krusial (satunya kontrol uang). Sudah diselaraskan ulang sesuai aturan bisnis final dari user.

### 5. Stored XSS via field yang di-render lewat `.html()`/template literal tanpa escaping
**File:** `JS_Main.html` (`loadRiwayat`), `Approval_Portal.html` (`loadQueue`), `JS_Finance.html` (`renderTax/renderWet/renderCoa/renderTreasury`), `Print_Form.html` (`renderSignatures`)

✅ **STATUS: FIXED** (project docs, 2026-09-18) — ditambahkan helper `esc()` di `JS_Common.html` (dan versi lokal di `Print_Form.html`, karena halaman itu tidak include `JS_Common.html`), lalu diterapkan ke semua field user-controlled yang teridentifikasi di `JS_Main.html`, `Approval_Portal.html` (termasuk di dalam atribut `title="..."`), `JS_Finance.html` (termasuk seluruh `renderVendor()` — surface XSS paling berisiko karena input pra-approval), dan `Print_Form.html`.

Field yang asalnya dari input user (`vendorName` didaftarkan bebas lewat `submitNewVendor`, `description`, `notesUser`, `noInvoice`) di-inject langsung ke `innerHTML` via template string, termasuk ke dalam atribut HTML tanpa quote-escaping (`title="${it.desc}"` di Approval_Portal.html — kalau `desc` mengandung `"` bisa break out atribut). Karena app ini domain-restricted, blast radius terbatas ke user internal — tapi seorang PIC (level rendah, self-service daftar vendor & isi form) bisa menaruh payload di `vendorName`/`description` yang akan tereksekusi di browser **Manager** (Approval_Portal), **Finance staff** (Finance_Index), atau PIC lain (Riwayat) saat mereka membuka dashboard tsb — dan karena `google.script.run` tersedia di semua halaman itu, payload yang jalan di sesi Finance/Manager berpotensi memanggil fungsi approval/pembayaran atas nama korban.

**Rekomendasi:** escape semua string sebelum interpolasi ke HTML (helper `esc()` sederhana), terutama `vendor`, `desc`/`description`, `notesUser`, `notesFinance`, `noInvoice`.

## 🟡 SEDANG

### 6. Kolom PPh (`JENIS_PPH`/`PPH_AMOUNT`/`PPH_RATE`) tidak direset saat PIC merevisi dokumen yang sudah pernah diverifikasi pajak
**File:** `CRUD_Pengajuan.gs` (`updatePengajuanRow_`)

✅ **STATUS: FIXED** (project doc, 2026-09-18) — `updatePengajuanRow_` sekarang reset `JENIS_PPH="-"`, `PPH_AMOUNT=0`, `PPH_RATE=0` setiap kali draft direvisi.

Kalau Finance sudah sempat `verifyTax` (isi PPh) lalu dokumen ditolak lagi di tahap TTD/COA (`financeReject` bisa dipanggil "dari tahap manapun"), status balik ke `REVISION`. Saat PIC update draft, `updatePengajuanRow_` menghitung ulang `FINAL_AMOUNT`/`DPP`/`PPN` (dengan `jenisPPh` dipaksa `"-"`) tapi **tidak membersihkan** `JENIS_PPH`/`PPH_AMOUNT`/`PPH_RATE` lama di baris — jadi sheet punya kondisi sesaat yang inkonsisten (FINAL_AMOUNT baru tidak match dengan PPH_AMOUNT lama yang masih tersimpan) sampai Finance verifikasi ulang. Tidak menyebabkan salah bayar (karena `verifyTax` selalu re-run sebelum lanjut), tapi bisa menyesatkan kalau ada yang baca sheet mentah atau dashboard antara waktu itu.

**Rekomendasi:** di `updatePengajuanRow_`, reset `JENIS_PPH="-"`, `PPH_AMOUNT=0`, `PPH_RATE=0` setiap kali draft direvisi.

### 7. Housekeeping WA (`bersihkanWAPending`) & digest (`kirimSemuaDigest`) bergantung pada trigger manual yang tidak terverifikasi terpasang
**File:** `WA_Digest.gs`, `WA_Approval.gs`

✅ **STATUS: FIXED** (project doc, 2026-09-18) — `cekKonfigurasiWA()` (Notif_WA.gs) sekarang juga mengecek `ScriptApp.getProjectTriggers()` dan melaporkan apakah trigger digest (`kirimSemuaDigest`/`kirimDigestManager`/`kirimDigestFinance`/`kirimDigestApproval`) dan `bersihkanWAPending` terpasang. Ini diagnostic-only — tidak memasang trigger otomatis, cuma membuat statusnya kelihatan dari satu tempat.

Kedua fungsi ini eksplisit "opsional"/manual dipasang lewat Trigger UI Apps Script — tidak ada cara programatik untuk memverifikasi triggernya benar-benar aktif. Kalau trigger digest belum/tidak lagi terpasang, **tidak ada approval notification yang terkirim sama sekali** (silent failure — tidak ada dokumen yang macet secara sistem, tapi manager tidak pernah tahu ada yang perlu diapprove kecuali cek portal manual). Sarankan tambahkan pengecekan status trigger ke `cekKonfigurasiWA()` (pakai `ScriptApp.getProjectTriggers()`) supaya kelihatan dari satu tempat.

### 8. Gate TTD basah CFO/Finance Manager pada akhirnya honor-system
**File:** `API_Finance.gs` (`submitWetSignature`)

ℹ️ **STATUS: NOT ACTIONED** — dicatat sebagai residual risk yang kemungkinan sudah diterima sadar, bukan bug untuk di-fix (sama seperti keputusan "semua nominal via WA"). Tidak ada perubahan kode.

Checkbox `signedFinanceMgr`/`signedCFO` cuma di-attest oleh staff Finance yang upload — tidak ada verifikasi independen bahwa TTD basah itu benar dari orang yang tepat (mis. OCR nama, atau approval balik dari CFO). Ini kemungkinan besar sudah disadari & diterima (fisik TTD memang sulit diverifikasi otomatis), tapi worth dicatat sebagai residual risk kalau ada insiden ke depan — sama seperti keputusan "semua nominal via WA" yang sudah didokumentasikan sadar-risiko.

## Arsitektur & System Design

- **Sheets-as-DB sudah di titik butuh strategi archiving.** Banyak fungsi (`getHomeContext`, `getPendingApprovals`, `getFinanceQueues`, `getUserDraftsAndHistory`, `kirimDigestApproval`, `kirimDigestFinance`, `exportJurnalOdoo`) melakukan **full-scan** seluruh `Trx_Pengajuan` (`getRange(2,1,lastRow-1,COL_COUNT)`) di setiap pemanggilan, termasuk baris `PAID` bertahun-tahun lalu yang tidak akan pernah relevan lagi untuk queue manapun. `CacheService` sudah dipakai dengan baik untuk master data (`getOrgStructure`, `getMasterCoaData`, dll) tapi tidak (dan memang tidak bisa) untuk data transaksi live. Ini konsisten dengan gejala laten yang sudah didiagnosis manual di `Diagnostics.gs`/bagian 6 context doc. Rekomendasi konkret: (a) archive baris `STATUS=PAID` yang lebih tua dari N bulan ke sheet terpisah tahunan, dikecualikan dari semua query "live queue" tapi tetap dibaca `exportJurnalOdoo`/audit kalau perlu; (b) untuk dashboard/digest yang cuma butuh status tertentu, pertimbangkan menjaga index kecil (mis. sheet "Open_Docs" yang di-maintain saat transisi status) supaya tidak scan semua baris tiap request. **Belum dieksekusi** — di luar scope fix batch ini (perubahan struktural, bukan bug fix).
- **Otorisasi read-side vs write-side tidak konsisten** (lihat temuan #1, #2): write-path (approve, bayar, jurnal, verifikasi) semuanya sudah benar pakai `requireLevel`/`hasAuthority`, tapi read-path punya lubang. Pola yang benar sudah ada di `getPendingApprovals()` (filter per-baris pakai `hasAuthority`) dan `getUserDraftsAndHistory()` (filter `CREATED_BY`) — tinggal diterapkan konsisten ke `getFinanceQueues`, `getPrintData`, `getInvoiceFileData`. ✅ Sudah diterapkan (lihat #1, #2).
- **Desain WA (Level 1 notif + Level 2 approve + digest terjadwal)** sudah solid secara arsitektur: kirim WA selalu di luar lock & dibungkus try/catch (tidak pernah menggagalkan transaksi utama), state approval WA dipisah tabelnya sendiri (`WA_Pending_Approval`), OTP untuk nominal besar. Poin lemahnya dulu ada di verifikasi signature (#3) — sudah diperbaiki (shared-secret via query string, fail-closed), tinggal 2 langkah setup manual (isi secret + update URL di Ops Panel) sebelum efektif di production.
- **Approval & audit trail sebagai tabel terpisah** (`Trx_Approval`, `Audit_Log`) alih-alih ditebak dari kolom status adalah keputusan desain yang bagus — memungkinkan pertanyaan "siapa approve apa kapan" dijawab langsung, termasuk yang lewat WA (method="WA" tercatat jelas).

## Yang Sudah Bagus

- Locking pattern konsisten & benar: upload file besar ke Drive selalu di **luar** `withLock`, hanya penulisan sheet (cepat) yang di dalam lock — mencegah user lain mengantri karena upload orang lain.
- Semua kalkulasi uang (`hitungPajak`, `bolehDibayar`, plafon SJ) dihitung ulang server-side; input browser diabaikan — prinsip zero-trust terhadap client yang konsisten di seluruh file.
- Segregation of duties (vendor maker-checker, pajak pengaju≠verifikator) di-enforce keras di server, bukan cuma UI — dan UI-nya juga menonaktifkan tombol untuk UX yang jujur.
- ID generator anti-race pakai `PropertiesService` counter di dalam lock, bukan `getLastRow()` — sadar akan kondisi balapan submit bersamaan.
- Tooling operasional (`Diagnostics.gs`, `Repair.gs`) jauh di atas rata-rata proyek Apps Script — auditData Integrity, reconcile payment dari log (bukan kolom ringkasan), deteksi "baris hantu" penyebab lambat.
- Error handling: `withLock` sengaja tidak menelan exception (pelajaran dari insiden sebelumnya), dan `srv()`/`tampilkanError` di frontend memastikan kegagalan selalu terlihat user, bukan spinner selamanya.

## Prioritas Rekomendasi

1. ✅ Tambahkan `requireLevel`/ownership check ke `getFinanceQueues`, `getPrintData`, `getInvoiceFileData` (temuan #1, #2) — **DONE**.
2. ✅ Fix temuan #3 (signature WA via shared-secret query string + fail-closed) — **DONE di kode**, ⚠️ tapi 2 langkah manual (isi `WA_WEBHOOK_SECRET`, update WEBHOOK URL di Ops Panel gateway) masih harus dilakukan user sebelum efektif — lihat bagian 3 & "Catatan penting" di bawah.
3. ✅ Implementasikan guard nominal `assertPOTidakOverbilling_` (temuan #4) — **DONE, sudah direvisi ke model porsi-bebas-90%+retensi-10%** sesuai aturan bisnis final dari user (DP/partial bebas, cuma pelunasan akhir yang butuh SJ lengkap).
4. ✅ Escape semua field user-controlled sebelum di-render ke HTML (temuan #5) — **DONE**.
5. ✅ Reset kolom PPh saat revisi draft (temuan #6); tambahkan pengecekan status trigger ke tooling diagnosa (temuan #7) — **DONE**.

## Catatan penting: langkah selanjutnya

Semua fix di atas saat ini **hanya ada di copy Claude Project** (project knowledge), belum di live Google Apps Script editor. Tidak ada koneksi otomatis dari sesi ini ke Apps Script — jadi supaya fix ini aktif di production:

1. Copy isi terbaru tiap file yang ditandai FIXED ke Apps Script editor: `Auth.gs`, `API_Print.gs`, `Notif_WA.gs`, `JS_Common.html`, `CRUD_Pengajuan.gs`, `API_Finance.gs`, `API_PO.gs`, `Config.gs`, `JS_Main.html`, `Approval_Portal.html`, `JS_Finance.html`, `Print_Form.html`, `WA_Approval.gs`.
2. **KHUSUS temuan #3 (webhook WA), 2 langkah ini WAJIB dilakukan SEBELUM deploy, bukan sesudahnya** (fail-closed — kalau kebalik, approve-via-WA berhenti total di antara waktu itu):
   a. Isi Script Property `WA_WEBHOOK_SECRET` dengan nilai WEBHOOK SECRET yang **sama persis** dengan yang tercatat di Ops Panel gateway Lixus (bagian API Consumers, consumer `wa-store.lixus.id`) — ambil nilai lengkapnya dari panel, jangan dari screenshot yang terpotong.
   b. Update field WEBHOOK URL di Ops Panel gateway itu, dari `http://localhost:18080/...` (nilai lama/dev yang ditemukan saat review) ke URL exec Apps Script + `?wa=hook&key=<secret yang sama>`. Setelah `WA_WEBHOOK_SECRET` diisi, jalankan `cekKonfigurasiWA()` di editor — dia akan mencetak bentuk URL lengkap yang harus dipaste ke panel.
3. Deploy **versi baru** ke deployment yang sudah ada (bukan "New deployment" — sesuai catatan di context doc soal URL permanen).
4. Setelah live, tes minimal: PIC level 1 coba akses `getFinanceQueues`/print dokumen orang lain (harus ditolak); cek satu dashboard yang render vendor/description (harus tidak ada regresi tampilan dari `esc()`); coba submit **DP di PO yang belum ada Surat Jalan sama sekali** (harus **LOLOS**, selama masih di bawah 90% grand total PO); coba **lunasin sampai benar-benar 100%** sebelum SJ lengkap (harus **DITOLAK** dengan pesan yang menyebut retensi pelunasan); coba lunasin setelah SJ lengkap (harus LOLOS); coba balas kode approval via WA (harus jalan HANYA SETELAH langkah 2a/2b beres — sebelum itu, semua webhook approval akan ditolak dengan `unauthorized`, ini yang diharapkan, bukan bug baru).
