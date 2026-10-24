import { riwayatBayar } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F2-F: riwayat pembayaran (cicilan) dari Trx_Payment_Log + total & sisa. Akses sama dengan detail dokumen (I13; selain itu 404). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({
  body: await riwayatBayar(authDeps(), session!, idTrxFromPath(req, 1)),
}));
