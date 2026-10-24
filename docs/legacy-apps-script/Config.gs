// =========================================================================
// FILE: Config.gs
// SINGLE SOURCE OF TRUTH. Jangan pernah tulis magic number / string status
// di file lain. Semua refer ke sini.
// =========================================================================

const CONFIG = {
  SPREADSHEET_ID: "<REDACTED-SPREADSHEET-ID>",
  FOLDER_LAMPIRAN_ID: "<REDACTED-FOLDER-ID>",

  // Threshold otorisasi (Rupiah)
  CFO_THRESHOLD: 5000000,

  // Tarif pajak
  PPN_RATE: 0.11,

  // Toleransi selisih pembayaran (biar Rp 1 rounding gak bikin invoice gantung)
  PAYMENT_TOLERANCE: 1000,

  // Level 3 di Master_COA yang menandai akun kas/bank.
  // Semua Level 5 di bawah kategori ini jadi pilihan sumber rekening di Treasury.
  KAS_L3: "KAS DAN SETARA KAS",

  // -----------------------------------------------------------------------
  // Anti-overbilling PO — retensi pelunasan (code review 2026-09-18, temuan #4)
  //
  // Porsi TERAKHIR dari nilai PO (dihitung dari grandTotal) yang baru boleh
  // ditagih kalau Surat Jalan sudah menunjukkan barang diterima PENUH
  // (qtySJ >= qtyPO). Di BAWAH batas ini (DP, cicilan/partial payment awal),
  // PIC bebas menagih TANPA syarat SJ sama sekali — tidak ada pengecekan
  // proporsional qty di tahap ini.
  //
  // Keputusan user: "DP gapapa belum ada surat jalan... tapi kalo outstanding
  // sisa 10% perlu ada surat jalan dulu, jadi gabisa lunasin sampe bener-bener
  // lunas." 0.10 = 10%, sesuai angka yang diusulkan user (adjustable — user
  // eksplisit bilang boleh disesuaikan).
  //
  // Dipakai SATU-SATUNYA tempat: hitungPlafonSJ_() di API_PO.gs — baik untuk
  // display (searchPODetails, info di form pengajuan) MAUPUN hard guard saat
  // submit (assertPOTidakOverbilling_, CRUD_Pengajuan.gs/submitPengajuan).
  // Jangan duplikasi angka ini di file lain.
  // -----------------------------------------------------------------------
  PO_RETENSI_PELUNASAN_PCT: 0.10,

  // -----------------------------------------------------------------------
  // Notifikasi WhatsApp (Level 1: notif saja, approval tetap di portal).
  // URL & API key TIDAK ditaruh di sini — disimpan di Script Properties
  // (File → Project Settings → Script Properties) supaya tidak ikut ter-commit
  // dan bisa diganti tanpa ubah kode. Key yang dibaca:
  //   WA_GATEWAY_URL  → mis. https://gateway-lo.domain.com
  //   WA_API_KEY      → API key dari Ops Panel gateway
  // Kalau salah satu kosong, notif otomatis dinonaktifkan (sistem tetap jalan).
  // -----------------------------------------------------------------------
  WA_ENABLED: true,          // saklar induk; set false untuk matikan semua notif
  WA_SEND_PATH: "/api/messages/send",   // endpoint kirim teks di gateway Lixus (skema MessageSendRequest: {to, text})

  // -----------------------------------------------------------------------
  // LEVEL 2 — Approval via WhatsApp (balas kode unik).
  //   WA_APPROVAL_ENABLED : izinkan approve/tolak lewat balasan WA
  //   WA_OTP_THRESHOLD     : nominal ≥ ini → wajib OTP email (samakan CFO)
  //   WA_OTP_TTL_MIN       : masa berlaku OTP (menit)
  //
  // Webhook gateway harus diarahkan ke URL /exec web app SEBAGAI:
  //     <url exec>?wa=hook&key=<WA_WEBHOOK_SECRET>
  // (bukan cuma "?wa=hook" tanpa key). REVISI 2026-09-18 (code review temuan
  // #3): desain awal mengandalkan verifikasi HMAC-SHA256 atas signature yang
  // diasumsikan dikirim gateway lewat HTTP header — ternyata itu memang benar
  // cara gateway Lixus mengirimnya (dikonfirmasi dari OpenAPI spec resmi),
  // TAPI Apps Script doPost() tidak bisa membaca custom header sama sekali,
  // jadi HMAC itu tidak pernah mungkin diverifikasi dari sini. Model diganti
  // jadi shared-secret sederhana lewat query string `?key=`, dibandingkan ke
  // Script Property WA_WEBHOOK_SECRET (constant-time compare, FAIL-CLOSED —
  // lihat WA_Approval.gs verifikasiKeyWebhookWA_ untuk detail lengkap).
  // WA_WEBHOOK_SECRET WAJIB diisi dengan nilai "WEBHOOK SECRET" yang SAMA
  // seperti tercatat di Ops Panel gateway (bagian API Consumers) SEBELUM
  // approve-via-WA bisa jalan — kalau kosong, semua webhook approval ditolak.
  // -----------------------------------------------------------------------
  WA_APPROVAL_ENABLED: true,
  WA_OTP_THRESHOLD: 5000000,   // = CFO_THRESHOLD, biar konsisten
  WA_OTP_TTL_MIN: 5,

  // -----------------------------------------------------------------------
  // E-APPROVER — login nomor HP + password (mulai 2026-09-18, Fase 1: Level 2
  // Manager saja; Fase 2 nanti extend ke Level 4/5 CFO/Finance Manager
  // gantiin TTD basah — lihat konteks-sistem-p2p-portal.md bagian 4/8).
  //
  // KEPUTUSAN USER: approval Level 2 SEKARANG punya 2 jalur paralel —
  // (a) balas WA kode unik (WA_Approval.gs, tidak diubah), DAN
  // (b) login dashboard Approval_Portal.html pakai nomor HP + password
  //     (BUKAN lagi akun Google — "ganti total", keputusan eksplisit user).
  // Approver bisa pakai jalur mana pun.
  //
  // KENAPA BUKAN akun Google lagi untuk halaman approval: karena deployment
  // Apps Script mengecek akses (siapa boleh buka URL) SEBELUM kode ini
  // sempat jalan sama sekali. Supaya approver benar-benar tidak perlu akun
  // Google, halaman approval WAJIB dibuka lewat DEPLOYMENT KEDUA yang
  // access-nya "Anyone" (bukan domain-restricted seperti deployment utama).
  // Ini langkah manual di UI Apps Script (Deploy → New deployment → Web app
  // → Who has access: Anyone), TIDAK bisa dilakukan dari kode. Setelah
  // deployment kedua itu ada, isi Script Property APPROVER_PORTAL_URL
  // dengan URL /exec-nya (dipakai kirimLinkSetPasswordApprover() untuk
  // menyusun link WA). doGet() (Code.gs) sudah menolak akses anonim ke
  // halaman SELAIN approval/setpass, supaya deployment "Anyone" ini tidak
  // jadi jalan pintas buka halaman PIC/Finance tanpa akun Google.
  //
  // Password TIDAK disimpan plaintext. Hash disimpan di Master_User_TTD
  // (kolom PASSWORD_HASH/PASSWORD_SALT, lihat COL_USER di bawah) — bukan
  // bcrypt/PBKDF2/Argon2 asli (Apps Script tidak punya library itu native),
  // tapi SHA-256 ber-salt diulang berkali-kali (lihat hashPassword_ di
  // Auth.gs) supaya tidak semudah SHA-256 sekali jalan untuk di-brute-force
  // kalau sheet-nya somehow bocor. Ini bukan seaman bcrypt asli — kalau
  // nanti ada library hashing yang lebih baik tersedia di Apps Script,
  // upgrade ke situ.
  APPROVER_SESSION_TTL_SEC: 21600,      // 6 jam — maksimum CacheService Apps Script
  APPROVER_SETPASS_TOKEN_TTL_MIN: 60,   // link set-password via WA berlaku 1 jam
  APPROVER_HASH_ITERASI: 3000,          // pengali "stretching" SHA-256 ber-salt

  TAB: {
    PENGAJUAN:   "Trx_Pengajuan",
    APPROVAL:    "Trx_Approval",     // BARU
    PAYMENT_LOG: "Trx_Payment_Log",
    AUDIT:       "Audit_Log",        // BARU
    VENDOR:      "Master_Vendor",
    SETTING:     "Master_Setting",
    USER_TTD:    "Master_User_TTD",
    COA:         "Master_COA",
    PPH:         "Master_PPh",
    PO:          "DB_PO",
    SJ:          "DB_SJ",
    WA_PENDING:  "WA_Pending_Approval"   // BARU — state kode approve & OTP via WA
  }
};

