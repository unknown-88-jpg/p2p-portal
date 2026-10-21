// Membangkitkan golden vector M3 dengan MENJALANKAN kode lama (Calc.gs / API_PO.gs) apa adanya di Node (vm).
// Golden = keluaran kode lama pada input yang sama, BUKAN ekspor data produksi. Fungsi di bawah disalin verbatim dari export project
// (Calc.gs: hitungPajak, butuhCFO; API_PO.gs: hitungPlafonSJ_ + loop prefix searchPODetails; Utils.gs: num/str/upper/clean).
// Jalankan: node scripts/gen-golden.mjs  (hasil: tests/golden/*.json, deterministik)
import vm from 'node:vm';
import fs from 'node:fs';

const LEGACY = String.raw`
var CONFIG = { PPN_RATE: 0.11, CFO_THRESHOLD: 5000000, PO_RETENSI_PELUNASAN_PCT: 0.10 };
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function str(v) { return (v === null || v === undefined) ? "" : v.toString().trim(); }
function upper(v) { return str(v).toUpperCase(); }
function clean(v) { return str(v).replace(/^'/, ""); }
var __RATES = [];
function getPphRates() { return __RATES; }

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

  let pphRate = 0, pphAmount = 0;
  if (jenisPPh !== "-" && jenisPPh !== "") {
    const rateRow = getPphRates().find(r => r.jenis === jenisPPh);
    if (!rateRow) throw new Error('Jenis PPh "' + jenisPPh + '" tidak ada di Master_PPh.');
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

function butuhCFO(finalAmount) {
  return num(finalAmount) >= CONFIG.CFO_THRESHOLD;
}

function hitungPlafonSJ_(grandTotal, qtyPO, qtySJ) {
  const gt = num(grandTotal);
  const qPO = num(qtyPO);
  const qSJ = num(qtySJ);

  if (gt <= 0) return 0;
  if (qPO <= 0) return gt;

  const retensi = num(CONFIG.PO_RETENSI_PELUNASAN_PCT);
  const plafonBebas = Math.round(gt * (1 - retensi));
  const diterimaPenuh = qSJ >= qPO;

  return diterimaPenuh ? gt : plafonBebas;
}

// loop prefix dari searchPODetails (dibungkus fungsi; isi loop verbatim)
function cocokPrefix(setting, poClean) {
  let matchedBrand = "", matchedCompany = "";
  for (let i = 1; i < setting.length; i++) {
    const prefix = upper(setting[i][4]);
    if (prefix && poClean.indexOf(prefix) !== -1) {
      matchedCompany = str(setting[i][0]);
      matchedBrand   = str(setting[i][1]);
      break;
    }
  }
  return { company: matchedCompany, brand: matchedBrand };
}
`;
const ctx = vm.createContext({});
vm.runInContext(LEGACY, ctx);
const run = (code) => vm.runInContext(code, ctx);

// PRNG deterministik
let seed = 20261012;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const RATES = [
  { jenis: 'PPh 23', tarifNPWP: 0.02, tarifNon: 0.04 },
  { jenis: 'PPh 4(2)', tarifNPWP: 0.1, tarifNon: 0.2 },
  { jenis: 'PPh 21', tarifNPWP: 0.05, tarifNon: 0.06 },
  { jenis: 'PPh 15', tarifNPWP: 0.015, tarifNon: 0.03 },
  { jenis: 'PPh 22', tarifNPWP: 0.0175, tarifNon: 0.035 },
  { jenis: 'PPh 0', tarifNPWP: 0, tarifNon: 0 },
  { jenis: 'PPh 100', tarifNPWP: 1, tarifNon: 1 },
];
run(`__RATES = ${JSON.stringify(RATES)}`);

const AMOUNTS = [0, 1, 2, 3, 9, 10, 99, 100, 101, 500, 999, 1000, 1500, 1111, 12345, 99999, 100000, 111111, 250000, 333333, 1000000, 1234567,
  4999999, 5000000, 5000001, 9999999, 12345678, 25000000, 99999999, 123456789, 1e9, 9876543210,
  0.5, 1.5, 2.5, 0.49, 99.99, 1000.5, 1234567.89, 4545.45, 100.005, '1000', '1.500,50', 'abc', '', null, undefined, '  2500000  ', '1e3', true];
