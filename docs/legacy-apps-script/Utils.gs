// =========================================================================
// FILE: Utils.gs
// Helper bersama: locking, audit trail, pencarian baris, upload, format.
// =========================================================================

// -------------------------------------------------------------------------
// LOCKING — bungkus SEMUA operasi tulis dengan ini.
// Ini yang mencegah dua user nabrak baris yang sama / ID duplikat.
//
// PENTING: error TIDAK boleh ditelan diam-diam. Dulu semua exception
// dibungkus jadi {success:false}, yang dari sisi browser terlihat seperti
// "sukses" — sehingga withFailureHandler tidak pernah terpanggil dan
// spinner berputar selamanya. Sekarang error dilempar ulang.
// -------------------------------------------------------------------------
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error("Sistem sedang memproses transaksi lain. Coba lagi beberapa detik.");
  }

  try {
    return fn();
  } catch (err) {
    logError(err);
    throw new Error(terjemahkanError_(err));   // dilempar, bukan ditelan
  } finally {
    try { SpreadsheetApp.flush(); } catch (e) {}
    lock.releaseLock();
  }
}


function terjemahkanError_(err) {
  const m = (err && err.message) ? err.message : String(err);

  if (m.indexOf("permissions are not sufficient") !== -1 ||
      m.indexOf("Specified permissions") !== -1) {
    return "MASALAH IZIN: script tidak punya akses ke Spreadsheet/Drive. " +
           "Admin perlu menambahkan oauthScopes di appsscript.json lalu deploy ulang.";
  }

  if (m.indexOf("You do not have permission") !== -1 ||
      m.indexOf("Access denied") !== -1 ||
      m.indexOf("not have access") !== -1) {
    return "MASALAH AKSES: akun Anda tidak punya izin ke database. " +
           "Ini biasanya berarti deployment masih diset 'Execute as: User accessing'. " +
           "Admin harus mengubahnya ke 'Execute as: Me' lalu deploy versi baru.";
  }

  if (m.indexOf("Service Spreadsheets") !== -1 || m.indexOf("timed out") !== -1) {
    return "Server Google sedang lambat. Coba lagi sebentar lagi.";
  }

  return m;
}

// -------------------------------------------------------------------------
// AUDIT TRAIL — append-only. Setiap perubahan status/nominal wajib lewat sini.
// -------------------------------------------------------------------------
function writeAudit(idTrx, action, field, oldVal, newVal, notes) {
  try {
    const sheet = getDB().getSheetByName(CONFIG.TAB.AUDIT);
    if (!sheet) return;
    sheet.appendRow([
      "LOG-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      new Date(),
      getCurrentEmail(),
      idTrx || "-",
      action || "-",
      field || "-",
      oldVal === undefined || oldVal === null ? "" : String(oldVal),
      newVal === undefined || newVal === null ? "" : String(newVal),
      notes || ""
    ]);
  } catch (e) {
    // Audit gagal tidak boleh menggagalkan transaksi, tapi harus tercatat.
    console.error("AUDIT FAIL: " + e.message);
  }
}

function logError(err) {
  console.error(err.stack || err.message);
}

// -------------------------------------------------------------------------
// PENCARIAN BARIS — pakai TextFinder, jauh lebih cepat daripada full scan.
// Return: nomor baris (1-based) atau -1.
// -------------------------------------------------------------------------
function findRowByIdTrx(idTrx) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
  const clean = (idTrx || "").toString().trim().toUpperCase();
  if (!clean) return -1;

  const found = sheet.getRange(2, COL.ID_TRX, Math.max(sheet.getLastRow() - 1, 1), 1)
    .createTextFinder(clean)
    .matchEntireCell(true)
    .matchCase(false)
    .findNext();

  return found ? found.getRow() : -1;
}

// Ambil satu baris utuh sebagai array (0-based index sesuai COL - 1)
function getRowValues(row) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
  return sheet.getRange(row, 1, 1, COL_COUNT).getValues()[0];
}

function readCell(rowValues, colConst) {
  return rowValues[colConst - 1];
}

