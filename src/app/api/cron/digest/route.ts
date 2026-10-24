import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { authDeps } from '@/server/runtime';
import { kirimDigestManager } from '@/server/wa-digest';
import { kirimDigestFinance } from '@/server/wa-digest-finance';
import { bearerOk } from '../../_lib/cron-auth';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Digest approval ke Manager + (F2-F) digest antrean Finance. Dipicu jadwal eksternal (GitHub Actions; cron Hobby cuma 1x/hari). Bearer CRON_SECRET.
 * Digest Finance gagal tidak menggagalkan digest Manager (dan sebaliknya hasil Manager tetap dilaporkan).
 */
export const GET = route({ method: 'GET', session: 'none' }, async ({ req }) => {
  if (!bearerOk(req)) throw new AppError('UNAUTHENTICATED', 'Tidak berwenang.');
  const hasil = await kirimDigestManager(authDeps());
  const finance = await kirimDigestFinance(authDeps()).catch((e: unknown) => { logger.error('digest_finance_error', { err: (e as Error).message }); return { galat: true }; });
  return { body: { hasil, finance } };
});
