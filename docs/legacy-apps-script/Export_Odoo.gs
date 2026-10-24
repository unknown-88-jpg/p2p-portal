// =========================================================================
// FILE: Export_Odoo.gs
// Export jurnal ke CSV yang bisa langsung diimpor Odoo
// (Accounting > Journal Entries > Import).
//
// Menghasilkan DUA jenis entry — ini pemisahan akuntansi yang benar:
//
//   A. JURNAL PEMBELIAN (saat invoice diakui / COA Posted)
//        Debit  : akun beban (Sub COA)
//        Debit  : PPN Masukan (kalau ada)
//        Credit : Hutang PPh (kalau ada potongan)
//        Credit : Hutang Usaha (netto)
//
//   B. JURNAL PEMBAYARAN (satu baris per transfer di Trx_Payment_Log)
//        Debit  : Hutang Usaha
//        Credit : Kas/Bank  ← akun COA yang dipilih saat bayar (sumber rekening)
//
// Dengan begini, sisi kredit pembayaran memakai akun kas yang benar-benar
// dipakai — bukan lagi "Hutang Usaha" yang di-hardcode.
//
// Sesuaikan nama akun perantara di bawah dengan Chart of Account Odoo lo.
// =========================================================================

const ODOO_ACCOUNT = {
  PPN_MASUKAN:  "1-10500 PPN Masukan",
  HUTANG_USAHA: "2-10100 Hutang Usaha",
  HUTANG_PPH:   "2-10300 Hutang PPh"
};

/**
 * @param {string} tglMulai
 * @param {string} tglSelesai
 * @param {string} jenis  "pembelian" | "pembayaran" | "keduanya" (default)
 */
