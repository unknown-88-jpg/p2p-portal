import { AppError } from '@/lib/errors';
import { authDeps } from '@/server/runtime';
import { putuskanVendor } from '@/server/vendor';
import { kodeVendorParam, tolakVendorSchema } from '@/server/vendor-schema';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-A: tolak (alasan wajib) vendor berdasarkan KODE (R-21), bukan nomor baris. Finance Staff. */
export const POST = route({ method: 'POST', session: 'required', schema: tolakVendorSchema }, async ({ req, body, session }) => {
  const seg = new URL(req.url).pathname.split('/').filter(Boolean);
  const kode = kodeVendorParam.safeParse(decodeURIComponent(seg[seg.length - 2] ?? ''));
  if (!kode.success) throw new AppError('VALIDATION', 'Kode vendor tidak valid.');
  return { body: { hasil: await putuskanVendor(authDeps(), session!, kode.data, 'reject', body, idempotencyKeyOf(req)) } };
});
