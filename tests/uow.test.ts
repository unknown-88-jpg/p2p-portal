import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { auditMutation } from '@/server/audit';
import { findRowById } from '@/server/row-index';
import { runAction } from '@/server/uow';
import type { Mutation } from '@/ports/store';
import { trxRow, world } from './helpers';

const TP = colIndex(TRX_PENGAJUAN, 'TOTAL_PAID');
type W = ReturnType<typeof world>;

function seedTrx(w: W, n = 1): void {
  w.store.seed(TRX_PENGAJUAN, Array.from({ length: n }, (_, i) => trxRow(`TRD-${String(i + 1).padStart(5, '0')}`, { TOTAL_PAID: 0 })));
  w.store.seed(AUDIT_LOG, []);
}

/** Aksi contoh: baca segar TOTAL_PAID, +1, tulis + audit. */
function bump(w: W, id: string, extra: Partial<Parameters<typeof runAction>[1]> = {}) {
  return runAction(w.deps, {
    name: 'bump', actor: 'a@x.id', lockKeys: [`trx:${id}`], waitMs: 600_000,
    execute: async ({ store, clock }) => {
      const f = await findRowById(w.redis, store, TRX_PENGAJUAN, 'ID_TRX', id);
      if (!f) throw new AppError('NOT_FOUND', 'tidak ada');
      const cur = Number(f.data[TP] ?? 0);
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { TOTAL_PAID: cur + 1 } },
        auditMutation({ actor: 'a@x.id', idTrx: id, action: 'BUMP', field: 'TOTAL_PAID', oldValue: cur, newValue: cur + 1 }, clock),
      ];
      return { mutations, result: { total: cur + 1 } };
    },
    ...extra,
  });
}
const total = (w: W, i = 0): number => Number(w.store.rowsOf(TRX_PENGAJUAN)[i]![TP]);

describe('race: lock menjaga invarian', () => {
  it('20 aksi paralel pada satu dokumen => TOTAL_PAID persis 20 dan 20 baris audit', async () => {
    const w = world(); seedTrx(w);
    await Promise.all(Array.from({ length: 20 }, () => bump(w, 'TRD-00001')));
    expect(total(w)).toBe(20);
    expect(w.store.rowsOf(AUDIT_LOG)).toHaveLength(20);
  });

  it('KONTROL NEGATIF: tanpa lock, baca-ubah-tulis paralel kehilangan update (membuktikan tesnya sensitif)', async () => {
    const w = world(); seedTrx(w);
    const naive = async (): Promise<void> => {
      const r = (await w.store.readRow(TRX_PENGAJUAN, 2))!;
      await w.store.applyBatch([{ kind: 'update', schema: TRX_PENGAJUAN, row: 2, cells: { TOTAL_PAID: Number(r[TP]) + 1 } }]);
    };
    await Promise.all(Array.from({ length: 20 }, naive));
    expect(total(w)).toBeLessThan(20);
  });

  it('plafon PO lintas dokumen: 20 submit paralel, kuota 9 => tepat 9 diterima (lock po:{no})', async () => {
    const w = world(); w.store.seed(TRX_PENGAJUAN, []); w.store.seed(AUDIT_LOG, []);
    const submit = (i: number) => runAction(w.deps, {
      name: 'submit', actor: 'a@x.id', lockKeys: [`trx:new${i}`, 'po:PO-1'], waitMs: 600_000,
      execute: async ({ store, clock }) => {
        const rows = await store.readRows(TRX_PENGAJUAN);
        const used = rows.filter((r) => r[colIndex(TRX_PENGAJUAN, 'PO_NUMBER')] === 'PO-1').length;
        if (used >= 9) throw new AppError('RULE_VIOLATION', 'plafon PO habis');
        return { mutations: [
          { kind: 'append', schema: TRX_PENGAJUAN, cells: { ID_TRX: `T${i}`, PO_NUMBER: 'PO-1' } },
          auditMutation({ actor: 'a@x.id', idTrx: `T${i}`, action: 'SUBMIT' }, clock),
        ], result: { id: `T${i}` } };
      },
    });
    const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => submit(i)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(9);
    expect(res.filter((r) => r.status === 'rejected' && (r.reason as AppError).code === 'RULE_VIOLATION')).toHaveLength(11);
    expect(w.store.rowsOf(TRX_PENGAJUAN)).toHaveLength(9);
  });

  it('aksi uang: lawan berebut > 2 dtk => CONFLICT, hanya satu yang menulis', async () => {
    const w = world(5_000); seedTrx(w);                       // Google lambat 5 dtk per operasi
    const run = (k: string) => bump(w, 'TRD-00001', { money: true, idempotencyKey: k, waitMs: undefined });
    const res = await Promise.allSettled([run('key-aaaaaaaa'), run('key-bbbbbbbb')]);
    expect(res.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as AppError).code).toBe('CONFLICT');
    expect(total(w)).toBe(1);
  });
});

