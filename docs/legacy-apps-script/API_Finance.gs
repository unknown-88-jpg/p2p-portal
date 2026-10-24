// =========================================================================
// FILE: API_Finance.gs
// Dashboard finance: 4 antrean berurutan.
//   Tab 1 Pajak     : Manager Approved  -> Tax Verified
//   Tab 2 TTD Basah : Tax Verified      -> Wet Signed   (upload scan)
//   Tab 3 Jurnal    : Wet Signed        -> COA Posted
//   Tab 4 Treasury  : COA Posted        -> Partially Paid / Paid
//   Tab 5 Vendor    : sahkan vendor baru
// =========================================================================

function getFinanceQueues() {
  try {
    // Guard level — sebelum code review 2026-09-18, fungsi ini cuma
    // memanggil getUserProfile() (cukup terdaftar di Master_User_TTD, level
    // berapa pun) lalu mengembalikan SELURUH antrean finance apa adanya:
    // nominal invoice, NPWP vendor, nomor rekening, lintas brand/divisi.
    // Dashboard ini isinya data paling sensitif di sistem, jadi read-only
    // pun wajib dibatasi ke Finance (Level 3+) — sama seperti semua fungsi
    // tulis di file ini (verifyTax, submitWetSignature, dst).
    const p = requireLevel(LEVEL.FINANCE_STAFF);

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (sheet.getLastRow() < 2) {
      return { success: true, user: p.user, tax: [], wet: [], coa: [], treasury: [] };
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COL_COUNT).getValues();
    const tax = [], wet = [], coa = [], treasury = [];

    const normEmail = (v) => str(v).replace(/[\s ​-‍﻿]/g, "").toLowerCase();
    const emailSaya = normEmail(p.user.email);

    data.forEach((r, i) => {
      const status = str(r[COL.STATUS - 1]);
      const item = {
        row: i + 2,
        idTrx: r[COL.ID_TRX - 1],
        tgl: fmtDate(r[COL.TIMESTAMP - 1]),
        brand: r[COL.BRAND - 1],
        dept: r[COL.DEPARTEMENT - 1],
        tipe: r[COL.TIPE - 1],
        pic: r[COL.PIC - 1],
        vendor: r[COL.VENDOR_NAME - 1],
        npwpVendor: clean(r[COL.NPWP_VENDOR - 1]),
        poNumber: r[COL.PO_NUMBER - 1] || "-",
        noInvoice: r[COL.NO_INVOICE - 1] || "-",
        dueDate: fmtDate(r[COL.DUE_DATE - 1]),
        description: r[COL.DESCRIPTION - 1] || "-",
        fileUrl: r[COL.FILE_URL - 1] || "",
        linkTTD: r[COL.LINK_TTD - 1] || "",
        invAmount: num(r[COL.INV_AMOUNT - 1]),
        diskon: num(r[COL.DISKON - 1]),
        biayaLain: num(r[COL.BIAYA_LAIN - 1]),
        statusPPN: r[COL.STATUS_PPN - 1],
        dpp: num(r[COL.DPP - 1]),
        ppnAmount: num(r[COL.PPN_AMOUNT - 1]),
        jenisPPh: r[COL.JENIS_PPH - 1] || "-",
        pphAmount: num(r[COL.PPH_AMOUNT - 1]),
        finalAmount: num(r[COL.FINAL_AMOUNT - 1]),
        totalPaid: num(r[COL.TOTAL_PAID - 1]),
        osBalance: num(r[COL.OS_BALANCE - 1]),
        payStatus: r[COL.PAY_STATUS - 1] || "Outstanding",
        perluCFO: upper(r[COL.REQUIRE_CFO - 1]) === "YES",
        // True kalau dokumen ini diajukan oleh orang yang sedang login —
        // dipakai UI untuk menonaktifkan tombol verifikasi pajak (pengaju ≠
        // verifikator). Server tetap memblokir keras di verifyTax.
        isSelfSubmitted: normEmail(r[COL.CREATED_BY - 1]) === emailSaya,
        status: status
      };

      if (status === STATUS.MANAGER_APPROVED)      tax.push(item);
      else if (status === STATUS.TAX_VERIFIED)     wet.push(item);
      else if (status === STATUS.WET_SIGNED)       coa.push(item);
      else if (status === STATUS.COA_POSTED ||
               status === STATUS.PARTIALLY_PAID)   treasury.push(item);
    });

    return { success: true, user: p.user, tax, wet, coa, treasury };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// -------------------------------------------------------------------------
// TAHAP 1: Verifikasi Pajak (Level 3 — Staff Finance, e-sign)
// Nilai final DIHITUNG ULANG di server. Angka dari browser diabaikan.
// -------------------------------------------------------------------------
function verifyTax(input) {
  return withLock(function () {
    const pf = requireLevel(LEVEL.FINANCE_STAFF);

    const row = findRowByIdTrx(input.idTrx);
    if (row === -1) throw new Error("ID transaksi tidak ditemukan.");

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    const rv = getRowValues(row);

    // SEGREGATION OF DUTIES — pengaju ≠ verifikator.
    // Kalau dokumen ini diajukan oleh orang yang sama yang sekarang mencoba
    // memverifikasi pajaknya (kasus lazim saat tim Finance mengajukan sendiri),
    // BLOKIR. Harus diverifikasi finance staff LAIN. Ini mencegah satu orang
    // "mengajukan sekaligus meloloskan" uang keluar.
    const norm = (v) => str(v).replace(/[\s ​-‍﻿]/g, "").toLowerCase();
    const emailPengaju = norm(readCell(rv, COL.CREATED_BY));
    const emailVerifikator = norm(pf.user.email);
    if (emailPengaju && emailPengaju === emailVerifikator) {
      throw new Error(
        "Anda mengajukan dokumen ini, jadi tidak boleh memverifikasi pajaknya sendiri.\n\n" +
        "Sesuai pemisahan tugas (pengaju ≠ verifikator), dokumen ini harus diverifikasi " +
        "oleh staff Finance lain. Minta rekan Finance Anda yang memprosesnya."
      );
    }

    const oldFinal = num(readCell(rv, COL.FINAL_AMOUNT));

    const calc = hitungPajak({
      invAmount:  input.invAmount,
      diskon:     input.diskon,
      biayaLain:  input.biayaLain,
      statusPPN:  input.statusPPN,
      jenisPPh:   input.jenisPPh,
      npwpVendor: readCell(rv, COL.NPWP_VENDOR)
    });

    const set = (c, v) => sheet.getRange(row, c).setValue(v);
    set(COL.INV_AMOUNT,   num(input.invAmount));
    set(COL.DISKON,       num(input.diskon));
    set(COL.BIAYA_LAIN,   num(input.biayaLain));
    set(COL.STATUS_PPN,   str(input.statusPPN));
    set(COL.DPP,          calc.dpp);
    set(COL.PPN_AMOUNT,   calc.ppnAmount);
    set(COL.JENIS_PPH,    str(input.jenisPPh) || "-");
    set(COL.PPH_RATE,     calc.pphRate);
    set(COL.PPH_AMOUNT,   calc.pphAmount);
    set(COL.FINAL_AMOUNT, calc.finalAmount);
    set(COL.OS_BALANCE,   calc.finalAmount - num(readCell(rv, COL.TOTAL_PAID)));
    set(COL.REQUIRE_CFO,  butuhCFO(calc.finalAmount) ? "YES" : "NO");

    transitionStatus(row, input.idTrx, STATUS.TAX_VERIFIED, str(input.notes));
    recordApproval(input.idTrx, LEVEL.FINANCE_STAFF, "APPROVED",
      `Pajak diverifikasi. Final Rp ${calc.finalAmount.toLocaleString("id-ID")}`, "");

    if (oldFinal !== calc.finalAmount) {
      writeAudit(input.idTrx, "TAX_ADJUST", "Final Amount", oldFinal, calc.finalAmount,
        "Dikoreksi staff finance");
    }

    const perluCFO = butuhCFO(calc.finalAmount);
    return {
      success: true,
      message: `Pajak ${input.idTrx} terverifikasi. Netto Rp ${calc.finalAmount.toLocaleString("id-ID")}. ` +
               `Cetak voucher untuk TTD basah ${perluCFO ? "Manager Finance + CFO." : "Manager Finance."}`
    };
  });
}

// -------------------------------------------------------------------------
// TAHAP 2: Upload scan TTD basah (Level 4 & 5)
// Finance upload scan, lalu KONFIRMASI siapa saja yang sudah TTD.
// Sistem menolak kalau CFO wajib tapi belum dicentang.
// -------------------------------------------------------------------------
function submitWetSignature(input) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);

    const row = findRowByIdTrx(input.idTrx);
    if (row === -1) throw new Error("ID transaksi tidak ditemukan.");

    const rv = getRowValues(row);
    const perluCFO = upper(readCell(rv, COL.REQUIRE_CFO)) === "YES";
    const amount = num(readCell(rv, COL.FINAL_AMOUNT));

    if (!input.signedFinanceMgr) {
      throw new Error("TTD basah Manager Finance wajib ada.");
    }
    if (perluCFO && !input.signedCFO) {
      throw new Error(
        `Nominal Rp ${amount.toLocaleString("id-ID")} melewati batas Rp ${CONFIG.CFO_THRESHOLD.toLocaleString("id-ID")}. ` +
        `TTD basah CFO wajib ada sebelum dokumen bisa lanjut.`
      );
    }
    if (!input.base64 || !input.fileName) {
      throw new Error("File scan voucher yang sudah ditandatangani wajib diupload.");
    }

    const url = uploadToDrive(input.base64, "TTD_" + input.idTrx + "_" + input.fileName);
    getDB().getSheetByName(CONFIG.TAB.PENGAJUAN).getRange(row, COL.LINK_TTD).setValue(url);

    recordApproval(input.idTrx, LEVEL.FINANCE_MGR, "APPROVED",
      str(input.namaFinanceMgr) ? "TTD oleh " + input.namaFinanceMgr : "TTD basah terverifikasi", url);

    if (perluCFO) {
      recordApproval(input.idTrx, LEVEL.CFO, "APPROVED",
        str(input.namaCFO) ? "TTD oleh " + input.namaCFO : "TTD basah terverifikasi", url);
    }

    transitionStatus(row, input.idTrx, STATUS.WET_SIGNED, "Scan TTD basah diupload");

    return { success: true, message: `TTD basah ${input.idTrx} tercatat. Lanjut ke posting jurnal COA.` };
  });
}

