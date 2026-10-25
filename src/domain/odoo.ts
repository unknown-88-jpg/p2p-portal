// F3-B: export jurnal Odoo — padanan exportJurnalOdoo() di Export_Odoo.gs (I16).
// Isi CSV SENGAJA identik dengan sistem lama (golden test tests/golden/odoo.json), dengan satu beda tercatat:
// sel TEKS yang diawali = + - @ TAB CR (kecuali "-" tunggal = penanda kosong lama) diberi apostrof di depan (anti formula injection saat dibuka di Excel/Sheets).
// Murni, tanpa I/O: baris sheet masuk sebagai objek {kolom: nilai}.
import { num, str, upper } from './legacy-parse';
import { STATUS } from './status';

export const ODOO_ACCOUNT = {
  PPN_MASUKAN: '1-10500 PPN Masukan',
  HUTANG_USAHA: '2-10100 Hutang Usaha',
  HUTANG_PPH: '2-10300 Hutang PPh',
} as const;

export const JENIS_EXPORT = ['keduanya', 'pembelian', 'pembayaran'] as const;
export type JenisExport = (typeof JENIS_EXPORT)[number];

export const HEADER_ODOO = ['Number', 'Date', 'Journal', 'Partner', 'Reference', 'Label', 'Account', 'Analytic Account', 'Debit', 'Credit'] as const;

/** Status yang jurnal pembeliannya sudah diakui (COA Posted ke atas). */
const STATUS_DIAKUI: readonly string[] = [STATUS.COA_POSTED, STATUS.PARTIALLY_PAID, STATUS.PAID];

type Baris = Readonly<Record<string, unknown>>;
type Sel = { teks: string } | { angka: number };
const T = (v: string): Sel => ({ teks: v });
const A = (v: number): Sel => ({ angka: v });

const SERIAL_UNIX_EPOCH = 25569;
/** Nilai tanggal sheet -> 'YYYY-MM-DD' (WIB). Serial (angka / angka-teks) atau teks ISO 'YYYY-MM-DD...'. '' bila tidak terbaca. */
export function tglYmd(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  // serial = waktu dinding WIB -> tanggalnya cukup diambil dari bagian bulat (tanpa geser zona)
  return new Date(Math.round((Math.floor(n) - SERIAL_UNIX_EPOCH) * 86_400_000)).toISOString().slice(0, 10);
}

export interface HasilOdoo {
  rows: string[][];
  jumlahPembelian: number;
  jumlahPembayaran: number;
  /** Catatan untuk pengguna (tidak mengubah isi CSV): entry tak seimbang, pembayaran tanpa akun kas, tanggal invoice kosong. */
  peringatan: string[];
}

/** Anti formula injection: sel teks yang diawali karakter pemicu rumus diberi apostrof. Angka tidak disentuh. */
export function amankanSel(s: string): string {
  return /^[=+@\t\r]|^-./s.test(s) ? `'${s}` : s;
}
const rupiah2 = (n: number): string => n.toFixed(2);
const render = (r: readonly Sel[]): string[] => r.map((c) => ('teks' in c ? amankanSel(c.teks) : rupiah2(c.angka)));

