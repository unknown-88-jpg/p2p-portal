// =========================================================================
// FILE: Repair.gs
// Perbaikan data lama. Jalankan dari editor Apps Script.
//
// URUTAN WAJIB:
//   1. BACKUP spreadsheet (File > Make a copy). Serius.
//   2. auditDataIntegrity()   → cuma BACA. Bikin tab "_REPAIR_REPORT".
//   3. Baca laporannya sampai paham.
//   4. repairNoRekening()     → perbaiki nomor rekening (bisa di-undo? TIDAK)
//   5. reconcilePayments()    → sinkronkan ringkasan pembayaran dari log
//
// Fungsi audit AMAN dijalankan kapan saja. Fungsi repair MENULIS.
// =========================================================================

const REPORT_TAB = "_REPAIR_REPORT";

// =========================================================================
// LANGKAH 1 — AUDIT (READ ONLY)
// =========================================================================
function auditDataIntegrity() {
  const ss = getDB();
  const out = [];

  const add = (kat, level, id, masalah, saran) =>
    out.push([kat, level, id, masalah, saran]);

  // ---------------------------------------------------------------
  // A. Nomor rekening kehilangan nol di depan
  // ---------------------------------------------------------------
  const vendorMap = buildVendorMap_();
  const trx = ss.getSheetByName(CONFIG.TAB.PENGAJUAN);
  const trxData = trx.getLastRow() > 1
    ? trx.getRange(2, 1, trx.getLastRow() - 1, COL_COUNT).getValues() : [];

  trxData.forEach((r, i) => {
    const id = str(r[COL.ID_TRX - 1]);
    if (!id) return;

    const rekTrx = clean(r[COL.NO_REKENING - 1]);
    const namaVendor = upper(r[COL.VENDOR_NAME - 1]);
    const v = vendorMap.byName[namaVendor];

    if (!v) {
      add("VENDOR", "TINGGI", id,
        `Vendor "${namaVendor}" tidak ada di Master_Vendor`,
        "Daftarkan vendornya, atau perbaiki nama di baris ini");
      return;
    }

    if (rekTrx !== v.noRekening) {
      const nolHilang = v.noRekening.startsWith("0") && !rekTrx.startsWith("0")
                        && v.noRekening.replace(/^0+/, "") === rekTrx;
      add("REKENING", nolHilang ? "KRITIS" : "TINGGI", id,
        `Rekening di pengajuan "${rekTrx}" ≠ Master_Vendor "${v.noRekening}"` +
        (nolHilang ? " — NOL DI DEPAN HILANG" : ""),
        "Jalankan repairNoRekening()");
    }
  });

  // ---------------------------------------------------------------
  // B. Pembayaran: overpaid & ringkasan tidak sinkron
  // ---------------------------------------------------------------
  const paidMap = buildPaidMap_();

  trxData.forEach(r => {
    const id = str(r[COL.ID_TRX - 1]);
    if (!id) return;

    const final   = num(r[COL.FINAL_AMOUNT - 1]);
    const kolPaid = num(r[COL.TOTAL_PAID - 1]);
    const kolOS   = num(r[COL.OS_BALANCE - 1]);
    const logPaid = paidMap[id] || 0;

    if (logPaid === 0 && kolPaid === 0) return;

    if (logPaid > final + CONFIG.PAYMENT_TOLERANCE) {
      add("PEMBAYARAN", "KRITIS", id,
        `KELEBIHAN BAYAR Rp ${(logPaid - final).toLocaleString("id-ID")}. ` +
        `Netto Rp ${final.toLocaleString("id-ID")}, dibayar Rp ${logPaid.toLocaleString("id-ID")}`,
        "Cek fisik ke bank. Tagih balik ke vendor / jadikan uang muka invoice berikutnya");
    }

    if (Math.abs(logPaid - kolPaid) > CONFIG.PAYMENT_TOLERANCE) {
      add("PEMBAYARAN", "TINGGI", id,
        `Ringkasan tidak sinkron. Kolom TOTAL_PAID = Rp ${kolPaid.toLocaleString("id-ID")}, ` +
        `payment log = Rp ${logPaid.toLocaleString("id-ID")}`,
        "Jalankan reconcilePayments()");
    }

    const osSeharusnya = final - logPaid;
    if (Math.abs(kolOS - osSeharusnya) > CONFIG.PAYMENT_TOLERANCE) {
      add("PEMBAYARAN", "SEDANG", id,
        `OS_BALANCE = Rp ${kolOS.toLocaleString("id-ID")}, seharusnya Rp ${osSeharusnya.toLocaleString("id-ID")}`,
        "Jalankan reconcilePayments()");
    }
  });

  // Payment log yang ID transaksinya tidak ada
  const payLog = ss.getSheetByName(CONFIG.TAB.PAYMENT_LOG);
  if (payLog && payLog.getLastRow() > 1) {
    const idSet = {};
    trxData.forEach(r => { idSet[upper(r[COL.ID_TRX - 1])] = true; });

    payLog.getRange(2, 1, payLog.getLastRow() - 1, 6).getValues().forEach(p => {
      const ref = upper(p[1]);
      if (ref && !idSet[ref]) {
        add("PEMBAYARAN", "TINGGI", str(p[0]),
          `Payment log merujuk ID "${ref}" yang tidak ada di Trx_Pengajuan`,
          "Uang keluar tanpa dokumen. Investigasi manual");
      }
    });
  }

  // ---------------------------------------------------------------
  // C. Format nomor P.O & sambungan DB_PO ↔ DB_SJ
  // ---------------------------------------------------------------
  const prefixes = ss.getSheetByName(CONFIG.TAB.SETTING).getDataRange().getValues()
    .slice(1).map(r => upper(r[4])).filter(Boolean);

  const po = ss.getSheetByName(CONFIG.TAB.PO);
  const poIds = {};
  if (po && po.getLastRow() > 1) {
    po.getRange(2, 1, po.getLastRow() - 1, 1).getValues().forEach(r => {
      const id = upper(r[0]);
      if (!id) return;
      poIds[id] = true;
      const punyaPrefix = prefixes.some(p => id.indexOf(p) !== -1);
      if (!punyaPrefix) {
        add("PURCHASE ORDER", "TINGGI", id,
          "Nomor P.O tidak mengandung prefix brand manapun — brand tidak akan terdeteksi",
          `Ubah jadi format PO-<PREFIX>-<tanggal>-<urut>. Prefix tersedia: ${prefixes.join(", ")}`);
      }
    });
  }

  const sj = ss.getSheetByName(CONFIG.TAB.SJ);
  if (sj && sj.getLastRow() > 1) {
    const yatim = {};
    sj.getRange(2, 1, sj.getLastRow() - 1, 6).getValues().forEach(r => {
      const ref = upper(r[1]);
      if (ref && !poIds[ref]) yatim[ref] = (yatim[ref] || 0) + 1;
    });
    Object.keys(yatim).forEach(ref => {
      add("SURAT JALAN", "KRITIS", ref,
        `${yatim[ref]} baris SJ merujuk P.O "${ref}" yang TIDAK ADA di DB_PO`,
        "Three-way match tidak jalan — qty gudang selalu terbaca 0. Samakan nomor P.O di kedua tab");
    });
  }

  // Pengajuan Trade yang PO-nya tidak ketemu
  trxData.forEach(r => {
    if (str(r[COL.TIPE - 1]) !== "Trade") return;
    const id = str(r[COL.ID_TRX - 1]);
    const poNo = upper(r[COL.PO_NUMBER - 1]);
    if (poNo && poNo !== "-" && !poIds[poNo]) {
      add("PURCHASE ORDER", "TINGGI", id,
        `Pengajuan Trade merujuk P.O "${poNo}" yang tidak ada di DB_PO`,
        "Cek nomor P.O-nya");
    }
  });

  // ---------------------------------------------------------------
  // D. Vendor: rekening kembar
  // ---------------------------------------------------------------
  const byRek = {};
  vendorMap.list.forEach(v => {
    const key = v.bank + "|" + v.noRekening;
    if (!v.noRekening) return;
    (byRek[key] = byRek[key] || []).push(v);
  });
  Object.keys(byRek).forEach(k => {
    const grup = byRek[k];
    if (grup.length < 2) return;
    add("VENDOR", "KRITIS", grup.map(v => v.kode).join(" / "),
      `Rekening ${k.replace("|", " ")} dipakai ${grup.length} vendor: ` +
      grup.map(v => `${v.kode} (${v.nama})`).join(", "),
      "Satu rekening = satu vendor. Gabungkan, atau perbaiki yang salah");
  });

  // Vendor tanpa nomor rekening
  vendorMap.list.forEach(v => {
    if (!v.noRekening) {
      add("VENDOR", "TINGGI", v.kode, `Vendor "${v.nama}" tidak punya nomor rekening`,
        "Lengkapi, atau tandai Rejected");
    }
  });

  // ---------------------------------------------------------------
  // E. Master_User_TTD
  // ---------------------------------------------------------------
  const user = ss.getSheetByName(CONFIG.TAB.USER_TTD);
  if (user && user.getLastRow() > 1) {
    const u = user.getRange(2, 1, user.getLastRow() - 1, 7).getValues();
    let adaLvl4 = false, adaLvl5 = false;

    u.forEach((r, i) => {
      const nama = str(r[COL_USER.NAMA - 1]);
      if (!nama) return;
      const email = str(r[COL_USER.EMAIL - 1]);
      const lvl = parseInt(r[COL_USER.LEVEL - 1], 10);

      if (!email || email.indexOf("@") === -1) {
        add("USER", "KRITIS", `Baris ${i + 2}`,
          `"${nama}" tidak punya email valid — tidak akan bisa login`,
          "Isi kolom F dengan email Google kantor");
      }
      if (email.indexOf("@domain.com") !== -1) {
        add("USER", "KRITIS", `Baris ${i + 2}`,
          `"${nama}" masih pakai email placeholder "${email}"`,
          "Ganti dengan email asli");
      }
      if (lvl === 4) adaLvl4 = true;
      if (lvl === 5) adaLvl5 = true;
    });

    if (!adaLvl4) add("USER", "KRITIS", "-",
      "Tidak ada satupun user Level 4 (Manager Finance)",
      "Tanpa ini, tidak ada dokumen yang bisa dibayar");
    if (!adaLvl5) add("USER", "TINGGI", "-",
      "Tidak ada user Level 5 (CFO)",
      "Transaksi ≥ Rp 5 juta akan tertahan permanen");
  }

  // ---------------------------------------------------------------
  // Tulis laporan
  // ---------------------------------------------------------------
  const urut = { KRITIS: 0, TINGGI: 1, SEDANG: 2 };
  out.sort((a, b) => (urut[a[1]] - urut[b[1]]) || a[0].localeCompare(b[0]));

  let rep = ss.getSheetByName(REPORT_TAB);
  if (rep) ss.deleteSheet(rep);
  rep = ss.insertSheet(REPORT_TAB, 0);

  rep.getRange(1, 1, 1, 5)
    .setValues([["KATEGORI", "LEVEL", "ID / BARIS", "MASALAH", "SARAN PERBAIKAN"]])
    .setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1B1F24");

  if (!out.length) {
    rep.getRange(2, 1).setValue("Tidak ada masalah terdeteksi.");
  } else {
    rep.getRange(2, 1, out.length, 5).setValues(out);
    for (let i = 0; i < out.length; i++) {
      const warna = out[i][1] === "KRITIS" ? "#FFC7CE"
                  : out[i][1] === "TINGGI" ? "#FFEB9C" : "#DDEBF7";
      rep.getRange(i + 2, 2).setBackground(warna);
    }
  }

  rep.setColumnWidth(1, 130); rep.setColumnWidth(2, 70); rep.setColumnWidth(3, 130);
  rep.setColumnWidth(4, 480); rep.setColumnWidth(5, 400);
  rep.setFrozenRows(1);
  rep.getRange(1, 1, Math.max(out.length + 1, 2), 5).setWrap(true).setVerticalAlignment("top");

  const kritis = out.filter(o => o[1] === "KRITIS").length;
  const msg = `Audit selesai. ${out.length} temuan (${kritis} KRITIS). Buka tab "${REPORT_TAB}".`;
  console.log(msg);
  SpreadsheetApp.getActiveSpreadsheet() && SpreadsheetApp.getUi &&
    (function () { try { SpreadsheetApp.getUi().alert(msg); } catch (e) {} })();
  return msg;
}


