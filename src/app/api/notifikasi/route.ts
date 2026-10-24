import { notifikasiSaya } from '@/server/notifikasi';
import { authDeps } from '@/server/runtime';
import { route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lonceng bar atas: butir "perlu tindakan" untuk pengguna yang login (semua peran). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: await notifikasiSaya(authDeps(), session!) }));
