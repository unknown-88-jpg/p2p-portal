import { z } from 'zod';
import { bersihkanTeks, JENIS_PEMBAYARAN, STATUS_PPN_OPSI, TIPE } from '@/domain/pengajuan';

const txt = (max: number, nl = false) => z.string().max(max * 2).transform((v) => bersihkanTeks(v, nl)).pipe(z.string().max(max));
const req = (max: number) => txt(max).pipe(z.string().min(1));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rupiah = z.number().finite().min(0).max(1e13);

/**
 * Input pengajuan dari klien. STRICT: kunci asing (mis. dpp/finalAmount/requireCfo/company/pic/createdBy) ditolak 400 - angka & identitas
 * selalu diturunkan server. Vendor dipilih lewat KODE (bukan nama bebas); company dari Master_Setting; PIC = pengguna yang login.
 */
export const pengajuanSchema = z.object({
  tipe: z.enum(TIPE),
  brand: req(80),
  departement: req(80),
  description: req(500),
  eventProject: txt(200).optional(),
  notesUser: txt(1000, true).optional(),
  poNumber: txt(60).optional(),
  vendorKode: req(30),
  noInvoice: req(60),
  dateInvoice: ymd,
  dueDate: ymd,
  jenisPembayaran: z.enum(JENIS_PEMBAYARAN),
  invoiceAmount: rupiah,
  diskon: rupiah.optional(),
  biayaLainnya: rupiah.optional(),
  statusPPN: z.enum(STATUS_PPN_OPSI).optional(),
}).strict();
export type PengajuanBody = z.infer<typeof pengajuanSchema>;

export const idTrxParam = z.string().regex(/^(TRD|NTR)-\d{5,}$/);
