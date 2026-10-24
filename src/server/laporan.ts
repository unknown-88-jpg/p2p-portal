import { can } from '@/domain/capabilities';
import { agingAP, cariAudit, DIMENSI_REKAP, logPembayaran, rekapPeriode, type FilterAudit } from '@/domain/laporan';
import { AppError } from '@/lib/errors';
import { fmtWaktu, wibDate } from '@/lib/time';
import { AUDIT_LOG, TRX_PAYMENT_LOG, TRX_PENGAJUAN } from '@/repo/schema';
import { z } from 'zod';
import type { AuthDeps, SessionData } from './auth';
import { keObjek } from './export-odoo';
import { bacaTampilanDetail } from './view-cache';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const rentangQuery = z.object({ dari: ymd, sampai: ymd }).refine((x) => x.dari <= x.sampai, { message: 'Tanggal mulai harus sebelum tanggal selesai.', path: ['sampai'] });
export const rekapQuery = z.object({ dari: ymd, sampai: ymd, dimensi: z.enum(DIMENSI_REKAP) }).refine((x) => x.dari <= x.sampai, { path: ['sampai'] });
export const auditQuery = z.object({
  id: z.string().trim().max(40).optional(), aktor: z.string().trim().max(160).optional(), aksi: z.string().trim().max(60).optional(),
  dari: ymd.optional(), sampai: ymd.optional(),
}).strict();

/** Query string -> objek tervalidasi (nilai kosong dibuang). */
export function parseQuery<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const q = Object.fromEntries([...new URL(req.url).searchParams.entries()].filter(([, v]) => v.trim() !== ''));
  const r = schema.safeParse(q);
  if (!r.success) throw new AppError('VALIDATION', 'Filter tidak valid.', Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', 'tidak valid'])));
  return r.data;
}

function wajib(s: SessionData, cap: 'report.view' | 'audit.view'): void {
  if (!can(s.roles, cap)) throw new AppError('FORBIDDEN', cap === 'audit.view' ? 'Viewer audit hanya untuk Fin. Mgr, CFO, dan Admin.' : 'Laporan hanya untuk Finance, CFO, dan Admin.');
}

/** Trx_Pengajuan + Trx_Payment_Log lewat cache tampilan (15 dtk; laporan baca saja, bukan aksi uang). `basi` = dari salinan lama karena Sheets sibuk. */
async function data(d: AuthDeps) {
  const [p, b] = await Promise.all([bacaTampilanDetail(d, TRX_PENGAJUAN), bacaTampilanDetail(d, TRX_PAYMENT_LOG)]);
  return { pengajuan: p.rows.map((r) => keObjek(TRX_PENGAJUAN, r)), pembayaran: b.rows.map((r) => keObjek(TRX_PAYMENT_LOG, r)), basi: p.basi || b.basi };
}

export async function laporanAging(d: AuthDeps, s: SessionData) {
  wajib(s, 'report.view');
  const x = await data(d);
  const hariIni = wibDate(d.clock.now());
  return { hariIni, basi: x.basi, ...agingAP(x.pengajuan, x.pembayaran, hariIni) };
}

export async function laporanRekap(d: AuthDeps, s: SessionData, q: z.infer<typeof rekapQuery>) {
  wajib(s, 'report.view');
  const x = await data(d);
  return { basi: x.basi, ...rekapPeriode(x.pengajuan, x.pembayaran, q) };
}

export async function laporanPembayaran(d: AuthDeps, s: SessionData, q: z.infer<typeof rentangQuery>) {
  wajib(s, 'report.view');
  const x = await data(d);
  return { basi: x.basi, ...logPembayaran(x.pembayaran, x.pengajuan, q) };
}

export async function lihatAudit(d: AuthDeps, s: SessionData, f: FilterAudit) {
  wajib(s, 'audit.view');
  const a = await bacaTampilanDetail(d, AUDIT_LOG);
  const h = cariAudit(a.rows.map((r) => keObjek(AUDIT_LOG, r)), f);
  return { basi: a.basi, cocok: h.cocok, baris: h.baris.map(({ waktuSerial, ...b }) => ({ ...b, waktu: fmtWaktu(waktuSerial) })) };
}