// -------------------------------------------------------------------------
// TAHAP 3: Posting Jurnal COA (bulk)
// -------------------------------------------------------------------------
function postJournalBulk(list) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);
    if (!list || !list.length) throw new Error("Tidak ada baris yang dipilih.");

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    const coaMaster = getMasterCoaData();
    const ok = [], gagal = [];

    list.forEach(d => {
      try {
        const row = findRowByIdTrx(d.idTrx);
        if (row === -1) throw new Error("ID tidak ditemukan");

        const lvl1 = str(d.lvl1), lvl2 = str(d.lvl2);
        const lvl3 = str(d.lvl3) || "-", lvl4 = str(d.lvl4) || "-", lvl5 = str(d.lvl5) || "-";

        if (!lvl1 || !lvl2) throw new Error("COA level 1 & 2 wajib diisi");
        if (!str(d.budget)) throw new Error("Plafon budget wajib diisi");

        // Validasi kombinasi COA benar-benar ada di master
        const valid = coaMaster.some(c =>
          c[0] === lvl1 && c[1] === lvl2 &&
          (lvl3 === "-" || c[2] === lvl3) &&
          (lvl4 === "-" || c[3] === lvl4) &&
          (lvl5 === "-" || c[4] === lvl5)
        );
        if (!valid) throw new Error("Kombinasi akun COA tidak ada di Master_COA");

        // Akun eksekusi = level terdalam yang bukan "-"
        let akun = lvl2;
        if (lvl3 !== "-") akun = lvl3;
        if (lvl4 !== "-") akun = lvl4;
        if (lvl5 !== "-") akun = lvl5;

        sheet.getRange(row, COL.CATEGORY_COA).setValue(lvl1);
        sheet.getRange(row, COL.HEAD_COA).setValue(lvl2);
        sheet.getRange(row, COL.SUB_COA).setValue(akun);
        sheet.getRange(row, COL.BUDGET).setValue(upper(d.budget));
        sheet.getRange(row, COL.NOTES_FINANCE).setValue(str(d.notes));

        transitionStatus(row, d.idTrx, STATUS.COA_POSTED, "Jurnal: " + akun);
        writeAudit(d.idTrx, "COA_POST", "Sub COA", "", akun, "Budget: " + upper(d.budget));
        ok.push(d.idTrx);
      } catch (e) {
        gagal.push(d.idTrx + " (" + e.message + ")");
      }
    });

    let msg = `${ok.length} transaksi terjurnal.`;
    if (gagal.length) msg += ` Gagal: ${gagal.join("; ")}`;
    return { success: ok.length > 0, message: msg };
  });
}

