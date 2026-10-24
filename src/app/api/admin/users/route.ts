import { daftarUser, simpanUser } from '@/server/admin';
import { simpanUserSchema } from '@/server/admin-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';
import { idempotencyKeyOf } from '../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C: daftar user Master_User_TTD (System Admin). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: { items: await daftarUser(authDeps(), session!) } }));

/** F3-C: tambah / ubah satu baris user. Wajib step-up password. */
export const POST = route({ method: 'POST', session: 'required', schema: simpanUserSchema }, async ({ req, body, session, token }) => ({
  body: { hasil: await simpanUser(authDeps(), session!, token!, body, idempotencyKeyOf(req)) },
}));
