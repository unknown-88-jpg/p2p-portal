import { kembalikanFinance } from '@/server/finance-aksi';
import { kembalikanFinanceSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-B: Finance mengembalikan dokumen ke PIC (Revision Needed), alasan wajib. Idempotency-Key & etag wajib. */
export const POST = route({ method: 'POST', session: 'required', schema: kembalikanFinanceSchema }, async ({ req, body, session }) => ({
  body: { hasil: await kembalikanFinance(authDeps(), session!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req)) },
}));
