import { getMine } from '@/server/pengajuan';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';
import { idTrxFromPath } from '../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Detail dokumen milik sendiri (404 bila bukan milik/tidak ada). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({ body: { pengajuan: await getMine(authDeps(), session!, idTrxFromPath(req)) } }));
