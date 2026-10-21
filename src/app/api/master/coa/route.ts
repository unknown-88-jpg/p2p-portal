import { getCoa } from '@/server/master';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route({ method: 'GET', session: 'required' }, async () => ({ body: { coa: await getCoa(authDeps()) } }));
