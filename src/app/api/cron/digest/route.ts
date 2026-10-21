import { AppError } from '@/lib/errors';
import { authDeps } from '@/server/runtime';
import { kirimDigestManager } from '@/server/wa-digest';
import { bearerOk } from '../../_lib/cron-auth';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Digest approval ke Manager. Dipicu jadwal eksternal (GitHub Actions; cron Hobby cuma 1x/hari). Bearer CRON_SECRET. */
export const GET = route({ method: 'GET', session: 'none' }, async ({ req }) => {
  if (!bearerOk(req)) throw new AppError('UNAUTHENTICATED', 'Tidak berwenang.');
  return { body: { hasil: await kirimDigestManager(authDeps()) } };
});
