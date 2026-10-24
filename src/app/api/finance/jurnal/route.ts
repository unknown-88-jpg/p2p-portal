import { jurnalCoa } from '@/server/finance-aksi';
import { jurnalSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';
import { idempotencyKeyOf } from '../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-D: jurnal COA 1..30 dokumen (Finance Staff). Satu batch tulis; laporan per dokumen. Idempotency-Key wajib. */
export const POST = route({ method: 'POST', session: 'required', schema: jurnalSchema }, async ({ req, body, session }) => ({
  body: { hasil: await jurnalCoa(authDeps(), session!, body, idempotencyKeyOf(req)) },
}));
