import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { catatCron } from '@/server/admin';
import { authDeps } from '@/server/runtime';
import { kirimDigestManager } from '@/server/wa-digest';
import { kirimDigestFinance } from '@/server/wa-digest-finance';
import { bearerOk } from '../../_lib/cron-auth';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Digest approval ke Manager + (F2-F) digest antrean Finance. Dipicu jadwal eksternal (GitHub Actions; cron Hobby cuma 1x/hari). Bearer CRON_SECRET.
 * Masing-masing digest berdiri sendiri: yang satu gagal tidak menghentikan yang lain.
 */
export const GET = route({ method: 'GET', session: 'none' }, async ({ req }) => {
  if (!bearerOk(req)) throw new AppError('UNAUTHENTICATED', 'Tidak berwenang.');
  const hasil = await kirimDigestManager(authDeps()).catch((e: unknown) => { logger.error('digest_manager_error', { err: (e as Error).message }); return { galat: true }; });
  const finance = await kirimDigestFinance(authDeps()).catch((e: unknown) => { logger.error('digest_finance_error', { err: (e as Error).message }); return { galat: true }; });
  await catatCron(authDeps(), 'digest', 'galat' in hasil || 'galat' in finance ? 'gagal' : 'ok');
  return { body: { hasil, finance } };
});
