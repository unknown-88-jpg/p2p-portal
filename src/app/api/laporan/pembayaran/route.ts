import { laporanPembayaran, parseQuery, rentangQuery } from '@/server/laporan';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-D: log pembayaran per tanggal bayar (WIB). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({ body: await laporanPembayaran(authDeps(), session!, parseQuery(req, rentangQuery)) }));
