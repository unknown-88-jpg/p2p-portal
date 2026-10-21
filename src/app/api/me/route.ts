import { authDeps } from '@/server/runtime';
import { meDto, route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route({ method: 'GET', session: 'required' }, async ({ session, token }) => ({
  body: { ...meDto(session!), stepUp: await authDeps().sessions.hasStepUp(token!) },
}));
