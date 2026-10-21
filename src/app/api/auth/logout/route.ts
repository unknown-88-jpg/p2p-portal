import { logout } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { clearCookie, route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route({ method: 'POST', session: 'none' }, async ({ token }) => {
  await logout(authDeps(), token);
  return { body: { ok: true }, headers: { 'set-cookie': clearCookie() } };
});
