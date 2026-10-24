import { cekIntegritas } from '@/server/admin';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C: port auditDataIntegrity (baca saja) — rekening, rekonsiliasi pembayaran, PO/SJ, vendor, user. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: { temuan: await cekIntegritas(authDeps(), session!) } }));
