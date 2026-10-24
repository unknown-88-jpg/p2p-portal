// =========================================================================
// FILE: API_Master.gs
//
// PERUBAHAN PENTING:
// Brand, Departemen, dan PIC sekarang di-derive dari Master_User_TTD,
// BUKAN dari Master_Setting.
//
// Alasannya: dua sumber kebenaran untuk hal yang sama pasti akan berbeda.
// Kasus nyata — HCCA ada di Master_User_TTD tapi tidak ada di Master_Setting,
// jadi tidak pernah muncul di dropdown pengajuan.
//
// Sekarang:
//   Master_User_TTD  → siapa orangnya (brand, divisi, PIC, struktur TTD)
//   Master_Setting   → entitas saja (Company ↔ Brand ↔ Prefix P.O)
//
// Konsekuensi logis: kalau tidak ada orang Level 1 di suatu brand+divisi,
// memang tidak ada yang bisa mengajukan dari sana. Itu benar, bukan bug.
// =========================================================================

function cacheGet(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function cachePut(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds || 600);
  } catch (e) { /* payload > 100KB, lewati cache */ }
}

function clearMasterCache() {
  CacheService.getScriptCache().removeAll([
    "MASTER_COA", "MASTER_PPH", "MASTER_ORG", "MASTER_ENTITAS", "MASTER_KAS"
  ]);
  return { success: true, message: "Cache master dibersihkan." };
}

// -------------------------------------------------------------------------
// STRUKTUR ORGANISASI — dibangun dari Master_User_TTD
//
// Bentuk hasilnya:
// {
//   brands: ["HEYLOCAL", "HEYMALE"],
//   tree: {
//     HEYLOCAL: {
//       BRAND: { pics: ["Cindy"], levels: { 1: [...], 2: [...] } },
//       HCCA:  { pics: ["Rina"],  levels: { 1: [...] } }
//     }
//   },
//   brandCompanyMap: { HEYLOCAL: "PT Hemas Esensi Kirana" }
// }
// -------------------------------------------------------------------------
function getOrgStructure() {
  const cached = cacheGet("MASTER_ORG");
  if (cached) return cached;

  const sheet = getDB().getSheetByName(CONFIG.TAB.USER_TTD);
  if (!sheet || sheet.getLastRow() < 2) {
    return { brands: [], tree: {}, brandCompanyMap: {} };
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const entitas = getEntitasMap();
  const tree = {};

  data.forEach(r => {
    const nama = str(r[COL_USER.NAMA - 1]);
    if (!nama || nama === "-") return;

    const aktif = upper(r[COL_USER.AKTIF - 1]);
    if (aktif === "NO" || aktif === "TIDAK" || aktif === "NONAKTIF") return;

    const brand = upper(r[COL_USER.BRAND - 1]);
    const dept  = upper(r[COL_USER.DEPT - 1]);
    const level = parseInt(r[COL_USER.LEVEL - 1], 10) || 99;
    if (!brand || !dept) return;

    // Baris ALL (Finance, CFO) tidak membentuk brand/divisi baru —
    // mereka menempel ke semua brand yang sudah ada.
    if (brand === "ALL" || dept === "ALL") return;

    if (!tree[brand]) tree[brand] = {};
    if (!tree[brand][dept]) tree[brand][dept] = { pics: [], levels: {} };

    const node = tree[brand][dept];
    if (!node.levels[level]) node.levels[level] = [];
    node.levels[level].push({
      nama: nama,
      jabatan: str(r[COL_USER.JABATAN - 1]) || "Staff",
      email: str(r[COL_USER.EMAIL - 1])
    });

    // PIC pengaju = Level 1
    if (level === LEVEL.PIC && node.pics.indexOf(nama) === -1) {
      node.pics.push(nama);
    }
  });

  const brands = Object.keys(tree).sort();
  brands.forEach(b => Object.keys(tree[b]).forEach(d => tree[b][d].pics.sort()));

  const result = { brands: brands, tree: tree, brandCompanyMap: entitas.brandCompanyMap };
  cachePut("MASTER_ORG", result);
  return result;
}

/**
 * Dipanggil frontend saat form load. Cuma daftar brand.
 * Departemen & PIC diambil belakangan lewat cascade.
 */
function getBrandOptions() {
  const org = getOrgStructure();
  return {
    brands: org.brands.map(b => ({
      brand: b,
      company: org.brandCompanyMap[b] || ""
    }))
  };
}

/**
 * Cascade: brand → daftar divisi yang benar-benar punya orang.
 */
function getDeptOptions(brand) {
  const org = getOrgStructure();
  const b = upper(brand);
  return org.tree[b] ? Object.keys(org.tree[b]).sort() : [];
}

/**
 * Cascade: brand + divisi → daftar PIC (Level 1).
 * Sekalian kirim peringatan kalau divisi belum punya manager, supaya user
 * tahu lebih awal kalau dokumennya bakal nyangkut.
 */
function getPicOptions(brand, dept) {
  const org = getOrgStructure();
  const b = upper(brand), d = upper(dept);
  const node = org.tree[b] && org.tree[b][d];

  if (!node) {
    return { pics: [], adaManager: false, peringatan: "Divisi tidak ditemukan." };
  }

  const lvl2 = node.levels[LEVEL.MANAGER] || [];
  const adaManager = lvl2.length > 0;

  let peringatan = "";
  if (!node.pics.length) {
    peringatan = `Divisi ${d} belum punya PIC pengaju (Level 1) di Master_User_TTD.`;
  } else if (!adaManager) {
    peringatan = `Divisi ${d} belum punya Manager (Level 2). Pengajuan akan tertahan ` +
                 `di antrean approval sampai manager didaftarkan.`;
  }

  return {
    pics: node.pics,
    adaManager: adaManager,
    manager: adaManager ? lvl2[0].nama : "",
    peringatan: peringatan
  };
}

// -------------------------------------------------------------------------
// ENTITAS — Master_Setting sekarang cuma Company ↔ Brand ↔ Prefix.
// Kolom Departement & PIC di tab itu sudah TIDAK dibaca lagi.
// -------------------------------------------------------------------------
function getEntitasMap() {
  const cached = cacheGet("MASTER_ENTITAS");
  if (cached) return cached;

  const sheet = getDB().getSheetByName(CONFIG.TAB.SETTING);
  const brandCompanyMap = {}, prefixMap = {};

  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues().forEach(r => {
      const company = str(r[0]);
      const brand   = upper(r[1]);
      const prefix  = upper(r[4]);     // kolom E — kolom C & D diabaikan
      if (!brand) return;
      if (company) brandCompanyMap[brand] = company;
      if (prefix)  prefixMap[prefix] = { brand: brand, company: company };
    });
  }

  const result = { brandCompanyMap, prefixMap };
  cachePut("MASTER_ENTITAS", result);
  return result;
}

