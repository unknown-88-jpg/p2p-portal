import type { Clock } from '@/lib/clock';
import { logger } from '@/lib/logger';
import type { RedisPort } from '@/ports/redis';

interface Boxed<T> { v: T; at: number }

/**
 * Cache baca (data master). Fitur: single-flight per instance, stale-if-error, invalidasi per-namespace lewat penanda versi (`ci:{ns}`).
 * Redis mati -> langsung ke loader (cache hanya optimasi). Cache TIDAK PERNAH dipakai untuk keputusan tulis (design 4.3 langkah 4).
 */
export class Cache {
  private flights = new Map<string, Promise<unknown>>();
  constructor(private redis: RedisPort, private clock: Clock) {}

  private async version(ns: string): Promise<string> {
    try { return (await this.redis.get(`ci:${ns}`)) ?? '0'; } catch { return '0'; }
  }
  /** Buang semua entri namespace (dipanggil setelah tulis yang relevan). */
  async invalidate(ns: string): Promise<void> {
    try { await this.redis.incr(`ci:${ns}`); } catch (e) { logger.warn('cache_invalidate_failed', { ns, msg: (e as Error).message }); }
  }

  async get<T>(ns: string, key: string, o: { ttlMs: number; staleMs?: number }, load: () => Promise<T>): Promise<T> {
    const ver = await this.version(ns);
    const rk = `cache:${ns}:${ver}:${key}`;
    const flightKey = rk;
    const inflight = this.flights.get(flightKey);
    if (inflight) return inflight as Promise<T>;
    const p = this.fill(rk, o, load).finally(() => this.flights.delete(flightKey));
    this.flights.set(flightKey, p);
    return p;
  }

  private async fill<T>(rk: string, o: { ttlMs: number; staleMs?: number }, load: () => Promise<T>): Promise<T> {
    const stale = o.staleMs ?? 0;
    let box: Boxed<T> | null = null;
    try {
      const raw = await this.redis.get(rk);
      if (raw) box = JSON.parse(raw) as Boxed<T>;
    } catch { /* tanpa cache */ }
    const now = this.clock.now();
    if (box && now - box.at < o.ttlMs) return box.v;
    try {
      const v = await load();
      try { await this.redis.set(rk, JSON.stringify({ v, at: this.clock.now() } satisfies Boxed<T>), { pxMs: o.ttlMs + stale }); } catch { /* abaikan */ }
      return v;
    } catch (e) {
      if (box && now - box.at < o.ttlMs + stale) {
        logger.warn('cache_stale_served', { rk });
        return box.v;
      }
      throw e;
    }
  }
}