// -------------------------------------------------------------------------
// STATUS ENUM — alur resmi dokumen
//
// DRAFT ─(submit)─> SUBMITTED ─(mgr)─> MANAGER_APPROVED
//   ─(finance staff cek pajak)─> TAX_VERIFIED
//   ─(cetak & TTD basah diupload)─> WET_SIGNED
//   ─(finance posting jurnal)─> COA_POSTED
//   ─(treasury bayar)─> PARTIALLY_PAID ─> PAID
//
// Cabang: REVISION (dikembalikan ke PIC), REJECTED (mati).
// -------------------------------------------------------------------------
const STATUS = {
  DRAFT:            "Draft",
  SUBMITTED:        "Submitted",
  MANAGER_APPROVED: "Manager Approved",
  TAX_VERIFIED:     "Tax Verified",
  WET_SIGNED:       "Wet Signed",
  COA_POSTED:       "COA Posted",
  PARTIALLY_PAID:   "Partially Paid",
  PAID:             "Paid",
  REVISION:         "Revision Needed",
  REJECTED:         "Rejected"
};

// Transisi yang DIIZINKAN. Kunci = status sekarang, isi = status tujuan valid.
// Backend wajib cek ini sebelum ubah status apapun.
const STATUS_FLOW = {
  [STATUS.DRAFT]:            [STATUS.SUBMITTED],
  [STATUS.REVISION]:         [STATUS.SUBMITTED],
  [STATUS.SUBMITTED]:        [STATUS.MANAGER_APPROVED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.MANAGER_APPROVED]: [STATUS.TAX_VERIFIED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.TAX_VERIFIED]:     [STATUS.WET_SIGNED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.WET_SIGNED]:       [STATUS.COA_POSTED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.COA_POSTED]:       [STATUS.PARTIALLY_PAID, STATUS.PAID, STATUS.REVISION],
  [STATUS.PARTIALLY_PAID]:   [STATUS.PARTIALLY_PAID, STATUS.PAID],
  [STATUS.PAID]:             [],
  [STATUS.REJECTED]:         []
};

