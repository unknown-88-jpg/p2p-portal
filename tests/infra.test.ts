import { describe, expect, it } from 'vitest';
import { Cache } from '@/infra/cache';
import { GoogleQuota } from '@/infra/ratelimit';
import { GoogleHttpError, withRetry } from '@/infra/retry';
import { SheetsStore, buildBatchUpdate, colLetter, type RawFetch } from '@/infra/sheets-store';
import { AppError } from '@/lib/errors';
import { endOfWibDay, fromSheetSerial, startOfWibDay, toSheetSerial, wibDate } from '@/lib/time';
import { AUDIT_LOG, DB_PO, MASTER_VENDOR, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { AmbiguousWriteError } from '@/ports/store';
import { findRowById } from '@/server/row-index';
import { nextId, idLockName } from '@/server/id-gen';
import { acquireLocks } from '@/infra/lock';
import { seeded, trxRow, world } from './helpers';

describe('time (WIB)', () => {
  it('serial <-> epoch bolak-balik & batas hari WIB', () => {
    const ms = Date.UTC(2026, 9, 5, 17, 30); // 05 Okt 17:30Z = 06 Okt 00:30 WIB
    expect(wibDate(ms)).toBe('2026-10-06');
    expect(fromSheetSerial(toSheetSerial(ms))).toBe(ms);
    expect(toSheetSerial(Date.UTC(1969, 11, 31, 17))).toBeCloseTo(25569, 6); // 1970-01-01 00:00 WIB
    expect(endOfWibDay('2026-10-05') - startOfWibDay('2026-10-05')).toBe(86_400_000 - 1);
    expect(new Date(startOfWibDay('2026-10-05')).toISOString()).toBe('2026-10-04T17:00:00.000Z');
  });
});

describe('retry budget', () => {
  it('maksimal 2 ulangan lalu menyerah; error non-retryable langsung lempar', async () => {
    const w = world(); let n = 0;
    await expect(withRetry(async () => { n++; throw new GoogleHttpError(503); }, { clock: w.clock, rng: seeded(), isRetryable: () => true })).rejects.toBeInstanceOf(GoogleHttpError);
    expect(n).toBe(3);
    n = 0;
    await expect(withRetry(async () => { n++; throw new Error('x'); }, { clock: w.clock, rng: seeded(), isRetryable: () => false })).rejects.toThrow('x');
    expect(n).toBe(1);
  });
  it('anggaran waktu membatasi total tunggu', async () => {
    const w = world(); let n = 0; const t0 = w.clock.now();
    await expect(withRetry(async () => { n++; throw new Error('x'); }, { clock: w.clock, rng: () => 1, baseMs: 4000, budgetMs: 5000, maxRetries: 5, isRetryable: () => true })).rejects.toThrow();
    expect(w.clock.now() - t0).toBeLessThanOrEqual(5000);
    expect(n).toBeLessThan(6);
  });
});

describe('rate limiter', () => {
  it('lolos <= limit, lalu menunggu ke jendela berikut / UPSTREAM_BUSY bila kelamaan', async () => {
    const w = world();
    w.clock.t = Math.floor(w.clock.t / 60_000) * 60_000; // awal menit
    const q = new GoogleQuota(w.redis, w.clock, 45, 1000);
    for (let i = 0; i < 45; i++) await q.take('read');
    await expect(q.take('read')).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    await q.take('write');                                // jenis lain tidak terpengaruh
    w.clock.advance(61_000);                              // jendela baru; estimasi sliding turun
    w.clock.advance(60_000);
    await q.take('read');
  });
  it('fail-open bila Redis mati', async () => {
    const w = world(); w.redis.down = true;
    await expect(new GoogleQuota(w.redis, w.clock).take('read')).resolves.toBeUndefined();
  });
});

describe('cache', () => {
  it('single-flight: 10 pembaca bersamaan => loader sekali', async () => {
    const w = world(); const c = new Cache(w.redis, w.clock); let n = 0;
    const load = async (): Promise<number> => { n++; await w.clock.sleep(100); return 7; };
    const r = await Promise.all(Array.from({ length: 10 }, () => c.get('master', 'k', { ttlMs: 60_000 }, load)));
    expect(r.every((x) => x === 7)).toBe(true);
    expect(n).toBe(1);
    await c.get('master', 'k', { ttlMs: 60_000 }, load);
    expect(n).toBe(1);                                    // cache hit
  });
  it('invalidate memaksa muat ulang', async () => {
    const w = world(); const c = new Cache(w.redis, w.clock); let n = 0;
    const load = async (): Promise<number> => ++n;
    await c.get('m', 'k', { ttlMs: 60_000 }, load);
    await c.invalidate('m');
    expect(await c.get('m', 'k', { ttlMs: 60_000 }, load)).toBe(2);
  });
  it('stale-if-error: loader gagal tapi ada nilai basi dalam jendela => nilai basi dipakai; lewat jendela => error', async () => {
    const w = world(); const c = new Cache(w.redis, w.clock);
    await c.get('m', 'k', { ttlMs: 1000, staleMs: 10_000 }, async () => 'v1');
    w.clock.advance(2000);
    const fail = async (): Promise<string> => { throw new AppError('UPSTREAM_BUSY', 'x'); };
    expect(await c.get('m', 'k', { ttlMs: 1000, staleMs: 10_000 }, fail)).toBe('v1');
    w.clock.advance(20_000);
    await expect(c.get('m', 'k', { ttlMs: 1000, staleMs: 10_000 }, fail)).rejects.toBeInstanceOf(AppError);
  });
  it('Redis mati => langsung ke loader', async () => {
    const w = world(); const c = new Cache(w.redis, w.clock); w.redis.down = true;
    expect(await c.get('m', 'k', { ttlMs: 1000 }, async () => 5)).toBe(5);
  });
});

describe('row index (R-21)', () => {
  it('menemukan baris, lalu tetap benar setelah sheet disortir (petunjuk usang diverifikasi)', async () => {
    const w = world();
    w.store.seed(TRX_PENGAJUAN, [trxRow('TRD-00001'), trxRow('TRD-00002'), trxRow('TRD-00003')]);
    expect((await findRowById(w.redis, w.store, TRX_PENGAJUAN, 'ID_TRX', 'TRD-00002'))?.row).toBe(3);
    w.store.reorder(TRX_PENGAJUAN, (rows) => [...rows].reverse());       // user menyortir sheet
    const f = await findRowById(w.redis, w.store, TRX_PENGAJUAN, 'ID_TRX', 'TRD-00002');
    expect(f?.row).toBe(3);                                               // kebetulan sama; uji yang pasti berubah:
    const g = await findRowById(w.redis, w.store, TRX_PENGAJUAN, 'ID_TRX', 'TRD-00003');
    expect(g?.row).toBe(2);
    expect(g?.data[colIndex(TRX_PENGAJUAN, 'ID_TRX')]).toBe('TRD-00003');
  });
  it('petunjuk Redis hilang => tetap ketemu; tidak ada => null; ID ganda => error', async () => {
    const w = world();
    w.store.seed(TRX_PENGAJUAN, [trxRow('A1'), trxRow('B1'), trxRow('B1')]);
    w.redis.wipe();
    expect((await findRowById(w.redis, w.store, TRX_PENGAJUAN, 'ID_TRX', 'A1'))?.row).toBe(2);
    expect(await findRowById(w.redis, w.store, TRX_PENGAJUAN, 'ID_TRX', 'ZZZ')).toBeNull();
    await expect(findRowById(w.redis, w.store, TRX_PENGAJUAN, 'ID_TRX', 'B1')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('ID generator', () => {
  const spec = { prefix: 'TRD', pad: 5, schema: TRX_PENGAJUAN, keyCol: 'ID_TRX' };
  it('format TRD-00001 & bootstrap dari max sheet', async () => {
    const w = world();
    w.store.seed(TRX_PENGAJUAN, [trxRow('TRD-00007'), trxRow('NTR-00099'), trxRow('TRD-00003')]);
    expect(await nextId(w.redis, w.store, spec)).toBe('TRD-00008');
    expect(await nextId(w.redis, w.store, { ...spec, prefix: 'NTR' })).toBe('NTR-00100');
  });
  it('20 pembuat paralel (di bawah lock seq) => 20 ID unik berurutan, bahkan bila Redis di-wipe di tengah', async () => {
    const w = world(); w.store.seed(TRX_PENGAJUAN, []);
    let wiped = false;
    const make = async (): Promise<string> => {
      const h = await acquireLocks(w.redis, [idLockName('TRD')], { clock: w.clock, rng: seeded(), waitMs: 600_000 });
      try {
        const id = await nextId(w.redis, w.store, spec);
        await w.store.applyBatch([{ kind: 'append', schema: TRX_PENGAJUAN, cells: { ID_TRX: id } }]);
        if (!wiped && id === 'TRD-00010') { wiped = true; w.redis.wipe(); }   // wipe menghapus lock juga; lock berikutnya tetap serial karena kita menunggu
        return id;
      } finally { await h.release(); }
    };
    const ids = await Promise.all(Array.from({ length: 20 }, make));
    expect(new Set(ids).size).toBe(20);
  });
  it('counter Redis mundur/hilang tidak menghasilkan ID yang sudah ada', async () => {
    const w = world(); w.store.seed(TRX_PENGAJUAN, [trxRow('TRD-00005')]);
    await w.redis.set('seqn:TRD', '1');
    expect(await nextId(w.redis, w.store, spec)).toBe('TRD-00006');
  });
  it('VND pad 4', async () => {
    const w = world(); w.store.seed(MASTER_VENDOR, []);
    expect(await nextId(w.redis, w.store, { prefix: 'VND', pad: 4, schema: MASTER_VENDOR, keyCol: MASTER_VENDOR.cols[0]!.key })).toBe('VND-0001');
  });
});

describe('MemoryStore: sel error IMPORTRANGE', () => {
  it('rejectErrors => UPSTREAM_BUSY (bukan "PO tidak ditemukan")', async () => {
    const w = world();
    const r = Array.from({ length: DB_PO.cols.length }, () => null as string | null); r[0] = '#N/A';
    w.store.seed(DB_PO, [r]);
    await expect(w.store.readRows(DB_PO, { rejectErrors: true })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    await expect(w.store.readRows(DB_PO)).resolves.toHaveLength(1);
  });
});

describe('buildBatchUpdate', () => {
  const gid = (t: string): number => ({ [TRX_PENGAJUAN.tab]: 11, [AUDIT_LOG.tab]: 22, [MASTER_VENDOR.tab]: 33 }[t] ?? 0);
  it('kolom huruf', () => { expect(colLetter(0)).toBe('A'); expect(colLetter(25)).toBe('Z'); expect(colLetter(26)).toBe('AA'); expect(colLetter(47)).toBe('AV'); });
  it('teks = stringValue literal (nol di depan & "=" tidak diparse), angka = numberValue; null = sel kosong', () => {
    const { requests } = buildBatchUpdate([{ kind: 'update', schema: MASTER_VENDOR, row: 5, cells: { 'No Rekening': '00123', NPWP: '=SUM(A1)', Status: null } }], gid) as { requests: { updateCells: { rows: { values: Record<string, unknown>[] }[]; fields: string; start: { rowIndex: number; sheetId: number } } }[] };
    const vals = requests.flatMap((r) => r.updateCells.rows[0]!.values);
    expect(vals).toContainEqual({ userEnteredValue: { stringValue: '00123' } });
    expect(vals).toContainEqual({ userEnteredValue: { stringValue: '=SUM(A1)' } });
    expect(vals).toContainEqual({});
    expect(requests.every((r) => r.updateCells.fields === 'userEnteredValue' && r.updateCells.start.rowIndex === 4 && r.updateCells.start.sheetId === 33)).toBe(true);
  });
  it('kolom berdekatan digabung satu updateCells; kolom terpisah dipecah', () => {
    const a = colIndex(TRX_PENGAJUAN, 'TOTAL_PAID');
    const { requests } = buildBatchUpdate([{ kind: 'update', schema: TRX_PENGAJUAN, row: 2, cells: { TOTAL_PAID: 1, OS_BALANCE: 2, ID_TRX: 'X' } }], gid) as { requests: { updateCells: { start: { columnIndex: number }; rows: { values: unknown[] }[] } }[] };
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.updateCells.start.columnIndex)).toEqual([0, a]);
    expect(requests[1]!.updateCells.rows[0]!.values).toHaveLength(2);
  });
  it('append: satu baris penuh, timestamp berformat DATE_TIME, fields mask benar', () => {
    const { requests } = buildBatchUpdate([{ kind: 'append', schema: AUDIT_LOG, cells: { Log_ID: 'LOG-1', Timestamp: 46300.5 } }], gid) as { requests: { appendCells: { rows: { values: Record<string, unknown>[] }[]; fields: string; sheetId: number } }[] };
    const ac = requests[0]!.appendCells;
    expect(ac.sheetId).toBe(22);
    expect(ac.fields).toBe('userEnteredValue,userEnteredFormat.numberFormat');
    expect(ac.rows[0]!.values).toHaveLength(AUDIT_LOG.cols.length);
    expect(ac.rows[0]!.values[1]).toEqual({ userEnteredValue: { numberValue: 46300.5 }, userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' } } });
  });
  it('kunci kolom salah => lempar (tidak ada tulisan diam-diam)', () => {
    expect(() => buildBatchUpdate([{ kind: 'append', schema: AUDIT_LOG, cells: { Typo: 1 } }], gid)).toThrow();
  });
});

describe('SheetsStore: klasifikasi hasil tulis', () => {
  const meta = JSON.stringify({ sheets: [{ properties: { sheetId: 22, title: AUDIT_LOG.tab } }] });
  const mk = (post: () => Response | Promise<Response>): { store: SheetsStore; posts: () => number } => {
    const w = world(); let posts = 0;
    const fetch: RawFetch = async (url, init) => {
      if (init?.method === 'POST') { posts++; return post(); }
      return new Response(meta, { status: 200 });
    };
    return { store: new SheetsStore({ spreadsheetId: 's', fetch, clock: w.clock, rng: seeded() }), posts: () => posts };
  };
  const m = [{ kind: 'append' as const, schema: AUDIT_LOG, cells: { Log_ID: 'x' } }];
  it('200 => sukses', async () => { await expect(mk(() => new Response('{}')).store.applyBatch(m)).resolves.toBeUndefined(); });
  it('429 => diulang (aman, ditolak tegas) lalu sukses', async () => {
    let n = 0; const { store, posts } = mk(() => (++n < 2 ? new Response('', { status: 429 }) : new Response('{}')));
    await store.applyBatch(m); expect(posts()).toBe(2);
  });
  it('429 terus => UPSTREAM_BUSY (tegas), tidak ambigu', async () => {
    await expect(mk(() => new Response('', { status: 429 })).store.applyBatch(m)).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
  });
  it('5xx & timeout => AmbiguousWriteError dan TIDAK diulang buta', async () => {
    const a = mk(() => new Response('', { status: 503 }));
    await expect(a.store.applyBatch(m)).rejects.toBeInstanceOf(AmbiguousWriteError); expect(a.posts()).toBe(1);
    const b = mk(() => { throw new DOMException('timeout', 'TimeoutError'); });
    await expect(b.store.applyBatch(m)).rejects.toBeInstanceOf(AmbiguousWriteError); expect(b.posts()).toBe(1);
  });
  it('400 => ditolak tegas (INTERNAL), bukan ambigu', async () => {
    await expect(mk(() => new Response('bad', { status: 400 })).store.applyBatch(m)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('baca: sel error IMPORTRANGE ditolak bila rejectErrors', async () => {
    const w = world();
    const fetch: RawFetch = async () => new Response(JSON.stringify({ values: [['#REF!']] }), { status: 200 });
    const s = new SheetsStore({ spreadsheetId: 's', fetch, clock: w.clock, rng: seeded() });
    await expect(s.readRows(DB_PO, { rejectErrors: true })).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    await expect(s.readRows(DB_PO)).resolves.toHaveLength(1);
  });
  it('baca: 503 diulang <=2x lalu UPSTREAM_BUSY', async () => {
    const w = world(); let n = 0;
    const fetch: RawFetch = async () => { n++; return new Response('', { status: 503 }); };
    const s = new SheetsStore({ spreadsheetId: 's', fetch, clock: w.clock, rng: seeded() });
    await expect(s.readRows(DB_PO)).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(n).toBe(3);
  });
});
