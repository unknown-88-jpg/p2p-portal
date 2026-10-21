import type { Clock, Rng } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RedisPort } from '@/ports/redis';

export const LOCK_TTL_MS = 30_000;
export const MONEY_WAIT_MS = 2_000;     // aksi uang: gagal cepat (design 4.3b)
export const STANDARD_WAIT_MS = 10_000; // aksi biasa: boleh antre lebih lama

export interface LockOpts { clock: Clock; rng: Rng; ttlMs?: number; waitMs?: number; pollMinMs?: number; pollMaxMs?: number }

export interface LockHandle {
  readonly keys: readonly string[];
  readonly acquiredAt: number;
  readonly ttlMs: number;
  /** true bila SEMUA kunci masih dipegang token kita (belum kedaluwarsa/dicuri). */
  holdsAll(): Promise<boolean>;
  release(): Promise<void>;
}

const k = (name: string): string => `lock:${name}`;

/**
 * Ambil beberapa lock sekaligus. Kunci diurutkan + dedup (dua aksi dengan kunci berlawanan urutan tidak deadlock).
 * Gagal sebagian -> lepas yang sudah dipegang. Redis bermasalah -> UPSTREAM_BUSY (fail-closed: tanpa lock tidak boleh menulis).
 */
export async function acquireLocks(redis: RedisPort, names: readonly string[], o: LockOpts): Promise<LockHandle> {
  const keys = [...new Set(names)].sort();
  if (keys.length === 0) throw new Error('acquireLocks: minimal satu kunci');
  const ttlMs = o.ttlMs ?? LOCK_TTL_MS;
  const waitMs = o.waitMs ?? STANDARD_WAIT_MS;
  const pmin = o.pollMinMs ?? 100;
  const pmax = o.pollMaxMs ?? 300;
  const token = crypto.randomUUID();
  const held: string[] = [];
  const startedAt = o.clock.now();
  const releaseHeld = async (): Promise<void> => {
    for (const key of held) { try { await redis.compareAndDelete(k(key), token); } catch { /* TTL yang membersihkan */ } }
  };
  try {
    for (const key of keys) {
      for (;;) {
        if (await redis.setNx(k(key), token, ttlMs)) { held.push(key); break; }
        if (o.clock.now() - startedAt >= waitMs) {
          throw new AppError('CONFLICT', 'Data sedang diproses pengguna lain. Coba lagi sebentar.', undefined, 2);
        }
        await o.clock.sleep(Math.round(pmin + o.rng() * (pmax - pmin)));
      }
    }
  } catch (e) {
    await releaseHeld();
    if (e instanceof AppError) throw e;
    logger.error('lock_redis_error', { err: (e as Error).message });
    throw new AppError('UPSTREAM_BUSY', 'Koordinasi data tidak tersedia. Coba lagi sebentar.', undefined, 3);
  }
  const acquiredAt = o.clock.now();
  return {
    keys, acquiredAt, ttlMs,
    async holdsAll() {
      try {
        for (const key of keys) if ((await redis.get(k(key))) !== token) return false;
        return true;
      } catch { return false; }
    },
    async release() { await releaseHeld(); },
  };
}