// =========================================================================
// LANGKAH 2 — PERBAIKI NOMOR REKENING
// Ambil ulang dari Master_Vendor, tulis balik sebagai TEKS.
// =========================================================================
function repairNoRekening() {
  return withLock(function () {
    const ss = getDB();
    const trx = ss.getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (trx.getLastRow() < 2) return { success: true, message: "Tidak ada data." };

    // Paksa kolom rekening & NPWP jadi format teks
    trx.getRange(2, COL.NO_REKENING, trx.getLastRow() - 1, 1).setNumberFormat("@");
    trx.getRange(2, COL.NPWP_VENDOR, trx.getLastRow() - 1, 1).setNumberFormat("@");

    const vendorMap = buildVendorMap_();
    const data = trx.getRange(2, 1, trx.getLastRow() - 1, COL_COUNT).getValues();

    const outRek  = [];
    const outNpwp = [];
    const outBank = [];
    const outNama = [];
    const outKode = [];

    let fixed = 0, skipped = 0;

    data.forEach(r => {
      const id = str(r[COL.ID_TRX - 1]);
      const namaVendor = upper(r[COL.VENDOR_NAME - 1]);
      const v = vendorMap.byName[namaVendor];

      if (!id || !v) {
        // Tidak ketemu di master — biarkan apa adanya, jangan rusak data
        outRek.push([clean(r[COL.NO_REKENING - 1])]);
        outNpwp.push([clean(r[COL.NPWP_VENDOR - 1]) || "-"]);
        outBank.push([str(r[COL.BANK - 1])]);
        outNama.push([str(r[COL.NAMA_REKENING - 1])]);
        outKode.push([str(r[COL.VENDOR_CODE - 1])]);
        if (id) skipped++;
        return;
      }

      const rekLama = clean(r[COL.NO_REKENING - 1]);
      if (rekLama !== v.noRekening) fixed++;

      outRek.push([v.noRekening]);
      outNpwp.push([v.npwp || "-"]);
      outBank.push([v.bank]);
      outNama.push([v.namaRekening]);
      outKode.push([v.kode]);
    });

    const n = data.length;
    trx.getRange(2, COL.NO_REKENING,   n, 1).setValues(outRek);
    trx.getRange(2, COL.NPWP_VENDOR,   n, 1).setValues(outNpwp);
    trx.getRange(2, COL.BANK,          n, 1).setValues(outBank);
    trx.getRange(2, COL.NAMA_REKENING, n, 1).setValues(outNama);
    trx.getRange(2, COL.VENDOR_CODE,   n, 1).setValues(outKode);

    // Master_Vendor juga dipaksa teks, biar tidak rusak lagi ke depan
    const mv = ss.getSheetByName(CONFIG.TAB.VENDOR);
    if (mv.getLastRow() > 1) {
      mv.getRange(2, 4, mv.getLastRow() - 1, 1).setNumberFormat("@"); // NPWP
      mv.getRange(2, 7, mv.getLastRow() - 1, 1).setNumberFormat("@"); // No Rekening
    }

    writeAudit("-", "REPAIR", "No Rekening", "", fixed + " baris", "repairNoRekening()");

    return {
      success: true,
      message: `${fixed} nomor rekening diperbaiki dari Master_Vendor. ` +
               `${skipped} baris dilewati (vendor tidak ada di master — cek laporan audit).`
    };
  });
}