// -------------------------------------------------------------------------
// COA
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// AKUN KAS / BANK — diambil dari Master_COA, bukan daftar hardcoded.
//
// Struktur COA kas:
//   ASET > ASET LANCAR > KAS DAN SETARA KAS > BANK/KAS KECIL > <detail>
//                              ^ Level 3 penanda            ^ Level 5 = akun eksekusi
//
// Sumber rekening = semua Level 5 yang Level 3-nya "KAS DAN SETARA KAS".
// -------------------------------------------------------------------------
function getKasAccounts() {
  const cached = cacheGet("MASTER_KAS");
  if (cached) return cached;

  const coa = getMasterCoaData();
  const penanda = upper(CONFIG.KAS_L3);   // "KAS DAN SETARA KAS"
  const list = [];
  const seen = {};

  coa.forEach(c => {
    if (upper(c[2]) !== penanda) return;      // Level 3 harus kategori kas

    // Akun eksekusi = level terdalam yang bukan "-"
    let akun = c[2];
    if (c[3] !== "-") akun = c[3];
    if (c[4] !== "-") akun = c[4];
    if (akun === "-" || seen[akun]) return;
    seen[akun] = true;

    list.push({
      akun: akun,                 // dipakai sebagai nilai tersimpan & kredit jurnal
      grup: c[3] !== "-" ? c[3] : "",  // Level 4: BANK / KAS KECIL
      lvl1: c[0], lvl2: c[1], lvl3: c[2], lvl4: c[3], lvl5: c[4]
    });
  });

  cachePut("MASTER_KAS", list);
  return list;
}

