import { jalankanRepair } from '@/server/admin';
import { jalankanRepairSchema } from '@/server/admin-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C repair langkah 3-4: eksekusi rencana yang sama dengan pratinjau + laporan. Step-up password + Idempotency-Key wajib. */
export const POST = route({ method: 'POST', session: 'required', schema: jalankanRepairSchema }, async ({ req, body, session, token }) => ({
  body: { hasil: await jalankanRepair(authDeps(), session!, token!, body.token, idempotencyKeyOf(req)) },
}));
