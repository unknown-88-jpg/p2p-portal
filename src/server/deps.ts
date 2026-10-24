import { gfetchRaw } from '@/infra/google';
import { GoogleQuota } from '@/infra/ratelimit';
import { SheetsStore } from '@/infra/sheets-store';
import { UpstashRedis } from '@/infra/upstash-redis';
import { systemClock } from '@/lib/clock';
import { env } from '@/lib/env';
import type { UowDeps } from './uow';
import { loadAccounts } from './users';
import { bacaTampilan } from './view-cache';

/** Perakitan produksi. Dibuat per-request/per-skrip; tidak menyimpan state bisnis (instance Vercel boleh berganti kapan saja). */
export function productionDeps(): UowDeps {
  const redis = new UpstashRedis();
  const clock = systemClock;
  const rng = Math.random;
  const store = new SheetsStore({ spreadsheetId: env().SHEET_ID, fetch: gfetchRaw, clock, rng, quota: new GoogleQuota(redis, clock) });
  return { redis, store, clock, rng };
}

import { GoogleDrive } from '@/infra/drive';
import { DevLinkSender } from '@/infra/dev-link-sender';
import { LinkTokens } from '@/infra/link-tokens';
import { buildWaSender, NullWaSender } from '@/infra/wa-sender';
import { WaLinkSender } from '@/infra/wa-link-sender';
import { SessionStore } from '@/infra/session';
import type { AuthDeps } from './auth';

export function productionAuthDeps(): AuthDeps {
  const base = productionDeps();
  const e = env();
  const wa = buildWaSender(e, () => nomorUserAktif(base)); // trial: izin WA = env + user aktif sheet dummy
  const dev = new DevLinkSender(e.APP_ENV);
  return {
    ...base,
    drive: new GoogleDrive(e.DRIVE_ROOT_ID),
    sessions: new SessionStore(base.redis, base.clock, e.JWT_SECRET),
    tokens: new LinkTokens(base.redis, base.clock, e.JWT_SECRET),
    sender: wa instanceof NullWaSender ? dev : new WaLinkSender(wa, dev), // WA bila dikonfigurasi; gagal kirim -> DevLinkSender (trial saja)
    wa,
    baseUrl: e.APP_BASE_URL,
  };
}

/** F3-E: Drive untuk folder backup (null bila DRIVE_BACKUP_ID belum diisi). */
export function productionBackupDrive(): GoogleDrive | null {
  const id = env().DRIVE_BACKUP_ID;
  return id ? new GoogleDrive(id) : null;
}

/** Nomor HP user AKTIF di Master_User_TTD (cache tampilan 15 dtk). Dipakai allowlist WA mode trial. */
export async function nomorUserAktif(d: UowDeps): Promise<ReadonlySet<string>> {
  const akun = await loadAccounts({ readRows: (sc) => bacaTampilan(d, sc) });
  return new Set([...akun.values()].filter((a) => a.aktif && a.phone).map((a) => a.phone));
}
