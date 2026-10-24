import { authDeps } from '@/server/runtime';
import { kirimWaFinance } from '@/server/wa-manual-finance';
import { route } from '../../../_lib/handler';
import { idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tahap persetujuan Finance: kirim pengingat WA ke Fin. Mgr, lalu (setelah Fin. Mgr setuju) ke CFO. Maks. 1x per tujuan per siklus; ke-2 = 429. */
export const POST = route({ method: 'POST', session: 'required' }, async ({ req, session }) => ({
  body: { hasil: await kirimWaFinance(authDeps(), session!, idTrxFromPath(req, 1)) },
}));
