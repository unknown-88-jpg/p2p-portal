import { bukaLampiran } from '@/server/lampiran';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';
import { idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lampiran invoice lewat proxy ber-otorisasi (I13): pemilik, Manager berwenang, atau Finance+. Di-stream, tidak pernah di-buffer penuh. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({
  raw: await bukaLampiran(authDeps(), session!, idTrxFromPath(req, 1)),
}));
