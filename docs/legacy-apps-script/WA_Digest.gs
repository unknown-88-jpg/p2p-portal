// =========================================================================
// FILE: WA_Digest.gs
// Notifikasi model DIGEST (Gaya 2). Alih-alih mengirim WA setiap kali ada
// submit (yang membuat approver kebanjiran 10 pesan sekaligus), sistem
// mengumpulkan semua dokumen berstatus SUBMITTED dan mengirim SATU ringkasan
// per manager, beberapa kali sehari via trigger terjadwal.
//
// Tiap baris ringkasan berisi: ID, vendor, nominal, flag CFO, LINK VOUCHER,
// dan kode approve unik (SETUJU/TOLAK <kode>) yang dibalas via WhatsApp.
//
// CARA PASANG TRIGGER (sekali):
//   Editor Apps Script → Triggers (ikon jam) → Add Trigger
//   → function: kirimDigestApproval
//   → event source: Time-driven → Hour timer → tiap jam yang diinginkan
//   (atau beberapa trigger: 09:00, 12:00, 15:00, 17:00)
// =========================================================================

/**
 * Fungsi utama yang dipanggil trigger terjadwal.
 * Mengelompokkan dokumen SUBMITTED per manager berwenang, lalu kirim ringkasan.
 */
function kirimDigestApproval() {
  try {
    if (!CONFIG.WA_ENABLED) { Logger.log("[WA] digest dilewati — WA_ENABLED=false"); return; }

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (!sheet || sheet.getLastRow() < 2) return;

    const lastCol = sheet.getLastColumn();
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

    // Kumpulkan dokumen yang menunggu manager.
    const pending = [];
    rows.forEach(rv => {
      if (str(readCell(rv, COL.STATUS)) !== STATUS.SUBMITTED) return;
      pending.push({
        idTrx:   str(readCell(rv, COL.ID_TRX)),
        brand:   upper(readCell(rv, COL.BRAND)),
        dept:    upper(readCell(rv, COL.DEPARTEMENT)),
        pic:     str(readCell(rv, COL.PIC)),
        vendor:  str(readCell(rv, COL.VENDOR_NAME)),
        nominal: num(readCell(rv, COL.FINAL_AMOUNT)),
        perluCFO: upper(readCell(rv, COL.REQUIRE_CFO)) === "YES"
      });
    });

    if (!pending.length) { Logger.log("[WA] digest: tidak ada dokumen menunggu."); return; }

    // Petakan tiap dokumen ke manager-manager yang berwenang, kelompokkan per
    // nomor WA manager.
    const perManager = {};   // nomor -> { nama, email, items:[] }

    pending.forEach(doc => {
      const mgrs = cariManagerLengkap_(doc.brand, doc.dept); // {nama,email,nomor}[]
      mgrs.forEach(m => {
        if (!m.nomor) return;
        if (!perManager[m.nomor]) perManager[m.nomor] = { nama: m.nama, email: m.email, items: [] };
        perManager[m.nomor].items.push(doc);
      });
    });

    const base = urlWebApp_();
    let terkirim = 0;

    Object.keys(perManager).forEach(nomor => {
      const grp = perManager[nomor];
      if (!grp.items.length) return;

      const baris = grp.items.map((doc, idx) => {
        const kode = buatKodeApproval_(doc.idTrx, { email: grp.email, nomor: nomor }, doc.nominal);
        const link = base ? (base + "?page=print&id=" + encodeURIComponent(doc.idTrx)) : "";
        const cfo = doc.perluCFO ? " ⚠️CFO" : "";
        return `${idx + 1}. *${doc.idTrx}* · ${doc.vendor}\n` +
               `   ${rpWA_(doc.nominal)}${cfo} · PIC ${doc.pic}\n` +
               (link ? `   📄 ${link}\n` : "") +
               `   Balas *SETUJU ${kode}* / *TOLAK ${kode} <alasan>*`;
      }).join("\n\n");

      const otpNote = grp.items.some(d => d.nominal >= CONFIG.WA_OTP_THRESHOLD)
        ? `\n\n_Dokumen bertanda ⚠️CFO (≥ ${rpWA_(CONFIG.WA_OTP_THRESHOLD)}) minta OTP email saat disetujui._`
        : "";

      const pesan =
        `📋 *Ringkasan Approval*\n` +
        `Halo ${grp.nama || "Manager"}, ada *${grp.items.length}* pengajuan menunggu persetujuan Anda:\n\n` +
        baris +
        otpNote +
        `\n\n_Balas kode di atas untuk memproses. Atau buka portal untuk approve manual._`;

      const res = kirimWA_(nomor, pesan);
      if (res.ok) terkirim++;
    });

    Logger.log(`[WA] digest terkirim ke ${terkirim} manager (${pending.length} dokumen menunggu).`);
  } catch (err) {
    Logger.log("[WA] kirimDigestApproval error: " + err.message);
  }
}

