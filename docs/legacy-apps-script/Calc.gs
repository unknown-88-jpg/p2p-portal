// =========================================================================
// FILE: Calc.gs
// SEMUA hitungan uang di sini. Server yang menghitung, bukan browser.
// Frontend boleh preview, tapi angkanya SELALU dihitung ulang di sini
// dan hasil dari browser DIABAIKAN.
// =========================================================================

//**
// * Hitung komponen pajak & nominal akhir.
// * @param {Object} input {invAmount, diskon, biayaLain, statusPPN, jenisPPh, npwpVendor}
// * @return {Object} {dpp, ppnAmount, pphRate, pphAmount, finalAmount}
// */
function hitungPajak(input) {
  const invAmount = num(input.invAmount);
  const diskon    = num(input.diskon);
  const biayaLain = num(input.biayaLain);
  const statusPPN = str(input.statusPPN) || "Non PPN";
  const jenisPPh  = str(input.jenisPPh) || "-";
  const npwp      = clean(input.npwpVendor);

  if (invAmount < 0 || diskon < 0 || biayaLain < 0) {
    throw new Error("Nominal tidak boleh negatif.");
  }
  if (diskon > invAmount) {
    throw new Error("Diskon tidak boleh melebihi nilai invoice.");
  }

  // --- DPP & PPN ---
  let dpp = 0, ppnAmount = 0;
  if (statusPPN === "Include PPN") {
    dpp = invAmount / (1 + CONFIG.PPN_RATE);
    ppnAmount = invAmount - dpp;
  } else if (statusPPN === "Exclude PPN") {
    dpp = invAmount;
    ppnAmount = dpp * CONFIG.PPN_RATE;
  } else {
    dpp = invAmount;
    ppnAmount = 0;
  }

  // --- PPh (dipotong dari pembayaran) ---
  let pphRate = 0, pphAmount = 0;
  if (jenisPPh !== "-" && jenisPPh !== "") {
    const rateRow = getPphRates().find(r => r.jenis === jenisPPh);
    if (!rateRow) throw new Error(`Jenis PPh "${jenisPPh}" tidak ada di Master_PPh.`);
    const punyaNPWP = npwp !== "" && npwp !== "-";
    pphRate = punyaNPWP ? rateRow.tarifNPWP : rateRow.tarifNon;
    pphAmount = dpp * pphRate;
  }

  const finalAmount = dpp + ppnAmount + biayaLain - diskon - pphAmount;

  if (finalAmount < 0) {
    throw new Error("Nominal akhir jadi negatif. Cek kembali diskon dan potongan PPh.");
  }

  return {
    dpp:         Math.round(dpp),
    ppnAmount:   Math.round(ppnAmount),
    pphRate:     pphRate,
    pphAmount:   Math.round(pphAmount),
    finalAmount: Math.round(finalAmount)
  };
}

//**
// * Preview untuk frontend — dipanggil live saat user ngetik.
// * Hasilnya cuma buat ditampilkan, TIDAK pernah disimpan langsung.
// */
function previewPajak(input) {
  try {
    return { success: true, data: hitungPajak(input) };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

//**
// * Apakah transaksi ini butuh TTD CFO?
// * Dikunci sekali saat submit supaya threshold gak bisa "digeser" belakangan.
// */
function butuhCFO(finalAmount) {
  return num(finalAmount) >= CONFIG.CFO_THRESHOLD;
}

//**
// * GATE PEMBAYARAN — ini yang bikin aturan bisnis lo jadi nyata,
// * bukan cuma hiasan di form cetak.
// * Dipanggil WAJIB sebelum executePayment().
// */
function bolehDibayar(row, rowValues) {
  const idTrx  = readCell(rowValues, COL.ID_TRX);
  const status = str(readCell(rowValues, COL.STATUS));
  const amount = num(readCell(rowValues, COL.FINAL_AMOUNT));
  const perluCFO = upper(readCell(rowValues, COL.REQUIRE_CFO)) === "YES";

  if (status !== STATUS.COA_POSTED && status !== STATUS.PARTIALLY_PAID) {
    return { ok: false, reason: `Status "${status}" belum boleh dibayar. Harus sudah "${STATUS.COA_POSTED}".` };
  }
  if (num(readCell(rowValues, COL.OS_BALANCE)) <= 0 && status === STATUS.PARTIALLY_PAID) {
    return { ok: false, reason: "Sisa utang sudah nol." };
  }

  const app = getApprovalMap(idTrx);

  if (!app[LEVEL.MANAGER])       return { ok: false, reason: "Belum ada approval Manager Divisi." };
  if (!app[LEVEL.FINANCE_STAFF]) return { ok: false, reason: "Belum diverifikasi Staff Finance." };
  if (!app[LEVEL.FINANCE_MGR])   return { ok: false, reason: "Belum ada TTD basah Manager Finance." };

  if (perluCFO && !app[LEVEL.CFO]) {
    return {
      ok: false,
      reason: `Transaksi Rp ${amount.toLocaleString("id-ID")} (≥ Rp ${CONFIG.CFO_THRESHOLD.toLocaleString("id-ID")}) wajib TTD basah CFO.`
    };
  }

  if (!str(readCell(rowValues, COL.SUB_COA)) || str(readCell(rowValues, COL.SUB_COA)) === "-") {
    return { ok: false, reason: "Jurnal COA belum diposting." };
  }
  if (!str(readCell(rowValues, COL.BUDGET))) {
    return { ok: false, reason: "Plafon budget belum diisi." };
  }
  if (!str(readCell(rowValues, COL.LINK_TTD))) {
    return { ok: false, reason: "Scan TTD basah belum diupload." };
  }

  return { ok: true };
}
