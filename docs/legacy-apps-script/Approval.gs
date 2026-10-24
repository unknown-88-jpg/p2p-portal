// =========================================================================
// FILE: Approval.gs
// Approval sekarang punya tabel sendiri (Trx_Approval), bukan lagi ditebak
// dari kolom status. Ini yang bikin lo bisa jawab "siapa approve apa, kapan"
// saat diaudit.
//
// REVISI 2026-09-18 (E-APPROVER Fase 1): getPendingApprovals/managerApprove/
// managerReject sekarang menerima `token` (sesi login nomor HP+password dari
// Auth.gs — lihat loginApprover/requireSesiApprover_), BUKAN lagi identitas
// Google (getUserProfile/Session). Approval_Portal.html sekarang wajib login
// dulu dan mengirim token itu di setiap panggilan. recordApproval() sendiri
// TIDAK diubah wajib pakai token — dia terima parameter opsional keenam
// (identityOverride) supaya caller lain yang masih pakai identitas Google
// (CRUD_Pengajuan.gs untuk e-sign PIC, API_Finance.gs untuk Level 3/4/5 —
// TERMASUK upload TTD basah Level 4/5 yang BELUM disentuh, itu baru Fase 2)
// tetap jalan tanpa perubahan sama sekali.
// =========================================================================

/**
 * Catat satu tanda tangan (digital maupun basah).
 *
 * @param {object} [identityOverride] — kalau diisi ({nama,email,jabatan}),
 *   pakai identitas ini LANGSUNG (tidak panggil getUserProfile()/Session).
 *   Dipakai oleh managerApprove/managerReject (Approval.gs) untuk approver
 *   yang login lewat nomor HP+password (tidak punya identitas Google).
 *   Kalau TIDAK diisi (default, semua caller lain), perilaku 100% sama
 *   seperti sebelumnya: ambil identitas dari getUserProfile().
 */
function recordApproval(idTrx, level, action, notes, signatureUrl, identityOverride) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.APPROVAL);

  let nama, email, jabatan, catatan;
  if (identityOverride) {
    nama = identityOverride.nama || identityOverride.nomor || "-";
    email = identityOverride.email || identityOverride.nomor || "-";
    jabatan = identityOverride.jabatan || "";
    catatan = (notes || "") + " [Portal-HP]";
  } else {
    const p = getUserProfile();
    if (!p.success) throw new Error(p.message);
    nama = p.user.nama;
    email = p.user.email;
    jabatan = p.user.jabatan;
    catatan = notes || "";
  }

  sheet.appendRow([
    "APR-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
    upper(idTrx),
    level,
    LEVEL_LABEL[level] || "Mengetahui,",
    nama,
    email,
    jabatan,
    SIGN_METHOD[level] || "E-SIGN",
    action,                       // APPROVED / REJECTED
    new Date(),
    catatan,
    signatureUrl || ""
  ]);

  writeAudit(idTrx, "APPROVAL", "Level " + level + (identityOverride ? " (Portal-HP)" : ""), "", action, notes || "");
}

/**
 * Peta approval per transaksi. Key = level, value = record.
 * Cuma yang APPROVED yang dihitung.
 */
function getApprovalMap(idTrx) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.APPROVAL);
  if (!sheet || sheet.getLastRow() < 2) return {};

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  const target = upper(idTrx);
  const map = {};

  data.forEach(r => {
    if (upper(r[COL_APPROVAL.ID_TRX - 1]) !== target) return;
    if (upper(r[COL_APPROVAL.ACTION - 1]) !== "APPROVED") return;

    const lvl = parseInt(r[COL_APPROVAL.LEVEL - 1], 10);
    map[lvl] = {
      level: lvl,
      roleLabel: r[COL_APPROVAL.ROLE_LABEL - 1],
      nama: r[COL_APPROVAL.APPROVER_NAME - 1],
      email: r[COL_APPROVAL.APPROVER_EMAIL - 1],
      jabatan: r[COL_APPROVAL.JABATAN - 1],
      method: r[COL_APPROVAL.METHOD - 1],
      timestamp: r[COL_APPROVAL.TIMESTAMP - 1],
      signatureUrl: r[COL_APPROVAL.SIGNATURE_URL - 1]
    };
  });
  return map;
}

/**
 * Bangun struktur kotak TTD untuk form cetak.
 * Ambil daftar penandatangan dari Master_User_TTD, lalu tempelkan status
 * approval nyata dari Trx_Approval.
 * CFO otomatis dilewati kalau transaksi < threshold.
 */
function buildSignatureBlocks(idTrx, brand, dept, perluCFO) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.USER_TTD);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const b = upper(brand);
  const d = upper(dept);
  const approved = getApprovalMap(idTrx);

  const signers = [];
  for (let i = 1; i < data.length; i++) {
    const rowBrand = upper(data[i][COL_USER.BRAND - 1]);
    const rowDept  = upper(data[i][COL_USER.DEPT - 1]);
    const aktif    = upper(data[i][COL_USER.AKTIF - 1]);
    if (aktif === "NO" || aktif === "TIDAK") continue;
    if (!(rowBrand === b || rowBrand === "ALL")) continue;
    if (!(rowDept === d || rowDept === "ALL")) continue;

    const level = parseInt(data[i][COL_USER.LEVEL - 1], 10) || 99;
    const nama  = upper(data[i][COL_USER.NAMA - 1]);
    if (!nama || nama === "-") continue;

    // Aturan bisnis: CFO cuma muncul kalau nominal >= threshold
    if (level === LEVEL.CFO && !perluCFO) continue;

    if (!signers.some(s => s.level === level)) {
      signers.push({
        level: level,
        jabatan: str(data[i][COL_USER.JABATAN - 1]) || "Staff",
        nama: nama
      });
    }
  }

  signers.sort((a, b) => a.level - b.level);

  return signers.map(s => {
    const rec = approved[s.level];
    const isWet = SIGN_METHOD[s.level] === "WET";
    return {
      level: s.level,
      role: LEVEL_LABEL[s.level] || "Mengetahui,",
      nama: rec ? rec.nama : s.nama,          // yang benar-benar TTD, kalau ada
      jabatan: rec ? rec.jabatan : s.jabatan,
      method: isWet ? "WET" : "E-SIGN",
      isSigned: !!rec,
      signedAt: rec ? fmtDate(rec.timestamp, "dd/MM/yyyy") : "",
      label: rec
        ? (isWet ? "TTD Basah — Terverifikasi" : "E-Signed")
        : (isWet ? "( TTD Basah )" : "( Menunggu )")
    };
  });
}

