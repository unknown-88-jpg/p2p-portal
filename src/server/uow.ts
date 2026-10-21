import type { Clock, Rng } from '@/lib/clock';
import { naikkanVersi } from './view-cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { acquireLocks, LOCK_TTL_MS, MONEY_WAIT_MS, STANDARD_WAIT_MS } from '@/infra/lock';
import { IDEM_KEY_RE, Idempotency, QUIESCE_MS, marker, scopeHash } from '@/infra/idempotency';
import { AUDIT_LOG } from '@/repo/schema';
import { AmbiguousWriteError, type Mutation, type TableStore } from '@/ports/store';
import type { RedisPort } from '@/ports/redis';
import { isAuditMutation } from './audit';

export interface UowDeps { redis: RedisPort; store: TableStore; clock: Clock; rng: Rng }

export interface ActionSpec<T> {
  name: string;
  actor: string;
  /** nama kunci lock (trx:{id}, po:{no}, inv:..., vendor-rek:..., seq:...). Diurutkan otomatis. */
  lockKeys: readonly string[];
  /** aksi uang: wajib Idempotency-Key, gagal cepat saat lock berebut */
  money?: boolean;
  idempotencyKey?: string;
  ttlMs?: number;
  /** override lama menunggu lock (default: uang 2 dtk, lainnya 10 dtk) */
  waitMs?: number;
  /** sisa umur lock minimum saat flush (design 4.3b: >= 5 dtk) */
  marginMs?: number;
  /** Baca segar + terapkan aturan -> daftar mutasi + hasil. Dijalankan DI DALAM lock. Hasil harus JSON-serializable. */
  execute: (ctx: { store: TableStore; clock: Clock }) => Promise<{ mutations: Mutation[]; result: T }>;
}

const FLUSH_MARGIN_MS = 5_000;

/** Pengganti withLock(fn): idempotensi -> lock multi-kunci -> baca segar+aturan -> guard deadline -> SATU batch atomik (+audit) -> lepas lock. */
export async function runAction<T>(d: UowDeps, a: ActionSpec<T>): Promise<T> {
  if (a.money && !a.idempotencyKey) throw new AppError('VALIDATION', 'Idempotency-Key wajib untuk aksi ini.');
  if (a.idempotencyKey && !IDEM_KEY_RE.test(a.idempotencyKey)) throw new AppError('VALIDATION', 'Idempotency-Key tidak valid.');

  const idem = new Idempotency(d.redis, d.clock);
  const hash = a.idempotencyKey ? scopeHash(a.actor, a.name, a.idempotencyKey) : null;
  const mark = a.idempotencyKey && hash ? marker(hash, a.idempotencyKey) : null;
  let ambiguousFirst = false;
  let owns = false;        // true = record idempotensi saat ini milik run ini (boleh dibersihkan bila gagal tegas)
  let ambiguousOut = false; // run ini sendiri berakhir ambigu -> record dipertahankan

  const guarded = async <R>(fn: () => Promise<R>): Promise<R> => {
    try { return await fn(); }
    catch (e) { if (e instanceof AppError) throw e; logger.error('coordination_error', { err: (e as Error).message }); throw new AppError('UPSTREAM_BUSY', 'Koordinasi data tidak tersedia. Coba lagi sebentar.', undefined, 3); }
  };

  if (hash) {
    const b = await guarded(() => idem.begin(hash));
    if (b.kind === 'replay') return b.result as T;
    owns = b.kind === 'new';
    if (b.kind === 'ambiguous') {
      if (d.clock.now() - b.at < QUIESCE_MS) throw new AppError('CONFLICT', 'Permintaan sebelumnya masih diperiksa. Coba lagi sebentar.', undefined, Math.ceil(QUIESCE_MS / 1000));
      ambiguousFirst = true;
    }
  }

  const ttlMs = a.ttlMs ?? LOCK_TTL_MS;
  let lock;
  try {
    lock = await acquireLocks(d.redis, a.lockKeys, { clock: d.clock, rng: d.rng, ttlMs, waitMs: a.waitMs ?? (a.money ? MONEY_WAIT_MS : STANDARD_WAIT_MS) });
  } catch (e) {
    if (hash && owns) await idem.clear(hash).catch(() => undefined);
    throw e;
  }

  let written = false;
  try {
    if (hash && ambiguousFirst) {
      // Di dalam lock: apakah batch yang ambigu tadi ternyata berlaku? Cek penanda di Audit_Log.
      const cur = await guarded(() => idem.current(hash));
      if (cur?.state === 'done') return cur.result as T;
      if (cur && cur.state === 'inflight') throw new AppError('CONFLICT', 'Permintaan yang sama sedang diproses.', undefined, 2);
      const notes = await d.store.readColumn(AUDIT_LOG, 'Notes');
      if (notes.some((n) => typeof n === 'string' && n.includes(mark!))) {
        const recovered = { ok: true, recovered: true } as unknown as T;
        await idem.done(hash, recovered).catch(() => undefined);
        return recovered;
      }
      await guarded(() => idem.takeOver(hash));
      owns = true;
    }

    const { mutations, result } = await a.execute({ store: d.store, clock: d.clock });

    if (!mutations.some(isAuditMutation)) throw new AppError('INTERNAL', `Aksi ${a.name} tidak menyertakan audit (I17).`);
    const batch: Mutation[] = [...mutations];
    if (mark) {
      const i = batch.findIndex(isAuditMutation);
      const m = batch[i]!;
      if (m.kind === 'append') batch[i] = { ...m, cells: { ...m.cells, Notes: `${String(m.cells.Notes ?? '')} ${mark}`.trim() } };
    }

    // Guard deadline: lock harus masih milik kita dan sisa umurnya cukup untuk flush.
    const elapsed = d.clock.now() - lock.acquiredAt;
    if (elapsed > ttlMs - (a.marginMs ?? FLUSH_MARGIN_MS) || !(await lock.holdsAll())) {
      throw new AppError('UPSTREAM_BUSY', 'Proses terlalu lama, tidak ada perubahan yang disimpan. Coba lagi.', undefined, 3);
    }

    try {
      await d.store.applyBatch(batch);
      written = true;
      await naikkanVersi(d.redis, batch.map((m) => m.schema.tab));
    } catch (e) {
      if (e instanceof AmbiguousWriteError) {
        ambiguousOut = true;
        await naikkanVersi(d.redis, batch.map((m) => m.schema.tab)); // mungkin berlaku: tampilan jangan memakai salinan lama
        if (hash) await idem.ambiguous(hash).catch(() => undefined);
        throw new AppError('UPSTREAM_BUSY', 'Hasil penyimpanan belum pasti. Ulangi dengan permintaan yang sama untuk memastikan.', undefined, 10);
      }
      throw e;
    }
    if (hash) await idem.done(hash, result).catch((e: unknown) => logger.error('idem_done_failed', { err: (e as Error).message }));
    return result;
  } catch (e) {
    if (hash && owns && !written && !ambiguousOut) await idem.clear(hash).catch(() => undefined);
    throw e;
  } finally {
    await lock.release();
  }
}
