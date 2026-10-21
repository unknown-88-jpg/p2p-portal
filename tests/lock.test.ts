import { describe, expect, it } from 'vitest';
import { acquireLocks } from '@/infra/lock';
import { AppError } from '@/lib/errors';
import { seeded, world } from './helpers';

const opts = (w: ReturnType<typeof world>, extra = {}) => ({ clock: w.clock, rng: seeded(1), ...extra });

describe('lock', () => {
  it('mutual exclusion: yang kedua gagal CONFLICT selama lock dipegang, berhasil setelah dilepas', async () => {
    const w = world();
    const a = await acquireLocks(w.redis, ['trx:1'], opts(w));
    await expect(acquireLocks(w.redis, ['trx:1'], opts(w, { waitMs: 500 }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await a.release();
    const b = await acquireLocks(w.redis, ['trx:1'], opts(w, { waitMs: 500 }));
    expect(await b.holdsAll()).toBe(true);
  });

  it('release hanya oleh pemilik: lock yang sudah kedaluwarsa & diambil orang lain TIDAK terhapus oleh pemilik lama', async () => {
    const w = world();
    const a = await acquireLocks(w.redis, ['k'], opts(w, { ttlMs: 1000 }));
    w.clock.advance(1500);                                   // TTL habis
    const b = await acquireLocks(w.redis, ['k'], opts(w, { waitMs: 100 }));
    expect(await a.holdsAll()).toBe(false);                  // A sadar sudah kehilangan lock
    await a.release();                                       // rilis telat dari A
    expect(await b.holdsAll()).toBe(true);                   // lock B utuh
  });

  it('kunci berlawanan urutan tidak deadlock (diurutkan)', async () => {
    const w = world();
    w.redis.latencyMs = 5;                                   // paksa interleaving: tanpa pengurutan, ini deadlock deterministik
    const work = async (keys: string[]): Promise<void> => {
      const h = await acquireLocks(w.redis, keys, opts(w, { waitMs: 600_000 }));
      await w.clock.sleep(30);
      await h.release();
    };
    const t0 = w.clock.now();
    const jobs = Array.from({ length: 20 }, (_, i) => work(i % 2 ? ['a', 'b', 'c'] : ['c', 'b', 'a']));
    await expect(Promise.all(jobs)).resolves.toHaveLength(20);
    expect(w.clock.now() - t0).toBeLessThan(10_000);          // deadlock baru lepas setelah TTL 30 dtk habis; urut = selesai cepat
  });

  it('aksi uang gagal cepat (~2 dtk) saat berebut', async () => {
    const w = world();
    await acquireLocks(w.redis, ['trx:9'], opts(w));
    const t0 = w.clock.now();
    await expect(acquireLocks(w.redis, ['trx:9'], opts(w, { waitMs: 2000 }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(w.clock.now() - t0).toBeGreaterThanOrEqual(2000);
    expect(w.clock.now() - t0).toBeLessThan(2400);
  });

  it('gagal sebagian melepas lock yang sudah terambil', async () => {
    const w = world();
    const b = await acquireLocks(w.redis, ['b'], opts(w));
    await expect(acquireLocks(w.redis, ['a', 'b'], opts(w, { waitMs: 300 }))).rejects.toBeInstanceOf(AppError);
    expect(w.redis.has('lock:a')).toBe(false);
    expect(await b.holdsAll()).toBe(true);
  });

  it('Redis mati -> UPSTREAM_BUSY (fail-closed), tidak ada lock tersisa', async () => {
    const w = world();
    w.redis.down = true;
    await expect(acquireLocks(w.redis, ['x'], opts(w))).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
  });
});
