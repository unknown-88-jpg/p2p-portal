import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { getOrg, picOf } from '@/server/master';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = z.object({ brand: z.string().max(80), dept: z.string().max(80) });

/** Struktur organisasi (brand -> divisi -> orang per level; tanpa email). Dengan ?brand=&dept= juga mengembalikan opsi PIC + peringatan. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req }) => {
  const org = await getOrg(authDeps());
  const sp = new URL(req.url).searchParams;
  if (sp.has('brand') || sp.has('dept')) {
    const r = q.safeParse({ brand: sp.get('brand') ?? '', dept: sp.get('dept') ?? '' });
    if (!r.success) throw new AppError('VALIDATION', 'Parameter brand/dept tidak valid.');
    return { body: { org, pic: picOf(org, r.data.brand, r.data.dept) } };
  }
  return { body: { org } };
});