// =========================================================================
// PORTAL MANAGER — antrean approval untuk Level 2
//
// REVISI 2026-09-18: identitas datang dari `token` sesi login nomor HP+
// password (Auth.gs), BUKAN lagi getUserProfile()/Session Google. Kalau
// token tidak valid/kedaluwarsa, requireSesiApprover_ throw dan langsung
// ditangkap jadi {success:false, message:...} — Approval_Portal.html
// menampilkan pesan itu lalu balik ke layar login.
// =========================================================================
function getPendingApprovals(token) {
  try {
    const sesi = requireSesiApprover_(token);

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (sheet.getLastRow() < 2) return { success: true, data: [], user: sesi.user };

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COL_COUNT).getValues();
    const list = [];

    data.forEach(r => {
      const status = str(r[COL.STATUS - 1]);
      if (status !== STATUS.SUBMITTED) return;

      const brand = upper(r[COL.BRAND - 1]);
      const dept  = upper(r[COL.DEPARTEMENT - 1]);
      if (!hasAuthority(sesi.roles, brand, dept, LEVEL.MANAGER)) return;

      list.push({
        idTrx: r[COL.ID_TRX - 1],
        tgl: fmtDate(r[COL.TIMESTAMP - 1]),
        brand: brand,
        dept: dept,
        pic: r[COL.PIC - 1],
        vendor: r[COL.VENDOR_NAME - 1] || "-",
        desc: r[COL.DESCRIPTION - 1] || "-",
        noInvoice: r[COL.NO_INVOICE - 1] || "-",
        amount: num(r[COL.FINAL_AMOUNT - 1]),
        fileUrl: r[COL.FILE_URL - 1] || "",
        perluCFO: upper(r[COL.REQUIRE_CFO - 1]) === "YES"
      });
    });

    return { success: true, data: list, user: sesi.user };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Manager approve (bisa bulk). Setiap dokumen dicek ulang wewenangnya.
 * Sesi diverifikasi SEBELUM masuk withLock (kalau token invalid, gagal cepat
 * tanpa antre lock sama sekali).
 */
function managerApprove(token, idTrxList, notes) {
  let sesi;
  try {
    sesi = requireSesiApprover_(token);
  } catch (err) {
    return { success: false, message: err.message };
  }

  return withLock(function () {
    if (!idTrxList || !idTrxList.length) {
      return { success: false, message: "Tidak ada dokumen yang dipilih." };
    }

    const ok = [], gagal = [];

    idTrxList.forEach(id => {
      try {
        const row = findRowByIdTrx(id);
        if (row === -1) throw new Error("ID tidak ditemukan");

        const rv = getRowValues(row);
        const brand = upper(readCell(rv, COL.BRAND));
        const dept  = upper(readCell(rv, COL.DEPARTEMENT));

        if (!hasAuthority(sesi.roles, brand, dept, LEVEL.MANAGER)) {
          throw new Error("Anda bukan manager untuk " + brand + " - " + dept);
        }

        transitionStatus(row, id, STATUS.MANAGER_APPROVED, notes);
        recordApproval(id, LEVEL.MANAGER, "APPROVED", notes, "", sesi.user);
        ok.push(id);
      } catch (e) {
        gagal.push(id + ": " + e.message);
      }
    });

    let msg = `${ok.length} dokumen disetujui.`;
    if (gagal.length) msg += ` ${gagal.length} gagal — ${gagal.join("; ")}`;
    return { success: ok.length > 0, message: msg };
  });
}

/**
 * Manager kembalikan ke PIC untuk revisi.
 */
function managerReject(token, idTrx, alasan) {
  let sesi;
  try {
    sesi = requireSesiApprover_(token);
  } catch (err) {
    return { success: false, message: err.message };
  }

  return withLock(function () {
    if (!str(alasan)) return { success: false, message: "Alasan penolakan wajib diisi." };

    const row = findRowByIdTrx(idTrx);
    if (row === -1) return { success: false, message: "ID tidak ditemukan." };

    const rv = getRowValues(row);
    if (!hasAuthority(sesi.roles, readCell(rv, COL.BRAND), readCell(rv, COL.DEPARTEMENT), LEVEL.MANAGER)) {
      return { success: false, message: "Anda tidak berwenang atas dokumen ini." };
    }

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    transitionStatus(row, idTrx, STATUS.REVISION, alasan);
    sheet.getRange(row, COL.NOTES_FINANCE).setValue("[DITOLAK MANAGER] " + alasan);
    recordApproval(idTrx, LEVEL.MANAGER, "REJECTED", alasan, "", sesi.user);

    return { success: true, message: `${idTrx} dikembalikan ke PIC untuk revisi.` };
  });
}
