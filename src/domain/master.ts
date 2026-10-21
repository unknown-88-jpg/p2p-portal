import { CONFIG, LEVEL } from './config';
import { clean, num, str, upper } from './legacy-parse';
import { isAktif, parseLevel } from './roles';

// Padanan API_Master.gs (bagian murni). Input = baris mentah sheet; output = DTO JSON (TANPA email: klien tidak butuh).

export interface Entitas { brandCompanyMap: Record<string, string>; prefixMap: Record<string, { brand: string; company: string }> }

export function bangunEntitas(rows: readonly (readonly unknown[])[]): Entitas {
  const brandCompanyMap: Entitas['brandCompanyMap'] = {}, prefixMap: Entitas['prefixMap'] = {};
  for (const r of rows) {
    const company = str(r[0]), brand = upper(r[1]), prefix = upper(r[4]); // kolom C & D diabaikan
    if (!brand) continue;
    if (company) brandCompanyMap[brand] = company;
    if (prefix) prefixMap[prefix] = { brand, company };
  }
  return { brandCompanyMap, prefixMap };
}

export type CoaRow = [string, string, string, string, string];
export function bangunCoa(rows: readonly (readonly unknown[])[]): CoaRow[] {
  return rows.filter((r) => str(r[0])).map((r) => [str(r[0]), str(r[1]) || '-', str(r[2]) || '-', str(r[3]) || '-', str(r[4]) || '-']);
}

export interface KasAccount { akun: string; grup: string; lvl1: string; lvl2: string; lvl3: string; lvl4: string; lvl5: string }
/**
 * Akun kas = baris COA yang penanda "KAS DAN SETARA KAS" (CONFIG.KAS_L3) ada di Level 2 (struktur COA sekarang: ASET > KAS DAN SETARA KAS > BANK > akun)
 * ATAU Level 3 (struktur lama: ASET > ASET LANCAR > KAS DAN SETARA KAS > ...; kode Apps Script lama hanya mengenal ini -> daftar kas KOSONG di COA sekarang).
 * Akun eksekusi = level terdalam sesudah penanda yang bukan "-"; unik per nama akun.
 */
export function bangunKas(coa: readonly CoaRow[]): KasAccount[] {
  const penanda = upper(CONFIG.KAS_L3);
  const seen = new Set<string>(), list: KasAccount[] = [];
  for (const c of coa) {
    const idx = [1, 2].find((i) => upper(c[i]) === penanda);
    if (idx === undefined) continue;
    let akun = c[idx]!;
    for (let i = idx + 1; i < 5; i++) if (c[i] !== '-') akun = c[i]!;
    if (akun === '-' || seen.has(akun)) continue;
    seen.add(akun);
    list.push({ akun, grup: c[idx + 1] !== '-' ? c[idx + 1]! : '', lvl1: c[0], lvl2: c[1], lvl3: c[2], lvl4: c[3], lvl5: c[4] });
  }
  return list;
}

export interface PphRow { jenis: string; tarifNPWP: number; tarifNon: number }
export function bangunPph(rows: readonly (readonly unknown[])[]): PphRow[] {
  return rows.filter((r) => str(r[0])).map((r) => ({ jenis: str(r[0]), tarifNPWP: num(r[1]), tarifNon: num(r[2]) }));
}

export interface OrgPerson { nama: string; jabatan: string }
export interface OrgNode { pics: string[]; levels: Record<string, OrgPerson[]> }
export interface Org { brands: string[]; tree: Record<string, Record<string, OrgNode>>; brandCompanyMap: Record<string, string> }