// -------------------------------------------------------------------------
// TAHAP 4: Treasury — realisasi pembayaran (mendukung cicilan & bulk)
// Payment_Log adalah SUMBER KEBENARAN. Kolom TOTAL_PAID cuma ringkasan.
//
// Logika inti dipisah dari lock (executePaymentCore_) supaya bisa dipanggil
// berulang di dalam SATU lock saat bulk — bukan buka-tutup lock per baris.
// Aturan yang berlaku SAMA PERSIS baik untuk bayar satuan maupun massal:
// gate approval, tidak boleh overpay, dan payment log tetap sumber kebenaran.
// -------------------------------------------------------------------------
function executePayment(input) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);
    return executePaymentCore_(input);
  });
}

/**
 * Bayar banyak transaksi sekaligus, ditandai lewat ID Trx masing-masing.
 * Satu lock untuk seluruh batch — bukan berarti "longgar", tapi supaya
 * antar baris dalam satu batch tidak saling serobot dan lebih cepat
 * daripada buka-tutup lock per baris.
 *
 * @param {Array} list  [{ idTrx, nominalBayar, tglBayar, sumberRekening, refNo }, ...]
 */
function executePaymentBulk(list) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);
    if (!list || !list.length) throw new Error("Tidak ada transaksi yang dipilih.");

    const ok = [], gagal = [];

    list.forEach(item => {
      try {
        const res = executePaymentCore_(item);
        ok.push(`${item.idTrx}: ${res.message}`);
      } catch (e) {
        gagal.push(`${item.idTrx}: ${e.message}`);
      }
    });

    let msg = `${ok.length} pembayaran berhasil diproses.`;
    if (gagal.length) msg += `\n\n${gagal.length} GAGAL:\n` + gagal.join("\n");

    return { success: ok.length > 0, message: msg, ok: ok.length, gagal: gagal.length };
  });
}