function getMasterCoaData() {
  const cached = cacheGet("MASTER_COA");
  if (cached) return cached;

  const sheet = getDB().getSheetByName(CONFIG.TAB.COA);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const list = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues()
    .filter(r => str(r[0]))
    .map(r => [str(r[0]), str(r[1]) || "-", str(r[2]) || "-", str(r[3]) || "-", str(r[4]) || "-"]);

  cachePut("MASTER_COA", list);
  return list;
}

// -------------------------------------------------------------------------
// PPh
// -------------------------------------------------------------------------
function getPphRates() {
  const cached = cacheGet("MASTER_PPH");
  if (cached) return cached;

  const sheet = getDB().getSheetByName(CONFIG.TAB.PPH);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rates = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues()
    .filter(r => str(r[0]))
    .map(r => ({ jenis: str(r[0]), tarifNPWP: num(r[1]), tarifNon: num(r[2]) }));

  cachePut("MASTER_PPH", rates);
  return rates;
}

// -------------------------------------------------------------------------
// VENDOR
// -------------------------------------------------------------------------
function getVendorList(tipePengajuan) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const tipe = str(tipePengajuan).toLowerCase();

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues()
    .filter(r => str(r[2]).toLowerCase() === tipe)
    .filter(r => upper(r[7]) === "APPROVED")
    .map(r => ({
      kode: str(r[0]),
      namaAsli: str(r[1]),
      namaLengkap: `[${str(r[0])}] ${str(r[1])}`,
      npwp: clean(r[3]),
      bank: str(r[4]),
      namaRekening: str(r[5]),
      noRekening: clean(r[6])
    }));
}

function getVendorByCode(kode) {
  const sheet = getDB().getSheetByName(CONFIG.TAB.VENDOR);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const target = upper(kode);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();

  for (const r of data) {
    if (upper(r[0]) === target) {
      return {
        kode: str(r[0]), nama: str(r[1]), tipe: str(r[2]),
        npwp: clean(r[3]), bank: str(r[4]),
        namaRekening: str(r[5]), noRekening: clean(r[6]), status: str(r[7])
      };
    }
  }
  return null;
}

