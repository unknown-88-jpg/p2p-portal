import { beforeEach, describe, expect, it } from 'vitest';
import { cekBolehDibayar, hitungBayar } from '@/domain/finance';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_COA, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { bayar } from '@/server/finance-aksi';
import { antreanFinance } from '@/server/finance';
import { bayarSchema } from '@/server/finance-schema';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CY = (k: string): number => colIndex(TRX_PAYMENT_LOG, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const sess = (email: string, ...levels: number[]): SessionData => ({ phone: `628${email.length}`, email, nama: email, jabatan: 'Fin', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
const fina = sess('fina@x.id', 3), dani = sess('dani@x.id', 3);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const KAS = 'BCA 123';

let w: ReturnType<typeof authWorld>;
let k = 0;
const key = (): string => `idem-f2e-${String(++k).padStart(8, '0')}`;
const row = (id: string): RawRow => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;
const logOf = (id: string): RawRow[] => w.store.rowsOf(TRX_PAYMENT_LOG).filter((r) => r[CY('ID_Trx')] === id);
const tok = async (s: SessionData, su = true) => { const t = await w.deps.sessions.create(s); if (su) await w.deps.sessions.markStepUp(t); return t; };
const hariIni = (): string => new Date(w.clock.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const bayarX = async (items: { id: string; nominal: number }[], o: { s?: SessionData; kk?: string; su?: boolean; ref?: string; tgl?: string; rek?: string; dup?: boolean } = {}) => {
  const s = o.s ?? fina;
  return bayar(w.deps, s, await tok(s, o.su ?? true), bayarSchema.parse({ items: items.map((i) => ({ ...i, etag: etagOf(row(i.id)) })), tglBayar: o.tgl ?? hariIni(), sumberRekening: o.rek ?? KAS, ...(o.ref ? { refNo: o.ref } : {}), ...(o.dup ? { konfirmasiDuplikat: true } : {}) }), o.kk ?? key());
};
const apr = (id: string, level: number, email: string, t: number, action = 'APPROVED') => [`APR-${id}-${level}-${t}`, id, level, 'x', email, email, 'x', 'E-SIGN', action, t, '', ''];
const siap = (id: string, final: number, o: Record<string, string | number> = {}) => trxRow(id, { STATUS: 'COA Posted', FINAL_AMOUNT: final, TOTAL_PAID: 0, OS_BALANCE: final, REQUIRE_CFO: final >= 5_000_000 ? 'YES' : 'NO', SUB_COA: 'KERTAS A4', BUDGET: 'MKT', LAST_UPDATE: 46000, ...o });

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_COA, [['ASET', 'KAS DAN SETARA KAS', 'BANK', KAS, '-'], ['BEBAN', 'BEBAN OPERASIONAL', 'ATK', 'KERTAS', 'KERTAS A4']]);
  w.store.seed(TRX_PENGAJUAN, [siap('NTR-00001', 1_000_000), siap('NTR-00002', 7_000_000), siap('NTR-00003', 2_000_000, { SUB_COA: '' }), siap('NTR-00004', 3_000_000), siap('NTR-00005', 1_000_000)]);
  const a: (string | number)[][] = [];
  for (const id of ['NTR-00001', 'NTR-00002', 'NTR-00003', 'NTR-00004', 'NTR-00005']) a.push(apr(id, 2, 'budi@x.id', 45990), apr(id, 3, 'dani@x.id', 46000), apr(id, 4, 'eko@x.id', 46001));
  a.push(apr('NTR-00002', 5, 'gita@x.id', 46002));
  w.store.seed(TRX_APPROVAL, a.filter((x) => !(x[1] === 'NTR-00004' && x[2] === 4)));
  w.store.seed(TRX_PAYMENT_LOG, []); w.store.seed(AUDIT_LOG, []);
});

describe('F2-E domain', () => {
  const st = { verifikator: { nama: 'D', email: 'd' }, finMgr: { nama: 'E', email: 'e' }, cfo: null };
  const g = { status: 'COA Posted', perluCFO: false, subCoa: 'X', manager: true, st };
  it('I4 gerbang: status, Manager, verifikasi, Fin. Mgr, CFO bila wajib, Sub COA (tanpa syarat scan TTD, O4; budget dinonaktifkan 2026-10-25)', () => {
    expect(cekBolehDibayar(g)).toBeNull();
    expect(cekBolehDibayar({ ...g, status: 'Partially Paid' })).toBeNull();
    expect(cekBolehDibayar({ ...g, status: 'Wet Signed' })).toMatch(/belum boleh dibayar/);
    expect(cekBolehDibayar({ ...g, manager: false })).toMatch(/Manager/);
    expect(cekBolehDibayar({ ...g, st: { ...st, verifikator: null } })).toMatch(/diverifikasi pajak/);
    expect(cekBolehDibayar({ ...g, st: { ...st, finMgr: null } })).toMatch(/Fin. Mgr/);
    expect(cekBolehDibayar({ ...g, perluCFO: true })).toMatch(/CFO/);
    expect(cekBolehDibayar({ ...g, subCoa: '-' })).toMatch(/Jurnal COA/);
  });
  it('I5: nominal <= sisa + toleransi 1.000; sisa dalam toleransi = lunas; nol/negatif/pecahan ditolak', () => {
    expect(hitungBayar(1_000_000, 0, 1_000_000, 1000)).toEqual({ ok: true, totalBaru: 1_000_000, osBaru: 0, lunas: true });
    expect(hitungBayar(1_000_000, 0, 1_001_000, 1000)).toMatchObject({ ok: true, lunas: true, osBaru: 0 });
    expect(hitungBayar(1_000_000, 0, 1_001_001, 1000)).toMatchObject({ ok: false });
    expect(hitungBayar(1_000_000, 0, 999_500, 1000)).toMatchObject({ ok: true, osBaru: 0, lunas: true });
    expect(hitungBayar(1_000_000, 400_000, 100_000, 1000)).toEqual({ ok: true, totalBaru: 500_000, osBaru: 500_000, lunas: false });
    expect(hitungBayar(1_000_000, 1_000_000, 1, 1000)).toMatchObject({ ok: false, alasan: expect.stringMatching(/lunas/) });
    for (const x of [0, -5, 10.5]) expect(hitungBayar(1_000_000, 0, x, 1000).ok).toBe(false);
  });
});

describe('F2-E bayar', () => {
  it('lunas: log append-only + ringkasan + status Paid + audit, satu batch', async () => {
    const b0 = w.store.batches.length;
    const r = await bayarX([{ id: 'NTR-00001', nominal: 1_000_000 }], { ref: 'TRF-1' });
    expect(r).toMatchObject({ total: 1_000_000, gagal: [], berhasil: [{ id: 'NTR-00001', lunas: true, sisa: 0, tugasRangkap: [] }] });
    const x = row('NTR-00001');
    expect([x[C('STATUS')], x[C('TOTAL_PAID')], x[C('OS_BALANCE')], x[C('PAY_STATUS')]]).toEqual(['Paid', 1_000_000, 0, 'Paid']);
    expect(logOf('NTR-00001').map((l) => [l[CY('Nominal')], l[CY('Sumber_Rekening')], l[CY('Ref_No')], l[CY('Created_By')]])).toEqual([[1_000_000, KAS, 'TRF-1', 'fina@x.id']]);
    expect(w.store.rowsOf(AUDIT_LOG).map((a) => a[CL('Action')]).sort()).toEqual(['PAYMENT', 'STATUS_CHANGE']);
    expect(w.store.batches.length - b0).toBe(1);
  });
  it('cicilan: Partially Paid lalu Paid; sisa dihitung dari LOG, bukan kolom ringkasan', async () => {
    await bayarX([{ id: 'NTR-00001', nominal: 400_000 }]);
    expect(row('NTR-00001')[C('STATUS')]).toBe('Partially Paid');
    // kolom ringkasan dirusak (edit manual): tidak boleh membuka overpay
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === 'NTR-00001') { x[C('TOTAL_PAID')] = 0; x[C('OS_BALANCE')] = 1_000_000; } return x; }));
    expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 700_000 }]))).toBe('RULE_VIOLATION');
    const r = await bayarX([{ id: 'NTR-00001', nominal: 600_000 }]);
    expect(r.berhasil[0]).toMatchObject({ lunas: true });
    expect(row('NTR-00001')[C('STATUS')]).toBe('Paid');
    expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 1 }]))).toBe('RULE_VIOLATION'); // sudah lunas
  });
  it('I4: Fin. Mgr belum ada / CFO wajib belum ada / jurnal belum = diblokir; dokumen lain tetap dibayar (bulk)', async () => {
    w.store.seed(TRX_APPROVAL, w.store.rowsOf(TRX_APPROVAL).filter((x) => !(x[1] === 'NTR-00002' && x[2] === 5)));
    const r = await bayarX([{ id: 'NTR-00001', nominal: 1_000_000 }, { id: 'NTR-00002', nominal: 7_000_000 }, { id: 'NTR-00003', nominal: 1 }, { id: 'NTR-00004', nominal: 1 }]);
    expect(r.berhasil.map((b) => b.id)).toEqual(['NTR-00001']);
    expect(r.gagal.map((g) => [g.id, g.alasan.replace(/^Pembayaran diblokir: /, '').slice(0, 12)])).toEqual([['NTR-00002', 'Nominal ≥ Rp'], ['NTR-00003', 'Jurnal COA b'], ['NTR-00004', 'Belum ada pe']]);
  });
  it('step-up wajib; hanya Finance Staff; rekening harus akun kas Master_COA; tanggal masa depan ditolak; ID ganda ditolak', async () => {
    expect(await bayarX([{ id: 'NTR-00001', nominal: 1 }], { su: false }).catch((e: AppError) => e)).toMatchObject({ code: 'FORBIDDEN', fields: { stepUp: 'required' } });
    for (const l of [1, 2, 4, 5]) expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 1 }], { s: sess('x@x.id', l) }))).toBe('FORBIDDEN');
    expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 1 }], { rek: 'BEBAN OPERASIONAL' }))).toBe('VALIDATION');
    expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 1 }], { tgl: '2099-01-01' }))).toBe('VALIDATION');
    expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 1 }, { id: 'NTR-00001', nominal: 1 }]))).toBe('VALIDATION');
    expect(logOf('NTR-00001')).toHaveLength(0);
  });
  it('R-04: kunci sama diulang = satu pembayaran; klik ulang dengan kunci baru (sama persis) = butuh konfirmasi kembar', async () => {
    const kk = key();
    await bayarX([{ id: 'NTR-00004', nominal: 100_000 }], { kk, ref: 'R1' }).catch(() => undefined); // NTR-00004 diblokir (tanpa Fin. Mgr)
    const items = [{ id: 'NTR-00005', nominal: 100_000 }];
    const a = await bayarX(items, { kk: 'idem-f2e-sama-0001', ref: 'R1' });
    const b = await bayarX(items, { kk: 'idem-f2e-sama-0001', ref: 'R1' });
    expect(b).toEqual(a);
    expect(logOf('NTR-00005')).toHaveLength(1);
    const e = await bayarX(items, { ref: 'R1' }).catch((x: AppError) => x);
    expect(e).toMatchObject({ code: 'CONFLICT', fields: { duplikat: 'konfirmasi' } });
    expect(logOf('NTR-00005')).toHaveLength(1);
    await bayarX(items, { ref: 'R1', dup: true });
    expect(logOf('NTR-00005')).toHaveLength(2);
    w.clock.t += 11 * 60_000; // lewat jendela 10 menit: tidak dianggap kembar
    expect(await kode(bayarX(items, { ref: 'R1' }))).toBe('OK');
  });
  it('race: 20 pembayaran paralel @300rb atas sisa 1jt -> total tidak pernah melebihi tagihan', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => kode(bayarX([{ id: 'NTR-00001', nominal: 300_000 }], { ref: `P${i}` }))));
    const total = logOf('NTR-00001').reduce((t, l) => t + Number(l[CY('Nominal')]), 0);
    expect(total).toBeLessThanOrEqual(1_000_000 + 1000);
    expect(res.filter((x) => x === 'OK').length).toBe(logOf('NTR-00001').length);
    expect(row('NTR-00001')[C('TOTAL_PAID')]).toBe(total);
  });
  it('O5b: pembayar = verifikator pajak -> tetap dibayar, diberi penanda di audit; antrean memberi peringatan & alasan blokir', async () => {
    const q = await antreanFinance(w.deps, dani, 'bayar');
    expect(q.items.find((i) => i.id === 'NTR-00001')).toMatchObject({ blokirBayar: null, tugasRangkap: ['verifikator pajak'] });
    expect(q.items.find((i) => i.id === 'NTR-00004')!.blokirBayar).toMatch(/Fin. Mgr/);
    const r = await bayarX([{ id: 'NTR-00001', nominal: 1_000_000 }], { s: dani });
    expect(r.berhasil[0]!.tugasRangkap).toEqual(['verifikator pajak']);
    expect(w.store.rowsOf(AUDIT_LOG).some((a) => a[CL('Action')] === 'PAYMENT' && String(a[CL('Notes')]).includes('Penanda SoD O5b'))).toBe(true);
  });
  it('fault injection: tulis gagal -> tidak ada log/ringkasan setengah tercatat', async () => {
    w.store.inject({ kind: 'beforeApply' });
    expect(await kode(bayarX([{ id: 'NTR-00001', nominal: 500_000 }, { id: 'NTR-00005', nominal: 500_000 }]))).not.toBe('OK');
    expect(w.store.rowsOf(TRX_PAYMENT_LOG)).toHaveLength(0);
    expect([row('NTR-00001')[C('STATUS')], row('NTR-00005')[C('TOTAL_PAID')]]).toEqual(['COA Posted', 0]);
  });
});
