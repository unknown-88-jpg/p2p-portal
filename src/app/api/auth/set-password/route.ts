import { setPasswordSchema, setPasswordViaToken } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route({ method: 'POST', session: 'none', schema: setPasswordSchema }, async ({ body, ip }) => {
  await setPasswordViaToken(authDeps(), body, ip);
  return { body: { ok: true, message: 'Password berhasil diatur. Silakan login.' } };
});
