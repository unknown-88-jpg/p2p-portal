import { FakeClock } from '@/testing/fake-clock';
import { MemoryRedis } from '@/testing/memory-redis';
import { MemoryStore } from '@/testing/memory-store';
import { TRX_PENGAJUAN } from '@/repo/schema';
import type { UowDeps } from '@/server/uow';
import type { Rng } from '@/lib/clock';

/** RNG deterministik (LCG) agar jitter bisa direproduksi. */
export function seeded(seed = 42): Rng {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function world(latencyMs = 50) {
  const clock = new FakeClock();
  const redis = new MemoryRedis(clock);
  const store = new MemoryStore(clock, latencyMs);
  const deps: UowDeps = { redis, store, clock, rng: seeded() };
  return { clock, redis, store, deps };
}

export function trxRow(id: string, extra: Record<string, string | number | null> = {}): (string | number | null)[] {
  const r: (string | number | null)[] = Array.from({ length: TRX_PENGAJUAN.cols.length }, () => null);
  const set = (k: string, v: string | number | null): void => { r[TRX_PENGAJUAN.cols.findIndex((c) => c.key === k)] = v; };
  set('ID_TRX', id);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return r;
}