function exportJurnalOdoo(tglMulai, tglSelesai, jenis) {
  try {
    const ss = getDB();
    const sheet = ss.getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (sheet.getLastRow() < 2) return { success: false, message: "Tidak ada data." };

    const mode = str(jenis) || "keduanya";
    const from = new Date(tglMulai);
    const to   = new Date(tglSelesai);
    to.setHours(23, 59, 59);

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COL_COUNT).getValues();

    const rows = [[
      "Number", "Date", "Journal", "Partner", "Reference",
      "Label", "Account", "Analytic Account", "Debit", "Credit"
    ]];

    let countBeli = 0, countBayar = 0;

    // ---- A. JURNAL PEMBELIAN ----
    if (mode === "pembelian" || mode === "keduanya") {
      data.forEach(r => {
        const status = str(r[COL.STATUS - 1]);
        if (status !== STATUS.COA_POSTED && status !== STATUS.PARTIALLY_PAID && status !== STATUS.PAID) return;

        // Filter pakai TANGGAL INVOICE (tanggal akuntansi dari lampiran vendor),
        // BUKAN tanggal submit draft. Kalau tanggal invoice kosong/invalid,
        // fallback ke timestamp submit supaya baris tidak hilang diam-diam.
        let tgl = new Date(r[COL.DATE_INVOICE - 1]);
        if (isNaN(tgl.getTime())) tgl = new Date(r[COL.TIMESTAMP - 1]);
        if (tgl < from || tgl > to) return;

        const id       = str(r[COL.ID_TRX - 1]);
        const tglStr   = fmtDate(r[COL.DATE_INVOICE - 1], "yyyy-MM-dd");
        const vendor   = str(r[COL.VENDOR_NAME - 1]);
        const ref      = str(r[COL.NO_INVOICE - 1]);
        const desc     = str(r[COL.DESCRIPTION - 1]);
        const budget   = str(r[COL.BUDGET - 1]);
        const akunBeban= str(r[COL.SUB_COA - 1]);

        const dpp    = num(r[COL.DPP - 1]);
        const ppn    = num(r[COL.PPN_AMOUNT - 1]);
        const biaya  = num(r[COL.BIAYA_LAIN - 1]);
        const diskon = num(r[COL.DISKON - 1]);
        const pph    = num(r[COL.PPH_AMOUNT - 1]);
        const netto  = num(r[COL.FINAL_AMOUNT - 1]);

        const debitBeban = dpp + biaya - diskon;

        rows.push([id, tglStr, "Purchase", vendor, ref, desc, akunBeban, budget, debitBeban.toFixed(2), "0.00"]);
        if (ppn > 0)
          rows.push(["", "", "", "", "", "PPN Masukan " + ref, ODOO_ACCOUNT.PPN_MASUKAN, budget, ppn.toFixed(2), "0.00"]);
        if (pph > 0)
          rows.push(["", "", "", "", "", str(r[COL.JENIS_PPH - 1]) + " " + ref, ODOO_ACCOUNT.HUTANG_PPH, budget, "0.00", pph.toFixed(2)]);
        rows.push(["", "", "", "", "", "Hutang " + vendor, ODOO_ACCOUNT.HUTANG_USAHA, budget, "0.00", netto.toFixed(2)]);

        countBeli++;
      });
    }

    // ---- B. JURNAL PEMBAYARAN (dari Trx_Payment_Log) ----
    if (mode === "pembayaran" || mode === "keduanya") {
      // Peta ID Trx -> {vendor, budget} untuk melengkapi baris pembayaran
      const meta = {};
      data.forEach(r => {
        meta[upper(r[COL.ID_TRX - 1])] = {
          vendor: str(r[COL.VENDOR_NAME - 1]),
          budget: str(r[COL.BUDGET - 1])
        };
      });

      const logSheet = ss.getSheetByName(CONFIG.TAB.PAYMENT_LOG);
      if (logSheet && logSheet.getLastRow() > 1) {
        const logs = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 8).getValues();

        logs.forEach(p => {
          const tgl = new Date(p[COL_PAYLOG.TGL_BAYAR - 1]);
          if (isNaN(tgl.getTime()) || tgl < from || tgl > to) return;

          const idTrx    = upper(p[COL_PAYLOG.ID_TRX - 1]);
          const nominal  = num(p[COL_PAYLOG.NOMINAL - 1]);
          const akunKas  = str(p[COL_PAYLOG.SUMBER_REKENING - 1]);  // akun COA kas
          const refBayar = str(p[COL_PAYLOG.REF_NO - 1]);
          const logId    = str(p[COL_PAYLOG.LOG_ID - 1]);
          if (nominal <= 0) return;

          const m = meta[idTrx] || { vendor: idTrx, budget: "" };
          const tglStr = fmtDate(tgl, "yyyy-MM-dd");

          // Debit Hutang Usaha (bawa header entry pembayaran)
          rows.push([logId, tglStr, "Bank", m.vendor, refBayar || idTrx,
                     "Pelunasan " + idTrx, ODOO_ACCOUNT.HUTANG_USAHA, m.budget,
                     nominal.toFixed(2), "0.00"]);
          // Credit Kas/Bank — akun COA yang dipilih saat bayar
          rows.push(["", "", "", "", "", "Kas keluar " + idTrx,
                     akunKas || ODOO_ACCOUNT.HUTANG_USAHA, m.budget,
                     "0.00", nominal.toFixed(2)]);

          countBayar++;
        });
      }
    }

    const total = countBeli + countBayar;
    if (total === 0) {
      return { success: false, message: "Tidak ada transaksi di rentang & jenis yang dipilih." };
    }

    const csv = rows.map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    const folder = DriveApp.getFolderById(CONFIG.FOLDER_LAMPIRAN_ID);
    const nama = `Odoo_${mode}_${fmtDate(from, "yyyyMMdd")}_${fmtDate(to, "yyyyMMdd")}.csv`;
    const file = folder.createFile(nama, csv, MimeType.CSV);

    writeAudit("-", "EXPORT_ODOO", mode, "",
      `${countBeli} pembelian, ${countBayar} pembayaran`, nama);

    return {
      success: true,
      message: `Pembelian: ${countBeli} entry · Pembayaran: ${countBayar} entry.`,
      url: file.getUrl(),
      fileName: nama
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
