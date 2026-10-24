import { bayar } from '@/server/finance-aksi';
import { bayarSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';
import { idempotencyKeyOf } from '../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-E: pembayaran 1..30 dokumen (Finance Staff). Step-up password, Idempotency-Key wajib; I4 gerbang, I5 anti-overpay dari log. */
export const POST = route({ method: 'POST', session: 'required', schema: bayarSchema }, async ({ req, body, session, token }) => ({
  body: { hasil: await bayar(authDeps(), session!, token!, body, idempotencyKeyOf(req)) },
}));
