import { cekLinkSchema, cekLinkSetPassword } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F-12: apakah link set-password masih berlaku? Hanya mengintip; tidak menghanguskan token dan tidak mengembalikan data akun. */
export const POST = route({ method: 'POST', session: 'none', schema: cekLinkSchema }, async ({ body, ip }) => {
  return { body: await cekLinkSetPassword(authDeps(), body, ip) };
});
