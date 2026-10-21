import { Redis } from '@upstash/redis';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RedisPort } from '@/ports/redis';

const CAD = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const SETMAX = `local c = tonumber(redis.call('get', KEYS[1]) or '0'); local n = tonumber(ARGV[1]); if n > c then redis.call('set', KEYS[1], ARGV[1]); return n else return c end`;

/** Gangguan jaringan/Upstash -> UPSTREAM_BUSY seragam (kontrak RedisPort: kegagalan konektivitas = AppError UPSTREAM_BUSY, tanpa detail ke klien). */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    logger.error('redis_error', { err: (e as Error).message });
    throw new AppError('UPSTREAM_BUSY', 'Koordinasi data tidak tersedia. Coba lagi sebentar.', undefined, 3);
  }
}

/** Adapter Upstash REST. automaticDeserialization:false -> nilai selalu string persis seperti yang ditulis (token lock, JSON kita sendiri). */
export class UpstashRedis implements RedisPort {
  private r: Redis;
  constructor(url = env().UPSTASH_REDIS_REST_URL, token = env().UPSTASH_REDIS_REST_TOKEN) {
    this.r = new Redis({ url, token, automaticDeserialization: false });
  }
  async get(key: string): Promise<string | null> { return guard(async () => (await this.r.get<string | null>(key)) ?? null); }
  async set(key: string, value: string, opts?: { pxMs?: number }): Promise<void> {
    await guard(async () => { if (opts?.pxMs) await this.r.set(key, value, { px: opts.pxMs }); else await this.r.set(key, value); });
  }
  async setNx(key: string, value: string, pxMs: number): Promise<boolean> {
    return guard(async () => (await this.r.set(key, value, { nx: true, px: pxMs })) === 'OK');
  }
  async del(key: string): Promise<void> { await guard(() => this.r.del(key)); }
  async compareAndDelete(key: string, expected: string): Promise<boolean> {
    return guard(async () => Number(await this.r.eval(CAD, [key], [expected])) === 1);
  }
  async incr(key: string): Promise<number> { return guard(() => this.r.incr(key)); }
  async pexpire(key: string, ms: number): Promise<void> { await guard(() => this.r.pexpire(key, ms)); }
  async pttl(key: string): Promise<number> { return guard(() => this.r.pttl(key)); }
  async setMax(key: string, n: number): Promise<number> { return guard(async () => Number(await this.r.eval(SETMAX, [key], [String(n)]))); }
}