/** Struktur organisasi dari Master_User_TTD (kolom: Brand, Dept, Level, Jabatan, Nama, Email, Aktif). Baris ALL (Finance/CFO) tidak membentuk brand. */
export function bangunOrg(rows: readonly (readonly unknown[])[], brandCompanyMap: Entitas['brandCompanyMap']): Org {
  const tree: Org['tree'] = {};
  for (const r of rows) {
    const nama = str(r[4]);
    if (!nama || nama === '-') continue;
    if (!isAktif(r[6])) continue;
    const brand = upper(r[0]), dept = upper(r[1]);
    const level = parseLevel(r[2]);
    if (!brand || !dept) continue;
    if (brand === 'ALL' || dept === 'ALL') continue;
    const node = ((tree[brand] ??= {})[dept] ??= { pics: [], levels: {} });
    (node.levels[String(level)] ??= []).push({ nama, jabatan: str(r[3]) || 'Staff' });
    if (level === LEVEL.PIC && !node.pics.includes(nama)) node.pics.push(nama);
  }
  const brands = Object.keys(tree).sort();
  for (const b of brands) for (const d of Object.keys(tree[b]!)) tree[b]![d]!.pics.sort();
  return { brands, tree, brandCompanyMap };
}

export interface PicOptions { pics: string[]; adaManager: boolean; manager: string; peringatan: string }
/** `pengaju` (opsional, nama): Manager dengan nama sama dilewati (SoD: pembuat tak boleh menyetujui dokumennya sendiri; submit juga menolaknya). */
export function picOptions(org: Org, brand: string, dept: string, pengaju = ''): PicOptions {
  const node = org.tree[upper(brand)]?.[upper(dept)];
  if (!node) return { pics: [], adaManager: false, manager: '', peringatan: 'Divisi tidak ditemukan.' };
  const semua = node.levels[String(LEVEL.MANAGER)] ?? [];
  const diri = pengaju.trim().toLowerCase();
  const lvl2 = diri ? semua.filter((m) => m.nama.trim().toLowerCase() !== diri) : semua;
  const adaManager = lvl2.length > 0;
  let peringatan = '';
  if (!node.pics.length) peringatan = `Divisi ${upper(dept)} belum punya PIC pengaju (Level 1) di Master_User_TTD.`;
  else if (!adaManager && semua.length > 0) peringatan = `Divisi ${upper(dept)} tidak punya Manager (Level 2) selain Anda sendiri; pengajuan tidak bisa dikirim.`;
  else if (!adaManager) peringatan = `Divisi ${upper(dept)} belum punya Manager (Level 2). Pengajuan akan tertahan di antrean approval sampai manager didaftarkan.`;
  return { pics: node.pics, adaManager, manager: adaManager ? lvl2[0]!.nama : '', peringatan };
}

export interface Vendor { kode: string; nama: string; tipe: string; npwp: string; bank: string; namaRekening: string; noRekening: string; status: string }
export function bangunVendor(r: readonly unknown[]): Vendor {
  return { kode: str(r[0]), nama: str(r[1]), tipe: str(r[2]), npwp: clean(r[3]), bank: str(r[4]), namaRekening: str(r[5]), noRekening: clean(r[6]), status: str(r[7]) };
}
export function cariVendor(rows: readonly (readonly unknown[])[], kode: string): Vendor | null {
  const t = upper(kode);
  if (!t) return null; // lama: kode kosong bisa cocok dengan baris kosong; sama-sama berujung penolakan, di sini lebih tegas
  for (const r of rows) if (upper(r[0]) === t) return bangunVendor(r);
  return null;
}
export function daftarVendor(rows: readonly (readonly unknown[])[], tipe: string): { kode: string; namaAsli: string; namaLengkap: string; npwp: string; bank: string; namaRekening: string; noRekening: string }[] {
  const t = str(tipe).toLowerCase();
  return rows.filter((r) => str(r[2]).toLowerCase() === t).filter((r) => upper(r[7]) === 'APPROVED').map((r) => {
    const v = bangunVendor(r);
    return { kode: v.kode, namaAsli: v.nama, namaLengkap: `[${v.kode}] ${v.nama}`, npwp: v.npwp, bank: v.bank, namaRekening: v.namaRekening, noRekening: v.noRekening };
  });
}
