// =========================================================================
// FILE: CRUD_Vendor.gs
// =========================================================================

function generateVendorID_() {
  const props = PropertiesService.getScriptProperties();
  let seq = parseInt(props.getProperty("SEQ_VND"), 10);

  if (isNaN(seq)) {
    const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
    seq = 0;
    if (sheet.getLastRow() > 1) {
      const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
      ids.forEach(r => {
        const m = str(r[0]).match(/^VND-(\d+)$/);
        if (m) seq = Math.max(seq, parseInt(m[1], 10));
      });
    }
  }
  seq += 1;
  props.setProperty("SEQ_VND", String(seq));
  return "VND-" + ("0000" + seq).slice(-4);
}

function submitNewVendor(formData) {
  return withLock(function () {
    const nama    = upper(formData.namaVendor);
    const bank    = upper(formData.bank);
    const noRek   = clean(formData.noRekening);
    const namaRek = upper(formData.namaRekening);
    const tipe    = str(formData.tipeVendor);
    const npwp    = clean(formData.npwp);

    if (!nama)    throw new Error("Nama vendor wajib diisi.");
    if (!tipe)    throw new Error("Tipe vendor wajib dipilih.");
    if (!bank)    throw new Error("Nama bank wajib diisi.");
    if (!namaRek) throw new Error("Nama pemilik rekening wajib diisi.");
    if (!noRek)   throw new Error("Nomor rekening wajib diisi.");
    if (!/^\d{6,20}$/.test(noRek)) throw new Error("Nomor rekening harus 6–20 digit angka.");

    const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
    const data = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues()
      : [];

    // Duplikat rekening = risiko fraud. Cek nomor rekening saja, tanpa peduli namanya.
    for (const r of data) {
      if (clean(r[6]) === noRek && upper(r[4]) === bank) {
        throw new Error(
          `Rekening ${bank} ${noRek} sudah terdaftar atas nama "${str(r[1])}" (${str(r[0])}). ` +
          `Kalau ini vendor yang sama, pakai data yang sudah ada.`
        );
      }
    }

    const kode = generateVendorID_();
    sheet.appendRow([
      kode, nama, tipe,
      npwp ? "'" + npwp : "",
      bank, namaRek, "'" + noRek,
      "Pending",
      getCurrentEmail(),
      new Date()
    ]);

    writeAudit("-", "VENDOR_CREATE", "Vendor", "", kode + " " + nama, bank + " " + noRek);

    return {
      success: true,
      message: `Vendor terdaftar dengan kode ${kode}. Menunggu pengesahan Finance sebelum bisa dipakai.`
    };
  });
}

function getPendingVendors() {
  const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
  if (sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
  const result = [];

  data.forEach((r, i) => {
    if (upper(r[7]) !== "PENDING") return;
    result.push({
      rowIdx: i + 2,
      kode: str(r[0]),
      nama: str(r[1]),
      tipe: str(r[2]),
      npwp: clean(r[3]) || "-",
      bank: str(r[4]),
      namaRekening: str(r[5]),
      noRekening: clean(r[6]),
      didaftarkanOleh: str(r[8]) || "-"
    });
  });
  return result;
}

function approveVendor(rowIdx) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);

    const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
    const row = parseInt(rowIdx, 10);
    const kode = str(sheet.getRange(row, 1).getValue());
    const nama = str(sheet.getRange(row, 2).getValue());

    // Maker-checker: yang mendaftarkan tidak boleh mengesahkan sendiri
    const pendaftar = str(sheet.getRange(row, 9).getValue()).toLowerCase();
    if (pendaftar && pendaftar === getCurrentEmail().toLowerCase()) {
      throw new Error("Anda yang mendaftarkan vendor ini. Pengesahan harus oleh orang lain (prinsip maker-checker).");
    }

    sheet.getRange(row, 8).setValue("Approved");
    writeAudit("-", "VENDOR_APPROVE", "Status", "Pending", "Approved", kode + " " + nama);

    return { success: true, message: `Vendor ${nama} (${kode}) disahkan.` };
  });
}

function rejectVendor(rowIdx, alasan) {
  return withLock(function () {
    requireLevel(LEVEL.FINANCE_STAFF);
    if (!str(alasan)) throw new Error("Alasan penolakan wajib diisi.");

    const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
    const row = parseInt(rowIdx, 10);
    const kode = str(sheet.getRange(row, 1).getValue());

    sheet.getRange(row, 8).setValue("Rejected");
    writeAudit("-", "VENDOR_REJECT", "Status", "Pending", "Rejected", kode + " — " + alasan);

    return { success: true, message: `Vendor ${kode} ditolak.` };
  });
}
