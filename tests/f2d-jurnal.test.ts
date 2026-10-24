import { beforeEach, describe, expect, it } from 'vitest';
import { opsiCoa, validasiJurnal, type BarisCoa } from '@/domain/finance';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_COA, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { jurnalCoa } from '@/server/finance-aksi';
import { jurnalSchema } from '@/server/finance-schema';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const sess = (level: number): SessionData => ({ phone: '6280', email: 'dani@x.id', nama: 'Dani', jabatan: 'Fin', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level }] });
const dani = sess(3);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const COA: BarisCoa[] = [
  ['BEBAN', 'BEBAN OPERASIONAL', 'ATK', 'KERTAS', 'KERTAS A4'],
  ['BEBAN', 'BEBAN OPERASIONAL', 'ATK', 'TINTA', '-'],
  ['BEBAN', 'BEBAN PEMASARAN', '-', '-', '-'],
  ['ASET', 'KAS DAN SETARA KAS', 'BANK', 'BCA 123', '-'],
];

let w: ReturnType<typeof authWorld>;
let k = 0;
const key = (): string => `idem-f2d-${String(++k).padStart(8, '0')}`;
const row = (id: string): RawRow => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;
const item = (id: string, o: Record<string, string> = {}) => ({ id, etag: etagOf(row(id)), lvl1: 'BEBAN', lvl2: 'BEBAN OPERASIONAL', lvl3: 'ATK', lvl4: 'KERTAS', lvl5: 'KERTAS A4', budget: 'mkt-q4', ...o });
const jurnal = (items: ReturnType<typeof item>[], kk = key(), s = dani) => jurnalCoa(w.deps, s, jurnalSchema.parse({ items }), kk);

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_COA, COA.map((c) => [...c]));
  w.store.seed(TRX_PENGAJUAN, [1, 2, 3, 4].map((n) => trxRow(`NTR-0000${n}`, { STATUS: n === 4 ? 'Tax Verified' : 'Wet Signed', FINAL_AMOUNT: 1_000_000, LAST_UPDATE: 46000, NOTES_FINANCE: '[DITOLAK FINANCE] lama' })));
  w.store.seed(AUDIT_LOG, []);
});

