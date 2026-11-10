// Impor vendor massal dari CSV (admin-run, scripts/import-vendor.ts). Murni, tanpa I/O. Aturan bisnis TETAP dari domain/vendor (validasi, I7).
import { validasiVendor, rekeningSama, type InputVendor } from './vendor';

/** Parser CSV minimal: pemisah koma atau titik koma, tanda kutip ganda dengan "" sebagai escape, CRLF/LF, BOM dibuang. */
export function parseCsv(teks: string): string[][] {
  const t = teks.replace(/^﻿/, '');
  const pemisah = (t.split(/\r?\n/, 1)[0] ?? '').includes(';') ? ';' : ',';
  const out: string[][] = [];
  let baris: string[] = [], sel = '', kutip = false;
  const tutupSel = (): void => { baris.push(sel); sel = ''; };
  const tutupBaris = (): void => { tutupSel(); if (baris.some((c) => c.trim() !== '')) out.push(baris); baris = []; };
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (kutip) {
      if (c === '"') { if (t[i + 1] === '"') { sel += '"'; i++; } else kutip = false; } else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === pemisah) tutupSel();
    else if (c === '\n') tutupBaris();
    else if (c !== '\r') sel += c;
  }
  if (sel !== '' || baris.length) tutupBaris();
  return out;
}

const NAMA_KOLOM: Record<keyof InputVendor, readonly string[]> = {
  namaVendor: ['nama', 'nama_vendor', 'namavendor'],
  tipeVendor: ['tipe', 'tipe_vendor', 'tipevendor'],
  npwp: ['npwp'],
  bank: ['bank'],
  namaRekening: ['nama_rekening', 'namarekening', 'nama_pemilik_rekening'],
  noRekening: ['no_rekening', 'norekening', 'nomor_rekening'],
};
const kunci = (h: string): string => h.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Header wajib lengkap (npwp boleh kosong isinya, kolomnya tetap harus ada). Mengembalikan galat atau daftar input + nomor baris file. */
export function bacaBarisVendor(csv: string[][]): { ok: false; galat: string } | { ok: true; baris: { no: number; input: InputVendor }[] } {
  const header = csv[0]?.map(kunci);
  if (!header) return { ok: false, galat: 'CSV kosong.' };
  const idx = {} as Record<keyof InputVendor, number>;
  for (const k of Object.keys(NAMA_KOLOM) as (keyof InputVendor)[]) {
    const i = header.findIndex((h) => NAMA_KOLOM[k].includes(h));
    if (i < 0) return { ok: false, galat: `Kolom "${NAMA_KOLOM[k][0]}" tidak ada di header CSV.` };
    idx[k] = i;
  }
  const baris = csv.slice(1).map((r, i) => ({
    no: i + 2,
    input: Object.fromEntries((Object.keys(idx) as (keyof InputVendor)[]).map((k) => [k, (r[idx[k]] ?? '').trim()])) as unknown as InputVendor,
  }));
  return { ok: true, baris };
}

export type HasilBaris = { no: number; status: 'siap' | 'ditolak'; alasan: string };

/**
 * Rencana impor (dry-run): validasi + I7 terhadap isi sheet SAAT INI dan baris file sebelumnya yang "siap".
 * Pengecualian pasangan Trade / Non-Trade ikut berlaku (via rekeningSama). Alasan TIDAK memuat NPWP/rekening.
 */
export function rencanaImpor(sheet: readonly (readonly unknown[])[], baris: readonly { no: number; input: InputVendor }[]): HasilBaris[] {
  const diterima: unknown[][] = [...sheet.map((r) => [...r])];
  return baris.map(({ no, input }) => {
    const val = validasiVendor(input);
    if (!val.ok) return { no, status: 'ditolak', alasan: Object.values(val.galat)[0]! };
    const v = val.v;
    const dup = rekeningSama(diterima, v.bank, v.noRekening, '', { nama: v.nama, tipe: v.tipe, npwp: v.npwp });
    if (dup) return { no, status: 'ditolak', alasan: `Rekening sudah dipakai ${dup.kode || 'baris lain di file'} (I7).` };
    diterima.push([`FILE-${no}`, v.nama, v.tipe, v.npwp, v.bank, v.namaRekening, v.noRekening, 'Pending']);
    return { no, status: 'siap', alasan: '' };
  });
}
