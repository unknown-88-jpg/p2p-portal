// Fase 3 / F3-A: pendaftaran & pengesahan vendor (port CRUD_Vendor.gs). Murni, tanpa I/O.
import { clean, str, upper } from './legacy-parse';
import { bangunVendor, type Vendor } from './master';
import { TIPE } from './pengajuan';

export const VENDOR_STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' } as const;
export interface InputVendor { namaVendor: string; tipeVendor: string; npwp?: string | undefined; bank: string; namaRekening: string; noRekening: string }
export interface VendorBersih { nama: string; tipe: string; npwp: string; bank: string; namaRekening: string; noRekening: string }

/** Nomor rekening: spasi/titik/strip pemisah dibuang (kemudahan ketik), sisanya HARUS 6-20 digit (aturan lama). */
export const bersihRekening = (v: string): string => clean(v).replace(/[\s.-]/g, '');

/** Validasi & normalisasi (submitNewVendor lama): nama/bank/nama rekening huruf besar; galat per kolom. */
export function validasiVendor(i: InputVendor): { ok: true; v: VendorBersih } | { ok: false; galat: Record<string, string> } {
  const v: VendorBersih = {
    nama: upper(i.namaVendor), tipe: str(i.tipeVendor), npwp: clean(i.npwp ?? '').trim(), bank: upper(i.bank),
    namaRekening: upper(i.namaRekening), noRekening: bersihRekening(i.noRekening),
  };
  const g: Record<string, string> = {};
  if (!v.nama) g.namaVendor = 'Nama vendor wajib diisi.';
  if (!(TIPE as readonly string[]).includes(v.tipe)) g.tipeVendor = 'Tipe vendor wajib dipilih.';
  if (!v.bank) g.bank = 'Nama bank wajib diisi.';
  if (!v.namaRekening) g.namaRekening = 'Nama pemilik rekening wajib diisi.';
  if (!v.noRekening) g.noRekening = 'Nomor rekening wajib diisi.';
  else if (!/^\d{6,20}$/.test(v.noRekening)) g.noRekening = 'Nomor rekening harus 6–20 digit angka.';
  return Object.keys(g).length ? { ok: false, galat: g } : { ok: true, v };
}

/**
 * I7: rekening (bank + nomor) unik. Dibandingkan dengan vendor Pending & Approved; vendor yang DITOLAK tidak menghalangi
 * pendaftaran ulang (mis. ditolak karena salah ketik nama). Lama: semua baris, termasuk Rejected.
 */
export function rekeningSama(rows: readonly (readonly unknown[])[], bank: string, noRek: string, kecualiKode = ''): Vendor | null {
  const b = upper(bank), n = bersihRekening(noRek), k = upper(kecualiKode);
  for (const r of rows) {
    const v = bangunVendor(r);
    if (!v.kode || upper(v.kode) === k || upper(v.status) === upper(VENDOR_STATUS.REJECTED)) continue;
    if (upper(v.bank) === b && bersihRekening(v.noRekening) === n) return v;
  }
  return null;
}

/** Peringatan untuk pengesah (bukan blokir): NPWP kosong, nomor rekening sama di bank lain, nama vendor sudah ada. */
export function peringatanVendor(v: Vendor, rows: readonly (readonly unknown[])[]): string[] {
  const p: string[] = [];
  if (!v.npwp || v.npwp === '-') p.push('NPWP kosong (tarif PPh non-NPWP akan dipakai).');
  for (const r of rows) {
    const x = bangunVendor(r);
    if (!x.kode || upper(x.kode) === upper(v.kode) || upper(x.status) === upper(VENDOR_STATUS.REJECTED)) continue;
    if (bersihRekening(x.noRekening) === bersihRekening(v.noRekening) && upper(x.bank) !== upper(v.bank)) p.push(`Nomor rekening sama dengan ${x.kode} (${x.nama}) di bank ${x.bank}.`);
    if (upper(x.nama) === upper(v.nama)) p.push(`Nama vendor sama dengan ${x.kode} (${x.status}).`);
  }
  return p;
}

/** Maker-checker (approveVendor lama): pendaftar tidak boleh mengesahkan vendornya sendiri. Email dinormalisasi. */
export const pendaftarSama = (pendaftar: string, email: string): boolean => {
  const a = pendaftar.trim().toLowerCase();
  return a !== '' && a === email.trim().toLowerCase();
};