describe('F2-D domain', () => {
  it('validasi: L1 & L2 wajib, budget wajib, kombinasi harus ada; akun = level terdalam; "-" = tidak dipilih', () => {
    const j = (o: Partial<Record<'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'budget', string>>) => validasiJurnal(COA, { lvl1: 'BEBAN', lvl2: 'BEBAN OPERASIONAL', lvl3: '-', lvl4: '-', lvl5: '-', budget: 'b', ...o });
    expect(j({ lvl3: 'ATK', lvl4: 'KERTAS', lvl5: 'KERTAS A4' })).toMatchObject({ ok: true, akun: 'KERTAS A4', budget: 'B' });
    expect(j({ lvl3: 'ATK', lvl4: 'TINTA' })).toMatchObject({ ok: true, akun: 'TINTA' });
    expect(j({})).toMatchObject({ ok: true, akun: 'BEBAN OPERASIONAL' }); // lama: boleh berhenti di level 2
    expect(j({ lvl2: '' })).toMatchObject({ ok: false, alasan: expect.stringMatching(/level 1 & 2/) });
    expect(j({ budget: '  ' })).toMatchObject({ ok: false, alasan: expect.stringMatching(/budget/) });
    expect(j({ lvl3: 'ATK', lvl4: 'KERTAS', lvl5: 'TINTA' })).toMatchObject({ ok: false, alasan: expect.stringMatching(/tidak ada di Master_COA/) });
    expect(j({ lvl1: 'ASET', lvl2: 'BEBAN OPERASIONAL' }).ok).toBe(false);
  });
  it('opsi bertingkat: unik, di bawah pilihan sebelumnya, "-" bukan opsi', () => {
    expect(opsiCoa(COA, [], 0)).toEqual(['BEBAN', 'ASET']);
    expect(opsiCoa(COA, ['BEBAN'], 1)).toEqual(['BEBAN OPERASIONAL', 'BEBAN PEMASARAN']);
    expect(opsiCoa(COA, ['BEBAN', 'BEBAN PEMASARAN'], 2)).toEqual([]);
    expect(opsiCoa(COA, ['BEBAN', 'BEBAN OPERASIONAL', 'ATK'], 3)).toEqual(['KERTAS', 'TINTA']);
  });
});

describe('F2-D jurnalCoa', () => {
  it('bulk: semua valid -> COA Posted, kolom COA terisi, NOTES_FINANCE diganti, SATU batch tulis, audit per dokumen', async () => {
    const sebelum = w.store.batches.length;
    const r = await jurnal([item('NTR-00001'), item('NTR-00002'), item('NTR-00003', { lvl3: '-', lvl4: '-', lvl5: '-' })]);
    expect(r.berhasil.map((b) => [b.id, b.akun])).toEqual([['NTR-00001', 'KERTAS A4'], ['NTR-00002', 'KERTAS A4'], ['NTR-00003', 'BEBAN OPERASIONAL']]);
    expect(r.gagal).toEqual([]);
    const x = row('NTR-00001');
    expect([x[C('STATUS')], x[C('CATEGORY_COA')], x[C('HEAD_COA')], x[C('SUB_COA')], x[C('BUDGET')], x[C('NOTES_FINANCE')]]).toEqual(['COA Posted', 'BEBAN', 'BEBAN OPERASIONAL', 'KERTAS A4', 'MKT-Q4', '']);
    const acts = w.store.rowsOf(AUDIT_LOG).map((a) => `${a[CL('ID_Trx')]}:${a[CL('Action')]}`);
    expect(acts.filter((a) => a.endsWith('COA_POST'))).toHaveLength(3);
    expect(acts.filter((a) => a.endsWith('STATUS_CHANGE'))).toHaveLength(3);
    expect(w.store.batches.length - sebelum).toBe(1); // 3 dokumen = 1 panggilan tulis
  });
  it('sebagian gagal tidak menggagalkan sisanya: status salah, etag basi, COA salah, tidak ada -> dilaporkan per dokumen', async () => {
    const r = await jurnal([item('NTR-00001'), item('NTR-00004'), { ...item('NTR-00002'), etag: 'q'.repeat(20) }, item('NTR-00003', { lvl5: 'TINTA' }), { ...item('NTR-00001'), id: 'NTR-09999' }]);
    expect(r.berhasil.map((b) => b.id)).toEqual(['NTR-00001']);
    expect(r.gagal.map((g) => g.id)).toEqual(['NTR-00004', 'NTR-00002', 'NTR-00003', 'NTR-09999']);
    expect(row('NTR-00002')[C('STATUS')]).toBe('Wet Signed');
    expect(row('NTR-00003')[C('SUB_COA')]).toBeNull();
  });
  it('semua gagal = 422 berisi alasan; tidak ada yang berubah', async () => {
    const e = await jurnal([item('NTR-00004')]).catch((x: AppError) => x);
    expect(e).toMatchObject({ code: 'RULE_VIOLATION' }); expect((e as AppError).message).toMatch(/NTR-00004/);
    expect(w.store.rowsOf(AUDIT_LOG)).toHaveLength(0);
  });
  it('ID ganda dalam satu permintaan ditolak; maks 30; hanya Finance Staff; tanpa Idempotency-Key 400', async () => {
    expect(await kode(jurnal([item('NTR-00001'), item('NTR-00001')]))).toBe('VALIDATION');
    expect(jurnalSchema.safeParse({ items: Array.from({ length: 31 }, (_, i) => ({ ...item('NTR-00001'), id: `NTR-${String(i).padStart(5, '0')}` })) }).success).toBe(false);
    for (const l of [1, 2, 4, 5]) expect(await kode(jurnal([item('NTR-00001')], key(), sess(l)))).toBe('FORBIDDEN');
    expect(await kode(jurnalCoa(w.deps, dani, jurnalSchema.parse({ items: [item('NTR-00001')] }), undefined))).toBe('VALIDATION');
  });
  it('idempotensi: batch yang sama diulang tidak menulis dua kali', async () => {
    const items = [item('NTR-00001'), item('NTR-00002')], kk = key();
    const a = await jurnal(items, kk), b = await jurnal(items, kk);
    expect(b).toEqual(a);
    expect(w.store.rowsOf(AUDIT_LOG).filter((x) => x[CL('Action')] === 'COA_POST')).toHaveLength(2);
  });
  it('fault injection: tulis gagal -> tidak ada dokumen setengah berubah; ulang dengan kunci sama lalu berhasil penuh', async () => {
    const items = [item('NTR-00001'), item('NTR-00002')], kk = key();
    w.store.inject({ kind: 'beforeApply' });
    expect(await kode(jurnal(items, kk))).not.toBe('OK');
    expect([row('NTR-00001')[C('STATUS')], row('NTR-00002')[C('STATUS')], row('NTR-00001')[C('SUB_COA')]]).toEqual(['Wet Signed', 'Wet Signed', null]);
    expect(w.store.rowsOf(AUDIT_LOG)).toHaveLength(0);
    expect((await jurnal(items, kk)).berhasil).toHaveLength(2);
  });
  it('COA dibaca SEGAR dari Master_COA (akun yang baru dihapus ditolak)', async () => {
    w.store.seed(MASTER_COA, COA.filter((c) => c[4] !== 'KERTAS A4').map((c) => [...c]));
    expect(await kode(jurnal([item('NTR-00001')]))).toBe('RULE_VIOLATION');
  });
});
