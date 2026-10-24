// =========================================================================
// FILE: Diagnostics.gs
// Jalankan dari editor Apps Script (bukan dari browser) buat cari
// tahap mana yang sebenarnya lambat. Hasilnya keluar di "Execution log"
// (View > Logs, atau Ctrl+Enter setelah run).
// =========================================================================

/**
 * Ukur waktu tiap tahap savePengajuan tanpa lewat browser sama sekali.
 * Kalau ini juga lambat, penyebabnya di server (Sheets/Drive), bukan
 * di jaringan atau kompresi gambar di browser.
 */
function diagnosaKecepatan() {
  const t0 = new Date().getTime();
  const lap = (label) => {
    const now = new Date().getTime();
    Logger.log(`${label}: ${now - t0} ms (total sejak mulai)`);
    return now;
  };

  Logger.log("=== MULAI DIAGNOSA ===");

  // 1. Buka spreadsheet
  const ss = getDB();
  lap("1. Buka spreadsheet");

  // 2. Baca sheet utama — ini yang paling sering jadi biang lambat
  //    kalau ada "baris hantu" (terformat tapi kosong)
  const sheet = ss.getSheetByName(CONFIG.TAB.PENGAJUAN);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const maxRow = sheet.getMaxRows();
  const maxCol = sheet.getMaxColumns();
  Logger.log(`   Trx_Pengajuan: lastRow=${lastRow} lastCol=${lastCol} | ` +
             `maxRow=${maxRow} maxCol=${maxCol} (kapasitas sheet)`);
  if (maxRow > lastRow + 500) {
    Logger.log(`   ⚠️ Sheet punya ${maxRow} baris kapasitas tapi cuma ` +
               `${lastRow} yang terisi. Ini bisa memperlambat getLastRow()/getDataRange(). ` +
               `Jalankan bersihkanBarisKosong().`);
  }
  lap("2. Baca dimensi sheet");

  // 3. Simulasikan pencarian ID (dipakai tiap submit & approval)
  findRowByIdTrx("TEST-TIDAK-ADA");
  lap("3. findRowByIdTrx (TextFinder)");

  // 4. Simulasikan cek duplikat invoice
  assertNoDuplicateInvoice_("VENDOR TEST", "INV-TEST-DIAGNOSA", null);
  lap("4. assertNoDuplicateInvoice_");

  // 5. Baca Master_Vendor
  const vendorSheet = ss.getSheetByName(CONFIG.TAB.VENDOR);
  vendorSheet.getDataRange().getValues();
  lap("5. Baca Master_Vendor penuh");

  // 6. Upload file kecil ke Drive — bagian yang paling sering lambat
  try {
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_LAMPIRAN_ID);
    lap("6a. Buka folder Drive");

    const blob = Utilities.newBlob("test diagnosa", "text/plain", "_diagnosa_test.txt");
    const file = folder.createFile(blob);
    lap("6b. Upload file kecil ke Drive");

    file.setTrashed(true);   // bersihkan file test
    lap("6c. Hapus file test");
  } catch (e) {
    Logger.log("   ⚠️ GAGAL akses folder Drive: " + e.message);
    Logger.log("   Cek CONFIG.FOLDER_LAMPIRAN_ID masih valid & bisa diakses akun ini.");
  }

  // 7. Tulis satu baris ke Audit_Log (simulasi writeAudit)
  const auditSheet = ss.getSheetByName(CONFIG.TAB.AUDIT);
  if (auditSheet) {
    auditSheet.appendRow(["TEST", new Date(), "diagnosa", "-", "TEST", "-", "-", "-", "diagnosa"]);
    lap("7a. Tulis ke Audit_Log");
    auditSheet.deleteRow(auditSheet.getLastRow());
    lap("7b. Hapus baris test Audit_Log");
  }

  const total = new Date().getTime() - t0;
  Logger.log(`=== SELESAI. TOTAL: ${total} ms ===`);

  if (total > 8000) {
    Logger.log("⚠️ Total di atas 8 detik BAHKAN TANPA upload gambar dan tanpa jaringan browser. " +
                "Penyebabnya ada di server: sheet terlalu besar, folder Drive terlalu besar, " +
                "atau ada baris hantu. Lihat detail tahap per tahap di atas.");
  } else {
    Logger.log("Server relatif cepat. Kalau di browser masih lambat, kemungkinan besar: " +
                "(1) deployment belum di-update ke versi terbaru, atau " +
                "(2) koneksi internet pengguna, atau " +
                "(3) file yang diupload masih besar (cek ukuran base64 di console browser).");
  }

  return "Selesai. Buka View > Logs (atau Ctrl+Enter) untuk hasil lengkap.";
}

