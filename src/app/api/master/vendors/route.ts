import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { vendorListTampilan } from '@/server/master';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tipe = z.enum(['Trade', 'Non-Trade']);

/** Daftar pilihan vendor (TAMPILAN): cache 15 dtk + versi tab (M8 F-09). Submit tetap memvalidasi vendor dari baca SEGAR (I8), jadi daftar basi tak bisa meloloskan vendor tak-Approved. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req }) => {
  const t = tipe.safeParse(new URL(req.url).searchParams.get('tipe'));
  if (!t.success) throw new AppError('VALIDATION', 'Parameter tipe harus Trade atau Non-Trade.');
  return { body: { vendors: await vendorListTampilan(authDeps(), t.data) } };
});
