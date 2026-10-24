import { z } from 'zod';
import { ALASAN_MAX, CATATAN_MAX } from '@/domain/approval';
import { bersihkanTeks } from '@/domain/pengajuan';

const txt = (max: number) => z.string().max(max * 2).transform((v) => bersihkanTeks(v, false)).pipe(z.string().max(max));
const etag = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const rupiah = z.number().int('Nominal harus bilangan bulat rupiah.').min(0).max(1e13);

/** STRICT: status, level, verifikator, PPN/PPh hasil hitung, nominal akhir TIDAK diterima dari klien (I2: dihitung ulang server). */
export const verifikasiPajakSchema = z.object({
  etag,
  invAmount: rupiah,
  diskon: rupiah.default(0),
  biayaLain: rupiah.default(0),
  statusPPN: z.enum(['Include PPN', 'Exclude PPN', 'Non PPN']),
  jenisPPh: z.string().trim().max(100).default('-'),
  notes: txt(CATATAN_MAX).optional(),
}).strict();

export const kembalikanFinanceSchema = z.object({ etag, alasan: txt(ALASAN_MAX).pipe(z.string().min(3, 'Alasan minimal 3 huruf.')) }).strict();

/** F2-C: e-approve. Identitas & level dari sesi; `sebagai` hanya memilih peran yang diklaim (dicek terhadap capability). */
export const setujuiFinanceSchema = z.object({ etag, sebagai: z.enum(['finmgr', 'cfo']), notes: txt(CATATAN_MAX).optional() }).strict();

const lvl = z.string().trim().max(120);
/** F2-D: jurnal COA (bulk, maks. 30). Nomor baris TIDAK pernah dari klien (R-21); identitas dari sesi. */
export const jurnalSchema = z.object({
  items: z.array(z.object({
    id: z.string().regex(/^(TRD|NTR)-\d{5,}$/), etag,
    lvl1: lvl, lvl2: lvl, lvl3: lvl.default('-'), lvl4: lvl.default('-'), lvl5: lvl.default('-'),
    budget: z.string().trim().max(60), notes: txt(CATATAN_MAX).optional(),
  }).strict()).min(1, 'Pilih minimal satu dokumen.').max(30, 'Maksimal 30 dokumen sekali jurnal.'),
}).strict();
