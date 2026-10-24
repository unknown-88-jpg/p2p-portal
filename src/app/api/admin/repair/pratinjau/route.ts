import { pratinjauRepair } from '@/server/admin';
import { pratinjauRepairSchema } from '@/server/admin-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C repair langkah 1-2: snapshot rencana perubahan untuk dikonfirmasi (tidak menulis apa pun). */
export const POST = route({ method: 'POST', session: 'required', schema: pratinjauRepairSchema }, async ({ body, session }) => ({
  body: await pratinjauRepair(authDeps(), session!, body.jenis),
}));
