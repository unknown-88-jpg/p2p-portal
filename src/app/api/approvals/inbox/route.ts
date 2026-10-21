import { inbox } from '@/server/approval';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Antrean persetujuan Manager (Level 2): Submitted & berwenang atas brand/dept, tertua dulu. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: { items: await inbox(authDeps(), session!) } }));
