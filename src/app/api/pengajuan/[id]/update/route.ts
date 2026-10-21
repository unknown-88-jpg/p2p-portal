import { updateDraft } from '@/server/pengajuan';
import { pengajuanSchema } from '@/server/pengajuan-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ubah draft / revisi (hanya pemilik, hanya status Draft atau Revision Needed). */
export const POST = route({ method: 'POST', session: 'required', schema: pengajuanSchema }, async ({ req, body, session }) => ({
  body: { hasil: await updateDraft(authDeps(), session!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req)) },
}));