export function susunJurnalOdoo(a: {
  pengajuan: readonly Baris[];
  pembayaran: readonly Baris[];
  dari: string; sampai: string; // 'YYYY-MM-DD' WIB, inklusif
  jenis: JenisExport;
}): HasilOdoo {
  const rows: string[][] = [[...HEADER_ODOO]];
  const peringatan: string[] = [];
  let jumlahPembelian = 0, jumlahPembayaran = 0;
  const dalam = (ymd: string): boolean => ymd !== '' && ymd >= a.dari && ymd <= a.sampai;

  if (a.jenis === 'pembelian' || a.jenis === 'keduanya') {
    for (const r of a.pengajuan) {
      if (!STATUS_DIAKUI.includes(str(r.STATUS))) continue;
      // Filter = TANGGAL INVOICE; kosong/invalid -> fallback timestamp submit (supaya baris tidak hilang diam-diam).
      const tglInv = tglYmd(r.DATE_INVOICE);
      if (!dalam(tglInv || tglYmd(r.TIMESTAMP))) continue;

      const id = str(r.ID_TRX), vendor = str(r.VENDOR_NAME), ref = str(r.NO_INVOICE), budget = ''; // kolom analitik tetap ada, kosong (plafon budget dinonaktifkan 2026-10-25)
      const dpp = num(r.DPP), ppn = num(r.PPN_AMOUNT), biaya = num(r.BIAYA_LAIN), diskon = num(r.DISKON), pph = num(r.PPH_AMOUNT), netto = num(r.FINAL_AMOUNT);
      const debitBeban = dpp + biaya - diskon;

      rows.push(render([T(id), T(tglInv || '-'), T('Purchase'), T(vendor), T(ref), T(str(r.DESCRIPTION)), T(str(r.SUB_COA)), T(budget), A(debitBeban), A(0)]));
      if (ppn > 0) rows.push(render([T(''), T(''), T(''), T(''), T(''), T(`PPN Masukan ${ref}`), T(ODOO_ACCOUNT.PPN_MASUKAN), T(budget), A(ppn), A(0)]));
      if (pph > 0) rows.push(render([T(''), T(''), T(''), T(''), T(''), T(`${str(r.JENIS_PPH)} ${ref}`), T(ODOO_ACCOUNT.HUTANG_PPH), T(budget), A(0), A(pph)]));
      rows.push(render([T(''), T(''), T(''), T(''), T(''), T(`Hutang ${vendor}`), T(ODOO_ACCOUNT.HUTANG_USAHA), T(budget), A(0), A(netto)]));
      jumlahPembelian++;

      if (!tglInv) peringatan.push(`${id}: tanggal invoice kosong (difilter memakai tanggal submit; kolom Date berisi "-").`);
      const selisih = Math.round((debitBeban + Math.max(ppn, 0) - Math.max(pph, 0) - netto) * 100) / 100;
      if (selisih !== 0) peringatan.push(`${id}: debit ≠ kredit (selisih ${selisih}); periksa sebelum impor.`);
    }
  }

  if (a.jenis === 'pembayaran' || a.jenis === 'keduanya') {
    const meta = new Map<string, { vendor: string; budget: string }>();
    for (const r of a.pengajuan) meta.set(upper(r.ID_TRX), { vendor: str(r.VENDOR_NAME), budget: '' });
    for (const p of a.pembayaran) {
      const tgl = tglYmd(p.Tgl_Bayar);
      if (!dalam(tgl)) continue;
      const idTrx = upper(p.ID_Trx), nominal = num(p.Nominal), akunKas = str(p.Sumber_Rekening), refBayar = str(p.Ref_No), logId = str(p.Log_ID);
      if (nominal <= 0) continue;
      const m = meta.get(idTrx) ?? { vendor: idTrx, budget: '' };
      rows.push(render([T(logId), T(tgl), T('Bank'), T(m.vendor), T(refBayar || idTrx), T(`Pelunasan ${idTrx}`), T(ODOO_ACCOUNT.HUTANG_USAHA), T(m.budget), A(nominal), A(0)]));
      rows.push(render([T(''), T(''), T(''), T(''), T(''), T(`Kas keluar ${idTrx}`), T(akunKas || ODOO_ACCOUNT.HUTANG_USAHA), T(m.budget), A(0), A(nominal)]));
      jumlahPembayaran++;
      if (!akunKas) peringatan.push(`${logId}: pembayaran tanpa akun kas (kredit memakai Hutang Usaha seperti sistem lama).`);
    }
  }
  return { rows, jumlahPembelian, jumlahPembayaran, peringatan };
}

/** CSV persis format lama: semua sel dikutip, kutip ganda di-escape, baris dipisah \n. */
export const keCsv = (rows: readonly (readonly string[])[]): string => rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');

export const namaFileOdoo = (jenis: JenisExport, dari: string, sampai: string): string =>
  `Odoo_${jenis}_${dari.replace(/-/g, '')}_${sampai.replace(/-/g, '')}.csv`;

export const PESAN_KOSONG_ODOO = 'Tidak ada transaksi di rentang & jenis yang dipilih.';
