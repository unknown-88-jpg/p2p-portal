import { after } from 'next/server';
import { kembalikanFinance } from '@/server/finance-aksi';
import { notifPIC } from '@/server/wa-notif';
import { kembalikanFinanceSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-B: Finance mengembalikan dokumen ke PIC (Revision Needed), alasan wajib. Idempotency-Key & etag wajib. F2-F: notif WA ke PIC SETELAH respons (I15). */
export const POST = route({ method: 'POST', session: 'required', schema: kembalikanFinanceSchema }, async ({ req, body, session }) => {
  const hasil = await kembalikanFinance(authDeps(), session!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req));
  after(() => notifPIC(authDeps(), { idTrx: hasil.id, jenis: 'dikembalikan', catatan: body.alasan.trim(), oleh: 'Finance' }));
  return { body: { hasil } };
});
