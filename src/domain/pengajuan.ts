import { butuhCFO, LEVEL } from './config';
import { can } from './capabilities';
import { RuleError } from './errors';
import { num, str, upper } from './legacy-parse';
import { hasAuthority, type Role } from './roles';
import { hitungPajak, type TaxResult } from './tax';

// Padanan CRUD_Pengajuan.gs (bagian murni). Server menghitung SEMUA angka; angka dari browser tidak diterima sama sekali (I2).

export const TIPE = ['Trade', 'Non-Trade'] as const;
export type Tipe = (typeof TIPE)[number];
export const JENIS_PEMBAYARAN = ['Full Payment', 'DP', 'Pelunasan'] as const;
export const STATUS_PPN_OPSI = ['Non PPN', 'Include PPN', 'Exclude PPN'] as const;

export interface PengajuanInput {
  tipe: Tipe; brand: string; departement: string; description: string; eventProject?: string; notesUser?: string;
  poNumber?: string; vendorKode: string; noInvoice: string; dateInvoice: string; dueDate: string; jenisPembayaran: string;
  invoiceAmount: number; diskon?: number; biayaLainnya?: number; statusPPN?: string;
}

export const ID_PREFIX: Record<Tipe, string> = { Trade: 'TRD', 'Non-Trade': 'NTR' };

/** 'YYYY-MM-DD' valid secara kalender. Tanggal fiktif (31 Feb) ditolak - Date.parse biasa menggulirkannya diam-diam. */
export function isValidYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Hak membuat pengajuan: capability Level 1 DAN baris Level 1 untuk brand+divisi itu (ALL cocok). PIC dikunci = diri sendiri (keputusan 2026-10-20). */
export function cekHakPengaju(roles: readonly Role[], brand: string, dept: string): string | null {
  if (!can(roles, 'pengajuan.write')) return 'Akun Anda tidak berwenang membuat pengajuan.';
  if (!hasAuthority(roles, brand, dept, LEVEL.PIC)) return `Anda bukan PIC pengaju untuk ${upper(brand)} / ${upper(dept)}.`;
  return null;
}

/** Validasi server (pesan = sistem lama). `company` = hasil turunan server dari Master_Setting, bukan kiriman klien. */
export function validatePengajuan(f: PengajuanInput, company: string): void {
  const err: string[] = [];
  if (!str(company)) err.push('Company kosong');
  if (!str(f.brand)) err.push('Brand kosong');
  if (!str(f.departement)) err.push('Departemen kosong');
  if (!str(f.description)) err.push('Deskripsi kosong');
  if (!str(f.vendorKode)) err.push('Vendor kosong');
  if (!str(f.noInvoice)) err.push('No Invoice kosong');
  if (!str(f.dateInvoice)) err.push('Tanggal invoice kosong');
  if (!str(f.dueDate)) err.push('Jatuh tempo kosong');
  if (!str(f.jenisPembayaran)) err.push('Jenis pembayaran kosong');
  else if (!(JENIS_PEMBAYARAN as readonly string[]).includes(f.jenisPembayaran)) err.push('Jenis pembayaran tidak dikenal');
  if (!(num(f.invoiceAmount) > 0)) err.push('Nilai invoice harus > 0');
  if (f.tipe === 'Trade' && !str(f.poNumber)) err.push('Pengajuan Trade wajib punya Nomor P.O');
  if (str(f.dateInvoice) && !isValidYmd(f.dateInvoice)) err.push(`Tanggal invoice tidak valid: ${f.dateInvoice}`);
  if (str(f.dueDate) && !isValidYmd(f.dueDate)) err.push(`Jatuh tempo tidak valid: ${f.dueDate}`);
  if (isValidYmd(f.dateInvoice) && isValidYmd(f.dueDate) && f.dueDate < f.dateInvoice) err.push('Jatuh tempo tidak boleh sebelum tanggal invoice'); // ISO: urutan leksikal = urutan tanggal
  if (err.length) throw new RuleError('Data belum lengkap: ' + err.join(', ') + '.');
}

/** I2 + I1: hitung ulang dari nilai mentah. PPh sengaja "-" (baru ditentukan Finance). */
export function hitungDraft(a: { invoiceAmount?: unknown; diskon?: unknown; biayaLainnya?: unknown; statusPPN?: unknown; npwpVendor?: unknown }): TaxResult & { perluCFO: boolean } {
  const t = hitungPajak({ invAmount: a.invoiceAmount, diskon: a.diskon, biayaLain: a.biayaLainnya, statusPPN: a.statusPPN, jenisPPh: '-', npwpVendor: a.npwpVendor }, []);
  return { ...t, perluCFO: butuhCFO(t.finalAmount) };
}

/** I11: Trade non-DP butuh barang diterima penuh. qty harus hasil baca SEGAR DB_PO/DB_SJ, bukan snapshot baris. */
export function cekBarangDiterima(tipe: string, jenis: string, qtyPO: number, qtySJ: number): string | null {
  if (tipe === 'Trade' && jenis !== 'DP' && qtyPO > 0 && qtySJ < qtyPO) {
    return `Barang belum diterima penuh (SJ ${qtySJ} dari PO ${qtyPO}). Pembayaran "${jenis}" tidak bisa diajukan. Gunakan jenis "DP" bila memang uang muka.`;
  }
  return null;
}

/** Nama lock invoice (I9). Dinormalisasi supaya "inv-1" dan "INV-1 " berebut lock yang sama. */
export const invoiceLockName = (vendorKode: string, noInvoice: string): string => `inv:${upper(vendorKode)}:${upper(noInvoice)}`;

export interface BarisRingkas { idTrx: string; vendorKode: string; vendorNama: string; noInvoice: string; status: string }
/** I9: invoice sama dari vendor sama, selain berstatus Rejected dan selain dokumen ini sendiri. Vendor dicocokkan lewat kode (baris lama tanpa kode: lewat nama). */
export function cariInvoiceDuplikat(rows: readonly BarisRingkas[], vendor: { kode: string; nama: string }, noInvoice: string, excludeId?: string): BarisRingkas | null {
  const inv = upper(noInvoice);
  if (!inv) return null;
  const skip = upper(excludeId ?? '');
  for (const r of rows) {
    if (upper(r.noInvoice) !== inv) continue;
    if (skip && upper(r.idTrx) === skip) continue;
    if (r.status === 'Rejected') continue;
    const sameVendor = r.vendorKode ? upper(r.vendorKode) === upper(vendor.kode) : upper(r.vendorNama) === upper(vendor.nama);
    if (sameVendor) return r;
  }
  return null;
}
export const pesanInvoiceDuplikat = (noInvoice: string, vendorNama: string, idTrx: string): string =>
  `Invoice "${noInvoice}" dari vendor "${vendorNama}" sudah pernah diajukan (${upper(idTrx)}). Kalau ini pembayaran cicilan, pakai menu Bayar pada dokumen tersebut.`;

/** Teks bebas: buang karakter kontrol (kecuali baris baru pada catatan). Sheets menyimpannya sebagai literal; escape formula untuk export CSV/Odoo dikerjakan di Fase 2. */
export const bersihkanTeks = (v: string, keepNewline = false): string =>
  v.replace(keepNewline ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '').trim();
