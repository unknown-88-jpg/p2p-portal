import { paksaLogout } from '@/server/admin';
import { noHpSchema } from '@/server/admin-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C: paksa logout semua sesi satu nomor. */
export const POST = route({ method: 'POST', session: 'required', schema: noHpSchema }, async ({ body, session }) => ({
  body: await paksaLogout(authDeps(), session!, body.noHp),
}));
