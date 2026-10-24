import { authDeps } from '@/server/runtime';
import { antreanVendor, daftarVendor, vendorSaya } from '@/server/vendor';
import { daftarVendorSchema } from '@/server/vendor-schema';
import { route } from '../_lib/handler';
import { idempotencyKeyOf } from '../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-A: `?status=pending` = antrean pengesahan (Finance Staff); tanpa parameter = vendor yang saya daftarkan. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => {
  const pending = new URL(req.url).searchParams.get('status') === 'pending';
  return { body: { items: pending ? await antreanVendor(authDeps(), session!) : await vendorSaya(authDeps(), session!) } };
});

/** F3-A: daftar vendor baru (status Pending, menunggu pengesahan Finance). */
export const POST = route({ method: 'POST', session: 'required', schema: daftarVendorSchema }, async ({ req, body, session }) => ({
  body: { hasil: await daftarVendor(authDeps(), session!, body, idempotencyKeyOf(req)) },
}));
