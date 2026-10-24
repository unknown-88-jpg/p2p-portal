import { z } from 'zod';
import { ALASAN_MAX } from '@/domain/approval';
import { bersihkanTeks } from '@/domain/pengajuan';

const t = (max: number) => z.string().max(max * 2).transform((v) => bersihkanTeks(v, false)).pipe(z.string().max(max));
/** F3-A: pendaftaran vendor. Status, kode, pendaftar, tanggal TIDAK diterima dari klien. */
export const daftarVendorSchema = z.object({
  namaVendor: t(120), tipeVendor: z.string().max(20), npwp: t(40).optional(), bank: t(60), namaRekening: t(120), noRekening: z.string().max(40),
}).strict();
/** Pengesahan berdasarkan KODE (R-21) + ringkasan rekening yang dilihat pengesah (divalidasi ulang di server). */
export const sahkanVendorSchema = z.object({ bank: z.string().max(60), noRekening: z.string().max(40) }).strict();
export const tolakVendorSchema = z.object({ bank: z.string().max(60), noRekening: z.string().max(40), alasan: t(ALASAN_MAX).pipe(z.string().min(3, 'Alasan minimal 3 huruf.')) }).strict();
export const kodeVendorParam = z.string().regex(/^VND-\d{4,}$/i);