// =========================================================================
// VALIDASI STRUKTUR ORGANISASI
// Jalankan dari editor Apps Script. Ini yang menangkap masalah seperti HCCA
// SEBELUM ada orang yang terlanjur mengajukan.
// =========================================================================
function validateStruktur() {
  const org = getOrgStructure();
  const entitas = getEntitasMap();
  const sheet = getDB().getSheetByName(CONFIG.TAB.USER_TTD);

  const temuan = [];
  const add = (lvl, lokasi, masalah, saran) => temuan.push([lvl, lokasi, masalah, saran]);

  // --- Per brand & divisi ---
  org.brands.forEach(b => {
    if (!entitas.brandCompanyMap[b]) {
      add("KRITIS", b,
        `Brand "${b}" ada di Master_User_TTD tapi TIDAK ADA di Master_Setting`,
        "Tambahkan baris Company + Brand + Prefix di Master_Setting. Tanpa ini, kolom Company tidak akan terisi otomatis saat pengajuan");
    }

    Object.keys(org.tree[b]).forEach(d => {
      const node = org.tree[b][d];
      const lokasi = `${b} · ${d}`;

      if (!node.levels[LEVEL.PIC] || !node.levels[LEVEL.PIC].length) {
        add("TINGGI", lokasi,
          "Tidak ada PIC pengaju (Level 1)",
          "Divisi ini tidak akan muncul sebagai opsi pengajuan. Tambahkan orang Level 1, atau abaikan kalau divisi ini memang tidak pernah mengajukan");
      }
      if (!node.levels[LEVEL.MANAGER] || !node.levels[LEVEL.MANAGER].length) {
        add("KRITIS", lokasi,
          "Tidak ada Manager (Level 2)",
          "Dokumen dari divisi ini akan TERTAHAN PERMANEN di antrean approval. Wajib tambahkan orang Level 2");
      }
    });
  });

  // --- Brand yang ada di Setting tapi tidak punya orang ---
  Object.keys(entitas.brandCompanyMap).forEach(b => {
    if (!org.tree[b]) {
      add("SEDANG", b,
        `Brand "${b}" ada di Master_Setting tapi tidak punya orang di Master_User_TTD`,
        "Brand ini tidak akan muncul di dropdown. Hapus dari Master_Setting, atau daftarkan orangnya");
    }
    const punyaPrefix = Object.keys(entitas.prefixMap)
      .some(p => entitas.prefixMap[p].brand === b);
    if (!punyaPrefix) {
      add("SEDANG", b, "Brand tidak punya Prefix P.O di Master_Setting",
        "Pengajuan Trade dari brand ini tidak akan bisa mendeteksi brand dari nomor P.O");
    }
  });

  // --- Level global (Finance & CFO) + validasi email ---
  const data = sheet && sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues() : [];

  const punyaLevel = {};

  data.forEach((r, i) => {
    const nama = str(r[COL_USER.NAMA - 1]);
    if (!nama || nama === "-") return;
    const aktif = upper(r[COL_USER.AKTIF - 1]);
    if (aktif === "NO" || aktif === "TIDAK") return;

    punyaLevel[parseInt(r[COL_USER.LEVEL - 1], 10)] = true;

    const email = str(r[COL_USER.EMAIL - 1]);
    if (!email || email.indexOf("@") === -1 || email.indexOf("domain.com") !== -1) {
      add("KRITIS", `Baris ${i + 2}`,
        `Email tidak valid untuk "${nama}" — "${email || "kosong"}"`,
        "Tanpa email Google yang benar, orang ini tidak akan bisa masuk sama sekali");
    }
  });

  if (!punyaLevel[LEVEL.FINANCE_STAFF]) {
    add("KRITIS", "GLOBAL", "Tidak ada Staff Finance (Level 3)",
      "Tidak ada yang bisa verifikasi pajak & posting jurnal. Tambahkan baris Brand=ALL, Dept=ALL, Level=3");
  }
  if (!punyaLevel[LEVEL.FINANCE_MGR]) {
    add("KRITIS", "GLOBAL", "Tidak ada Manager Finance (Level 4)",
      "Tidak ada dokumen yang bisa dibayar sama sekali. Tambahkan baris Brand=ALL, Dept=ALL, Level=4");
  }
  if (!punyaLevel[LEVEL.CFO]) {
    add("TINGGI", "GLOBAL", "Tidak ada CFO (Level 5)",
      `Transaksi ≥ Rp ${CONFIG.CFO_THRESHOLD.toLocaleString("id-ID")} akan tertahan permanen`);
  }

  // --- Tulis laporan ---
  const ss = getDB();
  const TAB = "_STRUKTUR_REPORT";
  let rep = ss.getSheetByName(TAB);
  if (rep) ss.deleteSheet(rep);
  rep = ss.insertSheet(TAB, 0);

  rep.getRange(1, 1, 1, 4)
    .setValues([["LEVEL", "LOKASI", "MASALAH", "SARAN"]])
    .setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1B1F24");

  const urut = { KRITIS: 0, TINGGI: 1, SEDANG: 2 };
  temuan.sort((a, b) => (urut[a[0]] - urut[b[0]]) || a[1].localeCompare(b[1]));

  if (!temuan.length) {
    rep.getRange(2, 1).setValue("Struktur organisasi sehat. Tidak ada temuan.");
  } else {
    rep.getRange(2, 1, temuan.length, 4).setValues(temuan);
    temuan.forEach((t, i) => {
      const w = t[0] === "KRITIS" ? "#FFC7CE" : t[0] === "TINGGI" ? "#FFEB9C" : "#DDEBF7";
      rep.getRange(i + 2, 1).setBackground(w);
    });
  }

  rep.setColumnWidth(1, 70);  rep.setColumnWidth(2, 180);
  rep.setColumnWidth(3, 430); rep.setColumnWidth(4, 470);
  rep.setFrozenRows(1);
  rep.getRange(1, 1, Math.max(temuan.length + 1, 2), 4)
     .setWrap(true).setVerticalAlignment("top");

  const kritis = temuan.filter(t => t[0] === "KRITIS").length;
  const msg = `${temuan.length} temuan (${kritis} KRITIS). Buka tab "${TAB}".`;
  console.log(msg);
  return msg;
}