describe('deadline guard & lock hilang', () => {
  it('Google lambat melewati TTL-margin => abort TANPA menulis', async () => {
    const w = world(); seedTrx(w);
    await expect(runAction(w.deps, {
      name: 'slow', actor: 'a@x.id', lockKeys: ['trx:TRD-00001'],
      execute: async ({ clock }) => { await clock.sleep(26_000); return { mutations: [auditMutation({ actor: 'a', action: 'X' }, clock)], result: 1 }; },
    })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(w.store.writes).toBe(0);
  });

  it('lock hilang (Redis di-wipe) saat proses => abort TANPA menulis', async () => {
    const w = world(); seedTrx(w);
    await expect(runAction(w.deps, {
      name: 'lost', actor: 'a@x.id', lockKeys: ['trx:TRD-00001'],
      execute: async ({ clock }) => { w.redis.wipe(); return { mutations: [auditMutation({ actor: 'a', action: 'X' }, clock)], result: 1 }; },
    })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(w.store.writes).toBe(0);
  });

  it('Redis mati => aksi uang gagal tertutup, tidak menulis', async () => {
    const w = world(); seedTrx(w); w.redis.down = true;
    await expect(bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-12345678' })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(w.store.writes).toBe(0);
  });

  it('aksi tanpa baris audit ditolak (I17)', async () => {
    const w = world(); seedTrx(w);
    await expect(runAction(w.deps, {
      name: 'noaudit', actor: 'a', lockKeys: ['k'],
      execute: async () => ({ mutations: [{ kind: 'update', schema: TRX_PENGAJUAN, row: 2, cells: { TOTAL_PAID: 5 } }], result: 1 }),
    })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(total(w)).toBe(0);
  });

  it('aturan bisnis menolak (execute melempar) => tidak menulis, lock terlepas', async () => {
    const w = world(); seedTrx(w);
    await expect(bump(w, 'TRD-99999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(w.store.writes).toBe(0);
    expect(w.redis.has('lock:trx:TRD-99999')).toBe(false);
  });
});

describe('atomik & fault injection', () => {
  it('gagal tegas sebelum berlaku => tidak ada baris setengah jadi; ulang dengan kunci sama berhasil sekali', async () => {
    const w = world(); seedTrx(w);
    w.store.inject({ kind: 'beforeApply' });
    await expect(bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-11111111' })).rejects.toThrow();
    expect(total(w)).toBe(0);
    expect(w.store.rowsOf(AUDIT_LOG)).toHaveLength(0);
    await bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-11111111' });
    expect(total(w)).toBe(1);
  });

  it('batch dengan mutasi ke-2 tidak valid => mutasi ke-1 juga tidak berlaku', async () => {
    const w = world(); seedTrx(w);
    await expect(w.store.applyBatch([
      { kind: 'update', schema: TRX_PENGAJUAN, row: 2, cells: { TOTAL_PAID: 99 } },
      { kind: 'update', schema: TRX_PENGAJUAN, row: 2, cells: { BUKAN_KOLOM: 1 } },
    ])).rejects.toThrow();
    expect(total(w)).toBe(0);
  });

  it('idempotency: kunci sama dua kali => hasil sama, hanya satu tulisan', async () => {
    const w = world(); seedTrx(w);
    const a = await bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-22222222' });
    const b = await bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-22222222' });
    expect(b).toEqual(a);
    expect(total(w)).toBe(1);
    expect(w.store.writes).toBe(1);
  });

  it('idempotency: dua permintaan kunci sama bersamaan => satu jalan, satu CONFLICT', async () => {
    const w = world(); seedTrx(w);
    const res = await Promise.allSettled([
      bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-33333333' }),
      bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-33333333' }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(total(w)).toBe(1);
  });

  it('kunci idempotensi tidak valid / hilang pada aksi uang => VALIDATION', async () => {
    const w = world(); seedTrx(w);
    await expect(bump(w, 'TRD-00001', { money: true })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(bump(w, 'TRD-00001', { idempotencyKey: 'pendek' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('timeout AMBIGU tapi batch sebenarnya berlaku: retry (setelah jeda) membaca-balik penanda audit, TIDAK menggandakan', async () => {
    const w = world(); seedTrx(w);
    w.store.inject({ kind: 'afterApply' });
    await expect(bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-44444444' })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(total(w)).toBe(1);
    // retry langsung: masih dalam masa tenang
    await expect(bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-44444444' })).rejects.toMatchObject({ code: 'CONFLICT' });
    w.clock.advance(11_000);
    const r = await bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-44444444' });
    expect(r).toMatchObject({ recovered: true });
    expect(total(w)).toBe(1);                                  // tidak dobel
    expect(w.store.rowsOf(AUDIT_LOG)).toHaveLength(1);
    // retry lagi => replay hasil tersimpan
    await expect(bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-44444444' })).resolves.toMatchObject({ recovered: true });
  });

  it('timeout AMBIGU tapi batch TIDAK berlaku: retry menjalankan ulang tepat sekali', async () => {
    const w = world(); seedTrx(w);
    w.store.inject({ kind: 'ambiguousLost' });
    await expect(bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-55555555' })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(total(w)).toBe(0);
    w.clock.advance(11_000);
    await bump(w, 'TRD-00001', { money: true, idempotencyKey: 'key-55555555' });
    expect(total(w)).toBe(1);
    expect(w.store.rowsOf(AUDIT_LOG)).toHaveLength(1);
  });

  it('penanda idempotensi tertulis di Notes audit baris pertama', async () => {
    const w = world(); seedTrx(w);
    await bump(w, 'TRD-00001', { idempotencyKey: 'key-66666666' });
    const notes = String(w.store.rowsOf(AUDIT_LOG)[0]![colIndex(AUDIT_LOG, 'Notes')]);
    expect(notes).toMatch(/\[idem:[0-9a-f]{8}:key-66666666\]/);
  });
});