/**
 * Seperti cariNomorManager_ tapi mengembalikan email juga (diperlukan untuk
 * kode approval & OTP). {nama, email, nomor}[]
 */
function cariManagerLengkap_(brand, dept) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.USER_TTD);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lastCol = Math.max(sheet.getLastColumn(), COL_USER.NO_HP);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

  const b = upper(brand), d = upper(dept);
  const out = [], seen = {};
  data.forEach(r => {
    if (parseInt(r[COL_USER.LEVEL - 1], 10) !== LEVEL.MANAGER) return;
    const aktif = upper(r[COL_USER.AKTIF - 1]).replace(/[\s\u00A0]/g, "");
    if (aktif === "NO" || aktif === "TIDAK" || aktif === "NONAKTIF") return;
    const rBrand = upper(r[COL_USER.BRAND - 1]);
    const rDept  = upper(r[COL_USER.DEPT - 1]);
    if (!((rBrand === b || rBrand === "ALL") && (rDept === d || rDept === "ALL"))) return;
    const nomor = normalisasiNomorWA_(r[COL_USER.NO_HP - 1]);
    const email = str(r[COL_USER.EMAIL - 1]);
    const kunci = nomor || email;
    if (!kunci || seen[kunci]) return;
    seen[kunci] = true;
    out.push({ nama: str(r[COL_USER.NAMA - 1]), email: email, nomor: nomor });
  });
  return out;
}

/**
 * RUNNER GABUNGAN untuk trigger terjadwal.
 * Pasang trigger time-driven ke fungsi INI (bukan ke masing-masing), supaya
 * satu jadwal mengirim digest manager DAN finance sekaligus.
 */
function kirimSemuaDigest() {
  kirimDigestManager();
  kirimDigestFinance();
}

// Alias supaya nama konsisten. kirimDigestApproval = digest untuk manager.
function kirimDigestManager() {
  return kirimDigestApproval();
}

/**
 * Uji digest tanpa menunggu trigger — jalankan manual dari editor.
 */
function tesDigestSekarang() {
  kirimDigestManager();
  kirimDigestFinance();
  return "Digest manager + finance dijalankan. Cek Logs & WhatsApp.";
}

