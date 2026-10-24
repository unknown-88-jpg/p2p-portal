import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { catatCron } from '@/server/admin';
import { jalankanBackup } from '@/server/backup';
import { productionBackupDrive } from '@/server/deps';
import { authDeps } from '@/server/runtime';
import { bearerOk } from '../../_lib/cron-auth';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** F3-E: backup harian spreadsheet ke Shared Drive (Vercel Cron, Bearer CRON_SECRET). Folder belum diisi -> dilewati (tercatat di health). */
export const GET = route({ method: 'GET', session: 'none' }, async ({ req }) => {
  if (!bearerOk(req)) throw new AppError('UNAUTHENTICATED', 'Tidak berwenang.');
  const d = authDeps();
  const drive = productionBackupDrive();
  if (!drive) { await catatCron(d, 'backup', 'dilewati'); return { body: { dilewati: 'DRIVE_BACKUP_ID belum diisi' } }; }
  try {
    const hasil = await jalankanBackup({ drive, store: d.store, clock: d.clock }, env().SHEET_ID);
    await catatCron(d, 'backup', 'ok');
    return { body: { hasil } };
  } catch (e) { await catatCron(d, 'backup', 'gagal'); throw e; }
});
