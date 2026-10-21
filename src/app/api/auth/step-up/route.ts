import { STEPUP_MS, stepUp, stepUpSchema } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route({ method: 'POST', session: 'required', schema: stepUpSchema }, async ({ body, ip, session, token }) => {
  await stepUp(authDeps(), token!, session!, body, ip);
  return { body: { ok: true, validForSeconds: STEPUP_MS / 1000 } };
});
