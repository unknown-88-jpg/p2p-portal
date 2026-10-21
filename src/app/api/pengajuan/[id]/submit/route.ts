import { submitPengajuan } from '@/server/pengajuan';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajukan ke Manager. Aksi uang: header `Idempotency-Key` WAJIB (UUID dari klien, dipakai ulang saat retry). */
export const POST = route({ method: 'POST', session: 'required' }, async ({ req, session }) => ({
  body: { hasil: await submitPengajuan(authDeps(), session!, idTrxFromPath(req, 1), idempotencyKeyOf(req)) },
}));
