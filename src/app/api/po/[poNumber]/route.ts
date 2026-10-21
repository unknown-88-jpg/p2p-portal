import { AppError } from '@/lib/errors';
import { getPoDetails } from '@/server/po';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** searchPODetails. 404 = PO tidak ada; 503 UPSTREAM_BUSY = DB_PO sedang disinkronkan (jangan tafsirkan sebagai "tidak ada"). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req }) => {
  const seg = new URL(req.url).pathname.split('/').pop() ?? '';
  let po: string;
  try { po = decodeURIComponent(seg).trim(); } catch { throw new AppError('VALIDATION', 'Nomor P.O tidak valid.'); }
  if (!po || po.length > 60) throw new AppError('VALIDATION', 'Nomor P.O tidak valid.');
  const ex = new URL(req.url).searchParams.get('excludeIdTrx')?.slice(0, 40) || undefined;
  return { body: { po: await getPoDetails(authDeps(), po, ex) } };
});