// =========================================================================
// LANGKAH 3 — REKONSILIASI PEMBAYARAN
// Hitung ulang TOTAL_PAID / OS_BALANCE / PAY_STATUS dari Trx_Payment_Log.
// Payment log adalah sumber kebenaran.
// =========================================================================
function reconcilePayments() {
  return withLock(function () {
    const ss = getDB();
    const trx = ss.getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (trx.getLastRow() < 2) return { success: true, message: "Tidak ada data." };

    const paidMap = buildPaidMap_();
    const data = trx.getRange(2, 1, trx.getLastRow() - 1, COL_COUNT).getValues();

    const outPaid = [], outOS = [], outStatus = [];
    let updated = 0;
    const overpaid = [];

    data.forEach(r => {
      const id    = str(r[COL.ID_TRX - 1]);
      const final = num(r[COL.FINAL_AMOUNT - 1]);
      const paid  = paidMap[id] || 0;

      let os = final - paid;
      if (Math.abs(os) <= CONFIG.PAYMENT_TOLERANCE) os = 0;

      let status;
      if (paid === 0)      status = "Outstanding";
      else if (os <= 0)    status = "Paid";
      else                 status = "Partially Paid";

      if (paid > final + CONFIG.PAYMENT_TOLERANCE) {
        overpaid.push(`${id} (lebih Rp ${(paid - final).toLocaleString("id-ID")})`);
        os = 0;
        status = "Paid";   // ditandai lunas; kelebihannya diurus manual
      }

      if (num(r[COL.TOTAL_PAID - 1]) !== paid) updated++;

      outPaid.push([paid]);
      outOS.push([os]);
      outStatus.push([status]);
    });

    const n = data.length;
    trx.getRange(2, COL.TOTAL_PAID, n, 1).setValues(outPaid);
    trx.getRange(2, COL.OS_BALANCE, n, 1).setValues(outOS);
    trx.getRange(2, COL.PAY_STATUS, n, 1).setValues(outStatus);

    writeAudit("-", "REPAIR", "Payment", "", updated + " baris", "reconcilePayments()");

    let msg = `${updated} baris disinkronkan dari payment log.`;
    if (overpaid.length) {
      msg += `\n\n⚠️ KELEBIHAN BAYAR pada ${overpaid.length} dokumen: ${overpaid.join(", ")}. ` +
             `Ini tidak bisa diperbaiki otomatis — cek fisik ke bank dan putuskan: ` +
             `tagih balik ke vendor, atau jadikan uang muka invoice berikutnya.`;
    }
    return { success: true, message: msg };
  });
}