const DISC = [0, 0, 0, 0, 1, 50, 1000, 100000, 0.5, '500', null, undefined, 'x'];
const BIAYA = [0, 0, 0, 1, 500, 25000, 1000000, 0.75, '100', null, undefined];
const PPN = ['Include PPN', 'Exclude PPN', 'Non PPN', 'Non PPN', 'include ppn', ' Include PPN ', '', null, undefined, 'Foo'];
const PPH = ['-', '-', '', null, undefined, 'PPh 23', 'PPh 23', 'PPh 4(2)', 'PPh 21', 'PPh 15', 'PPh 22', 'PPh 0', 'PPh 100', ' PPh 23 ', 'pph 23', 'PPh 99'];
const NPWP = ['', '-', null, undefined, "'01.234.567.8-901.000", '012345678901000', "'", "'-", 'x'];

const clone = (o) => JSON.parse(JSON.stringify(o)); // undefined -> kunci hilang (sama persis dengan yang dibaca test)
const taxCases = [];
const add = (input) => {
  const inp = clone(input);
  let out;
  try { out = { ok: run(`hitungPajak(${JSON.stringify(inp)})`) }; } catch (e) { out = { err: e.message }; }
  taxCases.push({ input: inp, ...out });
};
// 1) grid terarah (semua status PPN x PPh x NPWP pada beberapa nominal)
for (const inv of [1000000, 1234567, 99999, 5000000, 333333.33]) for (const st of ['Include PPN', 'Exclude PPN', 'Non PPN'])
  for (const pph of ['-', 'PPh 23', 'PPh 4(2)', 'PPh 15']) for (const npwp of ['', "'0123456789"]) add({ invAmount: inv, diskon: 0, biayaLain: 0, statusPPN: st, jenisPPh: pph, npwpVendor: npwp });
// 2) acak
for (let i = 0; i < 700; i++) add({ invAmount: pick(AMOUNTS), diskon: pick(DISC), biayaLain: pick(BIAYA), statusPPN: pick(PPN), jenisPPh: pick(PPH), npwpVendor: pick(NPWP) });
// 3) acak angka bulat besar-kecil (jalur normal)
for (let i = 0; i < 400; i++) {
  const inv = Math.floor(rnd() * 10 ** (2 + Math.floor(rnd() * 8))) + Math.floor(rnd() * 100) / 100 * (rnd() < 0.3 ? 1 : 0);
  const dis = rnd() < 0.5 ? 0 : Math.floor(rnd() * inv);
  add({ invAmount: inv, diskon: dis, biayaLain: rnd() < 0.5 ? 0 : Math.floor(rnd() * 100000), statusPPN: pick(['Include PPN', 'Exclude PPN', 'Non PPN']), jenisPPh: pick(['-', 'PPh 23', 'PPh 4(2)', 'PPh 21', 'PPh 15', 'PPh 22']), npwpVendor: pick(['', "'1234"]) });
}
// 4) kasus tepi eksplisit
add({ invAmount: 1000, diskon: 1000, biayaLain: 0, statusPPN: 'Non PPN', jenisPPh: 'PPh 100', npwpVendor: 'x' });   // final = 0 -> boleh
add({ invAmount: 1000, diskon: 1000, biayaLain: 0, statusPPN: 'Exclude PPN', jenisPPh: 'PPh 100', npwpVendor: 'x' }); // final = 110
add({ invAmount: 1000, diskon: 0, biayaLain: 0, statusPPN: 'Non PPN', jenisPPh: 'PPh 100', npwpVendor: 'x' });       // final = 0
add({ invAmount: 1000, diskon: 1001, statusPPN: 'Non PPN' });
add({ invAmount: -1 });
add({ invAmount: 1000, diskon: -1 });
add({ invAmount: 1000, biayaLain: -1 });
add({});
// 5) pemburu batas pembulatan: nominal desimal di mana urutan operasi float alternatif memberi hasil Math.round berbeda.
//    Vektor ini membuat golden sensitif terhadap "perapian" rumus yang tampak ekuivalen (mutation check M3).
{
  const alt = [(a) => Math.round(a * (1 / 1.11)), (a) => Math.round(a - (a * 0.11) / 1.11), (a) => Math.round((a * 100) / 111)];
  const base = (a) => Math.round(a / (1 + 0.11));
  let found = 0;
  for (let c = 1; c < 3_000_000 && found < 120; c += 7) {
    const a = c / 100;
    if (alt.some((f) => f(a) !== base(a))) { add({ invAmount: a, diskon: 0, biayaLain: 0, statusPPN: 'Include PPN', jenisPPh: '-', npwpVendor: '' }); found++; }
  }
  let f2 = 0;
  for (let c = 1; c < 3_000_000 && f2 < 80; c += 11) {
    const a = c / 100;
    if (Math.round(a * 0.015) !== Math.round(a * 0.03 / 2) || Math.round(a / 1.11 * 0.0175) !== Math.round(a * 0.0175 / 1.11)) { add({ invAmount: a, diskon: 0, biayaLain: 0, statusPPN: 'Include PPN', jenisPPh: 'PPh 22', npwpVendor: "'1" }); f2++; }
  }
  console.log(`pemburu batas: ${found} (include PPN), ${f2} (PPh)`);
}
fs.mkdirSync('tests/golden', { recursive: true });
fs.writeFileSync('tests/golden/tax.json', JSON.stringify({ rates: RATES, cases: taxCases }));