// =========================================================================
// DIGEST FINANCE — ringkasan gabungan semua tahap yang menunggu tim Finance.
//
// Berbeda dari digest manager: finance TIDAK approve via WA. Isi pesan murni
// "ada X kerjaan di tiap tahap, buka dashboard" — mengarahkan ke dashboard,
// bukan meminta balasan kode. Semua tahap digabung dalam SATU pesan.
//
// Tahap finance (dari status dokumen):
//   MANAGER_APPROVED → perlu verifikasi pajak
//   TAX_VERIFIED     → perlu TTD basah
//   WET_SIGNED       → perlu posting jurnal COA
//   COA_POSTED / PARTIALLY_PAID → siap dibayar (treasury)
// =========================================================================
function kirimDigestFinance() {
  try {
    if (!CONFIG.WA_ENABLED) { Logger.log("[WA] digest finance dilewati — WA_ENABLED=false"); return; }

    const sheet = getDB().getSheetByName(CONFIG.TAB.PENGAJUAN);
    if (!sheet || sheet.getLastRow() < 2) return;

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

    // Hitung jumlah dokumen per tahap.
    let nPajak = 0, nTtd = 0, nCoa = 0, nBayar = 0;
    rows.forEach(rv => {
      const st = str(readCell(rv, COL.STATUS));
      if (st === STATUS.MANAGER_APPROVED) nPajak++;
      else if (st === STATUS.TAX_VERIFIED) nTtd++;
      else if (st === STATUS.WET_SIGNED) nCoa++;
      else if (st === STATUS.COA_POSTED || st === STATUS.PARTIALLY_PAID) nBayar++;
    });

    const total = nPajak + nTtd + nCoa + nBayar;
    if (!total) { Logger.log("[WA] digest finance: tidak ada kerjaan finance."); return; }

    // Penerima: semua staff Finance (level 3) & manager Finance (level 4) yang
    // aktif dan punya nomor. Finance umumnya ber-scope ALL, jadi tidak difilter
    // per brand/dept — mereka menangani semua.
    const penerima = cariFinanceLengkap_();
    if (!penerima.length) { Logger.log("[WA] digest finance: tidak ada nomor finance."); return; }

    const base = urlWebApp_();
    const linkFinance = base ? (base + "?page=finance") : "";

    // Susun baris hanya untuk tahap yang ada isinya.
    const baris = [];
    if (nPajak) baris.push(`• *${nPajak}* dokumen perlu *verifikasi pajak*`);
    if (nTtd)   baris.push(`• *${nTtd}* dokumen perlu *TTD basah*`);
    if (nCoa)   baris.push(`• *${nCoa}* dokumen perlu *jurnal COA*`);
    if (nBayar) baris.push(`• *${nBayar}* dokumen *siap dibayar* (treasury)`);

    let terkirim = 0;
    penerima.forEach(f => {
      const pesan =
        `🧾 *Ringkasan Finance*\n` +
        `Halo ${f.nama || "Tim Finance"}, ada *${total}* dokumen menunggu diproses:\n\n` +
        baris.join("\n") +
        (linkFinance ? `\n\nBuka dashboard: ${linkFinance}` : "") +
        `\n\n_Pemrosesan dilakukan di dashboard, bukan lewat WhatsApp._`;
      const res = kirimWA_(f.nomor, pesan);
      if (res.ok) terkirim++;
    });

    Logger.log(`[WA] digest finance terkirim ke ${terkirim} orang (${total} dokumen).`);
  } catch (err) {
    Logger.log("[WA] kirimDigestFinance error: " + err.message);
  }
}

/**
 * Daftar penerima notif finance: level 3 & 4 yang aktif & punya nomor.
 * {nama, email, nomor}[] — unik per nomor.
 */
function cariFinanceLengkap_() {
  const sheet = getDB().getSheetByName(CONFIG.TAB.USER_TTD);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lastCol = Math.max(sheet.getLastColumn(), COL_USER.NO_HP);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

  const out = [], seen = {};
  data.forEach(r => {
    const lvl = parseInt(r[COL_USER.LEVEL - 1], 10);
    if (lvl !== LEVEL.FINANCE_STAFF && lvl !== LEVEL.FINANCE_MGR) return;
    const aktif = upper(r[COL_USER.AKTIF - 1]).replace(/[\s\u00A0]/g, "");
    if (aktif === "NO" || aktif === "TIDAK" || aktif === "NONAKTIF") return;
    const nomor = normalisasiNomorWA_(r[COL_USER.NO_HP - 1]);
    if (!nomor || seen[nomor]) return;
    seen[nomor] = true;
    out.push({ nama: str(r[COL_USER.NAMA - 1]), email: str(r[COL_USER.EMAIL - 1]), nomor: nomor });
  });
  return out;
}
