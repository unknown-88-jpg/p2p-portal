import { verifikasiPajak } from '@/server/finance-aksi';
import { verifikasiPajakSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-B: loloskan verifikasi pajak (Finance Staff). Idempotency-Key & etag wajib; nominal dihitung ulang server (I2), I6 blokir. */
export const POST = route({ method: 'POST', session: 'required', schema: verifikasiPajakSchema }, async ({ req, body, session }) => ({
  body: { hasil: await verifikasiPajak(authDeps(), session!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req)) },
}));