// -------------------------------------------------------------------------
// LEVEL OTORISASI (kolom C di Master_User_TTD)
// -------------------------------------------------------------------------
const LEVEL = {
  PIC:           1,   // pengaju — e-sign otomatis
  MANAGER:       2,   // manager divisi — e-sign digital
  FINANCE_STAFF: 3,   // staff finance — e-sign digital (cek pajak & jurnal)
  FINANCE_MGR:   4,   // manager finance — TTD BASAH
  CFO:           5    // CFO — TTD BASAH, hanya jika >= CFO_THRESHOLD
};

const LEVEL_LABEL = {
  1: "Dibuat Oleh,",
  2: "Diperiksa Oleh,",
  3: "Diverifikasi Oleh,",
  4: "Disetujui Oleh,",
  5: "Disetujui Oleh,"
};

const SIGN_METHOD = {
  1: "E-SIGN",
  2: "E-SIGN",
  3: "E-SIGN",
  4: "WET",
  5: "WET"
};

// -------------------------------------------------------------------------
// PETA KOLOM Trx_Pengajuan (1-based, sesuai getRange)
// JANGAN sisipkan kolom di tengah. Kolom baru selalu ditambah di paling kanan.
// -------------------------------------------------------------------------
const COL = {
  ID_TRX:           1,   // A
  TIMESTAMP:        2,   // B
  COMPANY:          3,   // C
  BRAND:            4,   // D
  DEPARTEMENT:      5,   // E
  TIPE:             6,   // F  Trade / Non-Trade
  PIC:              7,   // G
  DESCRIPTION:      8,   // H
  EVENT_PROJECT:    9,   // I
  NOTES_USER:      10,   // J
  PO_NUMBER:       11,   // K
  VENDOR_NAME:     12,   // L
  NPWP_VENDOR:     13,   // M
  BANK:            14,   // N
  NAMA_REKENING:   15,   // O
  NO_REKENING:     16,   // P
  NO_INVOICE:      17,   // Q
  DATE_INVOICE:    18,   // R
  DUE_DATE:        19,   // S
  FILE_URL:        20,   // T  soft file invoice
  VENDOR_CODE:     21,   // U
  INV_AMOUNT:      22,   // V  gross dari invoice
  DISKON:          23,   // W
  BIAYA_LAIN:      24,   // X
  STATUS_PPN:      25,   // Y  Non PPN / Include PPN / Exclude PPN
  DPP:             26,   // Z
  PPN_AMOUNT:      27,   // AA
  JENIS_PPH:       28,   // AB
  PPH_AMOUNT:      29,   // AC
  PPH_RATE:        30,   // AD  tarif yang dipakai (jejak audit)
  FINAL_AMOUNT:    31,   // AE  netto transfer
  STATUS:          32,   // AF
  CREATED_BY:      33,   // AG  email
  LINK_TTD:        34,   // AH  scan TTD basah
  JENIS_PEMBAYARAN:35,   // AI  Full / DP / Pelunasan
  CATEGORY_COA:    36,   // AJ
  HEAD_COA:        37,   // AK
  SUB_COA:         38,   // AL
  BUDGET:          39,   // AM
  NOTES_FINANCE:   40,   // AN
  REQUIRE_CFO:     41,   // AO  "YES"/"NO" — dikunci saat submit
  LAST_UPDATE:     42,   // AP
  LAST_PAY_DATE:   43,   // AQ
  TOTAL_PAID:      44,   // AR
  OS_BALANCE:      45,   // AS
  PAY_STATUS:      46,   // AT  Outstanding / Partially Paid / Paid
  QTY_PO:          47,   // AU  snapshot saat submit
  QTY_SJ:          48    // AV  snapshot saat submit
};