// -------------------------------------------------------------------------
// TRANSISI STATUS — satu-satunya pintu untuk mengubah status.
// Menolak transisi ilegal & otomatis nulis audit.
// -------------------------------------------------------------------------
function transitionStatus(row, idTrx, statusBaru, notes) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
  const statusLama = (sheet.getRange(row, COL.STATUS).getValue() || STATUS.DRAFT).toString().trim();

  const allowed = STATUS_FLOW[statusLama] || [];
  if (allowed.indexOf(statusBaru) === -1) {
    throw new Error(
      `Transisi status ditolak: "${statusLama}" tidak boleh langsung ke "${statusBaru}". ` +
      `Dokumen ${idTrx} mungkin sudah diproses orang lain — silakan refresh.`
    );
  }

  sheet.getRange(row, COL.STATUS).setValue(statusBaru);
  sheet.getRange(row, COL.LAST_UPDATE).setValue(new Date());
  writeAudit(idTrx, "STATUS_CHANGE", "Status", statusLama, statusBaru, notes);
  return true;
}

// -------------------------------------------------------------------------
// IDENTITAS USER — dari Google Auth, bukan PIN.
// -------------------------------------------------------------------------
function getCurrentEmail() {
  // getActiveUser() bisa mengembalikan string KOSONG untuk sebagian user,
  // tergantung kombinasi setelan deployment & privasi domain — meski akunnya
  // valid. Ini penyebab tersembunyi "sudah terdaftar tapi ditolak".
  // Fallback ke getEffectiveUser() menutup celah itu pada deployment
  // "Execute as: Me" / USER_DEPLOYING (email eksekutor = email login domain).
  let e = "";
  try { e = Session.getActiveUser().getEmail() || ""; } catch (err) {}
  if (!e) {
    try { e = Session.getEffectiveUser().getEmail() || ""; } catch (err) {}
  }
  return e ? e.trim() : "unknown@system";
}

// -------------------------------------------------------------------------
// UPLOAD FILE
// -------------------------------------------------------------------------
function uploadToDrive(base64Data, fileName) {
  try {
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_LAMPIRAN_ID);
    const parts = base64Data.split(",");
    const type = parts[0].split(";")[0].replace("data:", "");
    const bytes = Utilities.base64Decode(parts[1]);
    const stamped = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "_" + fileName;
    const blob = Utilities.newBlob(bytes, type, stamped);

    // CATATAN: setSharing() sengaja TIDAK dipanggil di sini.
    // Panggilan itu sendiri memakan 1–2 detik per file, dan tidak perlu:
    // file mewarisi izin dari folder induknya.
    //
    // SYARAT: folder CONFIG.FOLDER_LAMPIRAN_ID harus di-share sekali saja,
    // secara manual, ke seluruh domain (Anyone in <domain> with the link → Viewer).
    // Kalau tidak, Finance tidak akan bisa membuka lampiran.
    return folder.createFile(blob).getUrl();

  } catch (error) {
    throw new Error("Gagal upload file: " + error.message);
  }
}

// -------------------------------------------------------------------------
// FORMAT & PARSING
// -------------------------------------------------------------------------
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function str(v) {
  return (v === null || v === undefined) ? "" : v.toString().trim();
}

function upper(v) {
  return str(v).toUpperCase();
}

function fmtDate(v, pattern) {
  if (!v) return "-";
  try {
    return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), pattern || "dd/MM/yyyy");
  } catch (e) {
    return "-";
  }
}

// Bersihkan apostrof leading yang dipakai sheet buat maksa text
function clean(v) {
  return str(v).replace(/^'/, "");
}


function extractDriveId_(url) {
  const u = str(url);
  if (!u) return "";
  const m = u.match(/\/d\/([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

// -------------------------------------------------------------------------
// PERBANDINGAN STRING KONSTAN-WAKTU — dipakai di mana pun kita membandingkan
// sesuatu yang rahasia (secret webhook, hash password) dengan input dari
// luar, supaya waktu eksekusi tidak membocorkan informasi (berapa karakter
// awal yang sudah cocok) ke penyerang yang mengukur response time.
//
// Dipakai oleh: verifikasiKeyWebhookWA_() (WA_Approval.gs, code review
// 2026-09-18 temuan #3) dan loginApprover()/hashPassword_() (Auth.gs,
// e-approver phone+password). Disatukan di sini (2026-09-18 malam) supaya
// tidak ada 2 implementasi diff-XOR yang harus dijaga konsisten terpisah.
// -------------------------------------------------------------------------
function bandingkanAmanString_(a, b) {
  const sa = str(a), sb = str(b);
  const len = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < len; i++) {
    diff |= ((sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0));
  }
  return diff === 0;
}