/**
 * Logika inti realisasi pembayaran satu transaksi. TIDAK mengunci sendiri —
 * pemanggil (executePayment / executePaymentBulk) yang bertanggung jawab
 * atas lock. Jangan panggil fungsi ini langsung dari luar withLock().
 */
function executePaymentCore_(input) {
  const row = findRowByIdTrx(input.idTrx);
  if (row === -1) throw new Error("ID transaksi tidak ditemukan.");

  const rv = getRowValues(row);

  // GATE — aturan bisnis lo: harus lolos semua approval, TTD basah,
  // COA sudah diposting, dsb. Berlaku sama untuk satuan maupun massal.
  const gate = bolehDibayar(row, rv);
  if (!gate.ok) throw new Error("Pembayaran diblokir: " + gate.reason);

  const nominal = num(input.nominalBayar);
  if (nominal <= 0) throw new Error("Nominal pembayaran harus lebih dari nol.");
  if (!str(input.tglBayar)) throw new Error("Tanggal transfer wajib diisi.");
  if (!str(input.sumberRekening)) throw new Error("Sumber rekening kas wajib dipilih.");

  const finalAmount = num(readCell(rv, COL.FINAL_AMOUNT));

  // Hitung ulang dari payment log — jangan percaya kolom ringkasan.
  // Ini juga yang mencegah dua baris dalam satu batch (kalau ada duplikat
  // ID, seharusnya tidak mungkin dari UI) saling overpay satu sama lain,
  // karena log sudah ter-append sebelum item berikutnya diproses.
  const sudahDibayar = getTotalPaidFromLog(input.idTrx);
  const sisa = finalAmount - sudahDibayar;

  if (nominal > sisa + CONFIG.PAYMENT_TOLERANCE) {
    throw new Error(
      `Overpayment. Sisa utang Rp ${sisa.toLocaleString("id-ID")}, ` +
      `input Rp ${nominal.toLocaleString("id-ID")}.`
    );
  }

  const ss = getDB();
  const totalBaru = sudahDibayar + nominal;
  let osBaru = finalAmount - totalBaru;
  if (Math.abs(osBaru) <= CONFIG.PAYMENT_TOLERANCE) osBaru = 0;

  const statusBayar = osBaru <= 0 ? "Paid" : "Partially Paid";
  const statusDoc   = osBaru <= 0 ? STATUS.PAID : STATUS.PARTIALLY_PAID;

  // Tulis log dulu (append-only), baru ringkasan
  ss.getSheetByName(CONFIG.TAB.PAYMENT_LOG).appendRow([
    "PAY-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
    upper(input.idTrx),
    input.tglBayar,
    nominal,
    str(input.sumberRekening),
    str(input.refNo) || "-",
    getCurrentEmail(),
    new Date()
  ]);

  const sheet = ss.getSheetByName(CONFIG.TAB.PENGAJUAN);
  sheet.getRange(row, COL.LAST_PAY_DATE).setValue(input.tglBayar);
  sheet.getRange(row, COL.TOTAL_PAID).setValue(totalBaru);
  sheet.getRange(row, COL.OS_BALANCE).setValue(osBaru);
  sheet.getRange(row, COL.PAY_STATUS).setValue(statusBayar);

  transitionStatus(row, input.idTrx, statusDoc,
    `Bayar Rp ${nominal.toLocaleString("id-ID")} via ${input.sumberRekening}` +
    (str(input.refNo) ? ` (Ref: ${input.refNo})` : ""));
  writeAudit(input.idTrx, "PAYMENT", "Total Paid", sudahDibayar, totalBaru, str(input.sumberRekening));

  const msg = osBaru <= 0
    ? `LUNAS.`
    : `Cicilan masuk. Sisa Rp ${osBaru.toLocaleString("id-ID")}.`;

  return { success: true, message: msg };
}