/**
 * Cek apakah ada "baris hantu" — baris yang punya format/border/apa pun
 * tapi datanya kosong. Ini bikin getLastRow() dan getDataRange() membaca
 * jauh lebih banyak daripada data aslinya, di SEMUA sheet, di SEMUA fungsi.
 *
 * Kejadian umum: dulu pernah copy-paste format ke 5000 baris "buat jaga-jaga",
 * padahal data cuma 40 baris. Sheet-nya "mengira" dia punya 5000 baris.
 */
function cekBarisHantu() {
  const ss = getDB();
  const laporan = [];

  ss.getSheets().forEach(sheet => {
    const nama = sheet.getName();
    if (nama.indexOf("_") === 0) return; // lewati tab laporan (_REPAIR_REPORT dll)

    const lastRow = sheet.getLastRow();
    const maxRow = sheet.getMaxRows();
    const lastCol = sheet.getLastColumn();
    const maxCol = sheet.getMaxColumns();

    const selisihRow = maxRow - lastRow;
    const selisihCol = maxCol - lastCol;

    if (selisihRow > 200 || selisihCol > 10) {
      laporan.push(
        `${nama}: data sampai baris ${lastRow}/kolom ${lastCol}, ` +
        `tapi kapasitas ${maxRow} baris/${maxCol} kolom ` +
        `(${selisihRow} baris & ${selisihCol} kolom kosong berlebih)`
      );
    }
  });

  const msg = laporan.length
    ? "Ditemukan baris/kolom hantu:\n" + laporan.join("\n") +
      "\n\nJalankan bersihkanBarisKosong() untuk memperbaiki."
    : "Tidak ada baris hantu berarti. Sheet-sheet lo bersih.";

  Logger.log(msg);
  return msg;
}

//**
// * Potong kapasitas sheet supaya pas dengan data aslinya.
// * AMAN — tidak menghapus data, cuma memangkas baris/kolom KOSONG
// * yang ada di luar jangkauan data.
// *
// * Jalankan ini kalau cekBarisHantu() melaporkan masalah.
// */
function bersihkanBarisKosong() {
  const ss = getDB();
  const hasil = [];

  ss.getSheets().forEach(sheet => {
    const nama = sheet.getName();
    if (nama.indexOf("_") === 0) return;

    const lastRow = Math.max(sheet.getLastRow(), 1);
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const maxRow = sheet.getMaxRows();
    const maxCol = sheet.getMaxColumns();

    let dipotong = false;

    // Sisakan buffer 100 baris & 5 kolom, jangan pas-pasan banget
    if (maxRow > lastRow + 100) {
      sheet.deleteRows(lastRow + 101, maxRow - lastRow - 100);
      dipotong = true;
    }
    if (maxCol > lastCol + 5) {
      sheet.deleteColumns(lastCol + 6, maxCol - lastCol - 5);
      dipotong = true;
    }

    if (dipotong) hasil.push(nama);
  });

  const msg = hasil.length
    ? `Dipangkas: ${hasil.join(", ")}.`
    : "Tidak ada yang perlu dipangkas.";
  Logger.log(msg);
  return msg;
}
