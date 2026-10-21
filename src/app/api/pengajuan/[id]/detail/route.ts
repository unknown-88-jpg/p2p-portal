import { detail } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Detail dokumen + timeline. Pemilik, Manager berwenang, Finance+ (I13); selain itu 404. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({
  body: await detail(authDeps(), session!, idTrxFromPath(req, 1)),
}));