function getTotalPaidFromLog(idTrx) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.PAYMENT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const target = upper(idTrx);
  return data
    .filter(r => upper(r[COL_PAYLOG.ID_TRX - 1]) === target)
    .reduce((sum, r) => sum + num(r[COL_PAYLOG.NOMINAL - 1]), 0);
}

function getPaymentHistory(idTrx) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.PAYMENT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const target = upper(idTrx);

  return data
    .filter(r => upper(r[COL_PAYLOG.ID_TRX - 1]) === target)
    .map(r => ({
      logId: r[COL_PAYLOG.LOG_ID - 1],
      tgl: fmtDate(r[COL_PAYLOG.TGL_BAYAR - 1]),
      nominal: num(r[COL_PAYLOG.NOMINAL - 1]),
      rekening: r[COL_PAYLOG.SUMBER_REKENING - 1],
      refNo: r[COL_PAYLOG.REF_NO - 1],
      oleh: r[COL_PAYLOG.CREATED_BY - 1]
    }));
}

// -------------------------------------------------------------------------
// TOLAK / KEMBALIKAN KE PIC (dari tahap finance manapun)
// -------------------------------------------------------------------------
function financeReject(idTrx, alasan) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);
    if (!str(alasan)) throw new Error("Alasan penolakan wajib diisi.");

    const row = findRowByIdTrx(idTrx);
    if (row === -1) throw new Error("ID transaksi tidak ditemukan.");

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    transitionStatus(row, idTrx, STATUS.REVISION, alasan);
    sheet.getRange(row, COL.NOTES_FINANCE).setValue("[DITOLAK FINANCE] " + alasan);
    recordApproval(idTrx, LEVEL.FINANCE_STAFF, "REJECTED", alasan, "");

    return { success: true, message: `${idTrx} dikembalikan ke PIC.` };
  });
}
