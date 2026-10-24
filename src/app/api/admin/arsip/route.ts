import { cekArsip } from '@/server/admin';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-E: kandidat arsip (Paid > 18 bulan), baca saja. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: await cekArsip(authDeps(), session!) }));
