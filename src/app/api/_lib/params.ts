import { AppError } from '@/lib/errors';
import { idTrxParam } from '@/server/pengajuan-schema';

/** ID transaksi dari path: `/api/pengajuan/{id}[/aksi]`. `fromEnd` = jumlah segmen setelah id (0 = id terakhir). */
export function idTrxFromPath(req: Request, fromEnd = 0): string {
  const seg = new URL(req.url).pathname.split('/').filter(Boolean);
  const raw = seg[seg.length - 1 - fromEnd] ?? '';
  const r = idTrxParam.safeParse(raw);
  if (!r.success) throw new AppError('VALIDATION', 'ID transaksi tidak valid.');
  return r.data;
}
export const idempotencyKeyOf = (req: Request): string | undefined => req.headers.get('idempotency-key')?.trim() || undefined;
