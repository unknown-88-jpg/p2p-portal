import { SESSION_ABSOLUTE_MS, login, loginSchema } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { route, sessionCookie } from '../../_lib/handler';
import { capabilitiesOf } from '@/domain/capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route({ method: 'POST', session: 'none', schema: loginSchema }, async ({ body, ip }) => {
  const r = await login(authDeps(), body, ip);
  return {
    body: { user: r.user, roles: r.roles, capabilities: capabilitiesOf(r.roles) },
    headers: { 'set-cookie': sessionCookie(r.token, Math.floor(SESSION_ABSOLUTE_MS / 1000)) },
  };
});