// =========================================================================
// HELPER
// =========================================================================
function buildVendorMap_() {
  const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
  const list = [];
  const byName = {}, byKode = {};

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues().forEach(r => {
      if (!str(r[0])) return;
      const v = {
        kode: str(r[0]),
        nama: str(r[1]),
        tipe: str(r[2]),
        npwp: clean(r[3]),
        bank: upper(r[4]),
        namaRekening: str(r[5]),
        noRekening: clean(r[6]),
        status: str(r[7])
      };
      list.push(v);
      byKode[upper(v.kode)] = v;
      if (!byName[upper(v.nama)]) byName[upper(v.nama)] = v;
    });
  }
  return { list, byName, byKode };
}

function buildPaidMap_() {
  const sheet = getDB().getSheetByName(CONFIG.TAB.PAYMENT_LOG);
  const map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues().forEach(r => {
    const id = upper(r[1]);
    if (!id) return;
    map[id] = (map[id] || 0) + num(r[3]);
  });
  return map;
}


// =========================================================================
// BONUS — normalisasi nomor P.O (JANGAN dijalankan sembarangan)
//
// Ini TIDAK gw jalankan otomatis, karena gw tidak tahu mana yang benar:
// apakah 'PO-28012026-001' seharusnya 'PO-HL-28012026-001' atau brand lain.
// Rapikan manual di DB_PO, lalu pakai fungsi ini untuk CEK ulang.
// =========================================================================
function cekSambunganPOdanSJ() {
  const ss = getDB();
  const po = ss.getSheetByName(CONFIG.TAB.PO);
  const sj = ss.getSheetByName(CONFIG.TAB.SJ);

  const poIds = {};
  if (po.getLastRow() > 1) {
    po.getRange(2, 1, po.getLastRow() - 1, 1).getValues()
      .forEach(r => { if (str(r[0])) poIds[upper(r[0])] = true; });
  }

  const yatim = {};
  let cocok = 0;
  if (sj.getLastRow() > 1) {
    sj.getRange(2, 2, sj.getLastRow() - 1, 1).getValues().forEach(r => {
      const ref = upper(r[0]);
      if (!ref) return;
      if (poIds[ref]) cocok++;
      else yatim[ref] = (yatim[ref] || 0) + 1;
    });
  }

  const daftar = Object.keys(yatim);
  const msg = daftar.length
    ? `${cocok} baris SJ nyambung. ${daftar.length} nomor P.O di SJ TIDAK ADA di DB_PO:\n` +
      daftar.map(k => `  ${k} (${yatim[k]} baris)`).join("\n")
    : `Semua ${cocok} baris SJ nyambung ke DB_PO.`;

  console.log(msg);
  return msg;
}