const COL_COUNT = 48;

// -------------------------------------------------------------------------
// Kolom sheet pendukung
// -------------------------------------------------------------------------
const COL_APPROVAL = {
  ID_APPROVAL: 1, ID_TRX: 2, LEVEL: 3, ROLE_LABEL: 4,
  APPROVER_NAME: 5, APPROVER_EMAIL: 6, JABATAN: 7,
  METHOD: 8, ACTION: 9, TIMESTAMP: 10, NOTES: 11, SIGNATURE_URL: 12
};

const COL_PAYLOG = {
  LOG_ID: 1, ID_TRX: 2, TGL_BAYAR: 3, NOMINAL: 4,
  SUMBER_REKENING: 5, REF_NO: 6, CREATED_BY: 7, TIMESTAMP: 8
};

const COL_AUDIT = {
  LOG_ID: 1, TIMESTAMP: 2, USER_EMAIL: 3, ID_TRX: 4,
  ACTION: 5, FIELD: 6, OLD_VALUE: 7, NEW_VALUE: 8, NOTES: 9
};

// Kolom 9-10 (PASSWORD_HASH/PASSWORD_SALT) BARU ditambahkan 2026-09-18 untuk
// login e-approver via nomor HP+password (lihat CONFIG.APPROVER_* di atas
// dan Auth.gs). Ditambah paling kanan sesuai konvensi — kolom 1-8 (yang
// dipakai Google-login/WA lama) tidak berubah posisi. Satu orang bisa
// punya beberapa baris (per brand/dept) — hash & salt-nya SAMA di semua
// baris milik nomor HP yang sama (lihat setPasswordUntukNomor_).
const COL_USER = {
  BRAND: 1, DEPT: 2, LEVEL: 3, JABATAN: 4, NAMA: 5, EMAIL: 6, AKTIF: 7, NO_HP: 8,
  PASSWORD_HASH: 9, PASSWORD_SALT: 10
};

// Tab WA_Pending_Approval — menyimpan state approval via WhatsApp:
// kode unik per (dokumen × approver), status OTP, dan kedaluwarsa.
const COL_WA = {
  KODE: 1,        // kode unik 4 digit yang dibalas approver (mis. "4821")
  ID_TRX: 2,      // dokumen yang diapprove
  EMAIL: 3,       // email approver (untuk kirim OTP & audit)
  NO_HP: 4,       // nomor WA approver (dinormalkan) — hanya nomor ini yang boleh membalas
  NOMINAL: 5,     // snapshot nominal (untuk cek threshold OTP)
  PERLU_OTP: 6,   // "YES"/"NO"
  OTP: 7,         // OTP 6 digit (kosong sampai diminta)
  OTP_EXP: 8,     // epoch ms kedaluwarsa OTP
  DIBUAT: 9,      // epoch ms saat kode dibuat
  STATUS: 10      // "WAITING" | "OTP_SENT" | "DONE" | "EXPIRED"
};

function getDB() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}
