import { laporanAging } from '@/server/laporan';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-D: aging AP + outstanding per vendor. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: await laporanAging(authDeps(), session!) }));
