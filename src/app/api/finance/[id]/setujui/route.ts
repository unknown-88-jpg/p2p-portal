import { setujuiFinance } from '@/server/finance-aksi';
import { setujuiFinanceSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-C (O4): e-approve Fin. Mgr / CFO. Step-up password wajib; Idempotency-Key & etag wajib; urutan Fin. Mgr -> CFO. */
export const POST = route({ method: 'POST', session: 'required', schema: setujuiFinanceSchema }, async ({ req, body, session, token }) => ({
  body: { hasil: await setujuiFinance(authDeps(), session!, token!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req)) },
}));
