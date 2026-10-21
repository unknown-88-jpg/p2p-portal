import { AppError } from '@/lib/errors';
import { bersihkanYatim } from '@/server/lampiran';
import { authDeps } from '@/server/runtime';
import { bearerOk } from '../../_lib/cron-auth';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Housekeeping harian (Vercel Cron mengirim `Authorization: Bearer $CRON_SECRET`): trash file lampiran yatim > 24 jam. */
export const GET = route({ method: 'GET', session: 'none' }, async ({ req }) => {
  if (!bearerOk(req)) throw new AppError('UNAUTHENTICATED', 'Tidak berwenang.');
  return { body: { hasil: await bersihkanYatim(authDeps()) } };
});
