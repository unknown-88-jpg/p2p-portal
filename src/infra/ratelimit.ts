import type { Clock } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RedisPort } from '@/ports/redis';

export type QuotaKind = 'read' | 'write';
export interface Quota { take(kind: QuotaKind): Promise<void> }

const WINDOW_MS = 60_000;

/**
 * Pembatas kuota Google global (design 4.3): sliding-window counter di Redis, ~45/mnt per jenis (kuota asli 60).
 * Kalau penuh: tunggu sebentar (maks maxWaitMs) lalu UPSTREAM_BUSY. Redis mati -> FAIL-OPEN (hanya untuk limiter ini;
 * Google tetap membalas 429 dan retry-budget yang menahan).
 */
export class GoogleQuota implements Quota {
  constructor(private redis: RedisPort, private clock: Clock, private limit = 45, private maxWaitMs = 3_000) {}

  private async estimate(kind: QuotaKind): Promise<{ over: boolean }> {
    const now = this.clock.now();
    const win = Math.floor(now / WINDOW_MS);
    const frac = (now % WINDOW_MS) / WINDOW_MS;
    const curKey = `rl:${kind}:${win}`;
    const cur = await this.redis.incr(curKey);
    if (cur === 1) await this.redis.pexpire(curKey, WINDOW_MS * 2);
    const prev = Number((await this.redis.get(`rl:${kind}:${win - 1}`)) ?? 0);
    return { over: prev * (1 - frac) + cur > this.limit };
  }

  async take(kind: QuotaKind): Promise<void> {
    const started = this.clock.now();
    for (;;) {
      let over: boolean;
      try { over = (await this.estimate(kind)).over; }
      catch (e) { logger.warn('ratelimit_redis_down', { err: (e as Error).message }); return; }
      if (!over) return;
      if (this.clock.now() - started >= this.maxWaitMs) throw new AppError('UPSTREAM_BUSY', 'Sistem sedang padat. Coba lagi sebentar.', undefined, 5);
      await this.clock.sleep(500);
    }
  }
}
