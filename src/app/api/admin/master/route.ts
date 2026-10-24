import { cekMaster } from '@/server/admin';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C: ringkasan & validator master (baca saja; edit tetap di Sheet). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: await cekMaster(authDeps(), session!) }));