// ---------- plafon ----------
const GT = [0, -5, 1, 100, 999, 1000, 12345, 1000000, 1234567, 5555555, 99999999, 0.5, 333.33, '1000000', 'abc', null, undefined, '2.5e6'];
const Q = [0, -1, 1, 2, 3, 5, 10, 100, 0.5, 2.5, '10', 'x', null, undefined];
const plafon = [];
for (let i = 0; i < 600; i++) {
  const [gt, qp, qs] = [pick(GT), pick(Q), pick(Q)];
  const inp = clone({ gt, qp, qs });
  plafon.push({ ...inp, out: run(`hitungPlafonSJ_(${JSON.stringify(inp.gt)}, ${JSON.stringify(inp.qp)}, ${JSON.stringify(inp.qs)})`) });
}
for (const [gt, qp] of [[1000000, 10], [1234567, 3], [999, 7], [1, 1], [5, 3]]) for (const qs of [0, qp - 1, qp, qp + 1]) {
  plafon.push({ gt, qp, qs, out: run(`hitungPlafonSJ_(${gt}, ${qp}, ${qs})`) });
}
fs.writeFileSync('tests/golden/plafon.json', JSON.stringify(plafon));

// ---------- butuhCFO ----------
const cfo = [4999999, 5000000, 5000001, 0, -1, '5000000', '4999999.99', 'abc', null, undefined, 1e12, 4999999.5, 5e6 - 0.01].map((v) => {
  const inp = clone({ v });
  return { v: inp.v, out: run(`butuhCFO(${JSON.stringify(inp.v)})`) };
});
fs.writeFileSync('tests/golden/cfo.json', JSON.stringify(cfo));

// ---------- prefix Master_Setting ----------
const SETTING = [
  ['Company', 'Brand', 'C', 'D', 'Prefix'], // header (baris 1 dilewati oleh loop lama)
  ['PT Hemas Esensi Kirana', 'HEYLOCAL', '', '', 'HL'],
  ['PT Hemas Esensi Kirana', 'HEYLOCAL 2', '', '', 'HLX'],
  ['PT Male Maju', 'HEYMALE', '', '', 'hm'],
  ['PT Tanpa Prefix', 'NOPREFIX', '', '', ''],
  ['  PT Spasi  ', '  SPASI  ', '', '', ' sp '],
  ['PT Prefix Kosong Brand', '', '', '', 'ZZ'],
  ['PT Angka', 'ANGKA', '', '', 123],
];
const POS = ['PO/HL/2026/001', 'po/hm/2026/002', 'PO-HLX-9', 'XX/SP/1', 'ZZ-1', 'PO/123/1', 'PO/OTHER/1', 'HL', '', 'NOPREFIX'];
const prefix = POS.map((po) => ({ po, out: run(`cocokPrefix(${JSON.stringify(SETTING)}, ${JSON.stringify(po.toUpperCase())})`) }));
fs.writeFileSync('tests/golden/prefix.json', JSON.stringify({ setting: SETTING, cases: prefix }));

const nErr = taxCases.filter((c) => c.err).length;
console.log(`tax: ${taxCases.length} vektor (${nErr} error, ${taxCases.length - nErr} hasil) | plafon: ${plafon.length} | cfo: ${cfo.length} | prefix: ${prefix.length}`);
