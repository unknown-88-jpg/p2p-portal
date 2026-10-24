import { kirimLinkPassword } from '@/server/admin';
import { noHpSchema } from '@/server/admin-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C: kirim link set-password ke WA user. */
export const POST = route({ method: 'POST', session: 'required', schema: noHpSchema }, async ({ body, session }) => ({
  body: await kirimLinkPassword(authDeps(), session!, body.noHp),
}));
