import { laporanRekap, parseQuery, rekapQuery } from '@/server/laporan';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-D: rekap per brand/dept/COA/budget/vendor untuk satu periode (tanggal invoice, WIB). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({ body: await laporanRekap(authDeps(), session!, parseQuery(req, rekapQuery)) }));
