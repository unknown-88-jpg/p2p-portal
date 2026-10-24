import { antreanFinance } from '@/server/finance';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-A: antrean Finance per tahap (`?stage=pajak|persetujuan|jurnal|bayar`, opsional). Hanya L3/L4/L5; lainnya 403. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({
  body: await antreanFinance(authDeps(), session!, new URL(req.url).searchParams.get('stage')),
}));
