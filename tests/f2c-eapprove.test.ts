import { beforeEach, describe, expect, it } from 'vitest';
import { cekEApprove, statusPersetujuan, type BarisApproval } from '@/domain/finance';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { kembalikanFinance, setujuiFinance } from '@/server/finance-aksi';
import { antreanFinance } from '@/server/finance';
import { setujuiFinanceSchema } from '@/server/finance-schema';
import { giliranSaya, tampilKirimWa } from '@/ui/FormPersetujuanFinance';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const sess = (email: string, nama: string, ...levels: number[]): SessionData => ({ phone: `628${email.length}`, email, nama, jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
const eko = sess('eko@x.id', 'Eko', 4), gita = sess('gita@x.id', 'Gita', 5), dani = sess('dani@x.id', 'Dani', 3), rangkap = sess('rr@x.id', 'Rangkap', 4, 5);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

let w: ReturnType<typeof authWorld>;
let k = 0;
const key = (): string => `idem-f2c-${String(++k).padStart(8, '0')}`;
const row = (id: string): RawRow => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;
const aprs = (id: string): RawRow[] => w.store.rowsOf(TRX_APPROVAL).filter((r) => r[CA('ID_Trx')] === id);
const tok = async (s: SessionData, stepUp = true): Promise<string> => { const t = await w.deps.sessions.create(s); if (stepUp) await w.deps.sessions.markStepUp(t); return t; };
const setujui = async (s: SessionData, id: string, sebagai: 'finmgr' | 'coo' | 'cfo', o: { stepUp?: boolean; kk?: string } = {}) =>
  setujuiFinance(w.deps, s, await tok(s, o.stepUp ?? true), id, setujuiFinanceSchema.parse({ etag: etagOf(row(id)), sebagai }), o.kk ?? key());
const l3 = (id: string, t: number, email = 'dani@x.id') => [`APR-${id}-3-${t}`, id, 3, 'Diverifikasi Oleh,', 'Dani', email, 'Fin', 'E-SIGN', 'APPROVED', t, '', ''];

beforeEach(() => {
  w = authWorld();
  w.store.seed(TRX_PENGAJUAN, [
    trxRow('NTR-00001', { STATUS: 'Tax Verified', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO', LAST_UPDATE: 46000 }),
    trxRow('NTR-00002', { STATUS: 'Tax Verified', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 7_000_000, REQUIRE_CFO: 'YES', LAST_UPDATE: 46000 }),
    trxRow('NTR-00003', { STATUS: 'Manager Approved', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 1_000_000, LAST_UPDATE: 46000 }),
    trxRow('NTR-00004', { STATUS: 'Tax Verified', CREATED_BY: 'eko@x.id', FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO', LAST_UPDATE: 46000 }),
  ]);
  w.store.seed(TRX_APPROVAL, [l3('NTR-00001', 46000), l3('NTR-00002', 46000), l3('NTR-00004', 46000)]);
  w.store.seed(AUDIT_LOG, []);
});

describe('F2-C domain', () => {
  const r = (level: number, t: number, nama = `L${level}`, action = 'APPROVED'): BarisApproval => ({ level, action, nama, email: `${nama.toLowerCase()}@x.id`, timestamp: t });
  it('hanya persetujuan SETELAH verifikasi pajak terakhir yang berlaku (siklus ulang tidak terbawa)', () => {
    const st = statusPersetujuan([r(3, 1, 'Dani'), r(4, 2, 'Eko'), r(5, 3, 'Gita'), r(3, 10, 'Fina')]);
    expect(st).toMatchObject({ finMgr: null, cfo: null, verifikator: { nama: 'Fina' } });
    expect(statusPersetujuan([r(3, 1), r(4, 2, 'Eko'), r(4, 0, 'Lama'), r(5, 3, 'X', 'REJECTED')])).toMatchObject({ finMgr: { nama: 'Eko' }, cfo: null });
  });
  it('urutan & aturan: CFO hanya bila wajib, setelah Fin. Mgr, orang berbeda; level persis', () => {
    const R = (...l: number[]) => l.map((level) => ({ brand: 'ALL', dept: 'ALL', level }));
    const kosong = { finMgr: null, coo: null, cfo: null, verifikator: null };
    const fm = { finMgr: { nama: 'Eko', email: 'eko@x.id' }, coo: null, cfo: null, verifikator: null };
    expect(cekEApprove('finmgr', R(4), 'a@x.id', true, false, kosong)).toBeNull();
    expect(cekEApprove('finmgr', R(3), 'a@x.id', true, false, kosong)?.kode).toBe('FORBIDDEN');
    expect(cekEApprove('finmgr', R(4), 'a@x.id', true, false, fm)?.kode).toBe('CONFLICT');
    expect(cekEApprove('cfo', R(5), 'g@x.id', true, false, kosong)?.pesan).toMatch(/Fin. Mgr lebih dulu/);
    expect(cekEApprove('cfo', R(5), 'g@x.id', false, false, fm)?.pesan).toMatch(/tidak membutuhkan persetujuan CFO/);
    expect(cekEApprove('cfo', R(4, 5), 'EKO@x.id', true, false, fm)?.pesan).toMatch(/orang yang berbeda/);
    expect(cekEApprove('cfo', R(5), 'g@x.id', true, false, fm)).toBeNull();
    expect(cekEApprove('cfo', R(4), 'g@x.id', true, false, fm)?.kode).toBe('FORBIDDEN');
  });
  it('UI giliranSaya selaras dengan aturan server', () => {
    const d = (perluCFO: boolean, p?: { finMgr: string | null; coo?: string | null; cfo: string | null; finMgrSaya: boolean; cooSaya?: boolean }) =>
      ({ id: 'X', vendorNama: '', etag: '', nominal: 0, perluCFO, perluCOO: false, ajuanSendiri: false, persetujuan: p ? { coo: null, cooSaya: false, ...p } : undefined });
    const P = (o: Partial<{ staff: boolean; finMgr: boolean; coo: boolean; cfo: boolean }>) => ({ staff: false, finMgr: false, coo: false, cfo: false, ...o });
    expect(giliranSaya(d(true), P({ finMgr: true }))).toBe('finmgr');
    expect(giliranSaya(d(true), P({ cfo: true }))).toBeNull();
    expect(giliranSaya(d(true, { finMgr: 'Eko', cfo: null, finMgrSaya: false }), P({ cfo: true }))).toBe('cfo');
    expect(giliranSaya(d(true, { finMgr: 'RR', cfo: null, finMgrSaya: true }), P({ finMgr: true, cfo: true }))).toBeNull();
    expect(giliranSaya(d(false, { finMgr: 'Eko', cfo: null, finMgrSaya: false }), P({ cfo: true }))).toBeNull();
  });
  it('UI: tombol Kirim WA disembunyikan bila penerimanya diri sendiri', () => {
    expect(tampilKirimWa('finmgr', 'finmgr')).toBe(false); // Fin. Mgr yang sedang giliran tidak mengirim WA ke dirinya
    expect(tampilKirimWa('cfo', 'cfo')).toBe(false);
    expect(tampilKirimWa(null, 'finmgr')).toBe(true); // Finance Staff / peran lain tetap bisa mengingatkan
    expect(tampilKirimWa(null, 'cfo')).toBe(true); // Fin. Mgr yang sudah menyetujui tetap bisa mengingatkan CFO
  });
});

describe('F2-C setujuiFinance', () => {
  it('tanpa CFO: Fin. Mgr menyetujui -> Wet Signed; approval L4 E-SIGN atas nama Fin. Mgr (bukan pengunggah) ; audit', async () => {
    const r = await setujui(eko, 'NTR-00001', 'finmgr');
    expect(r).toMatchObject({ status: 'Wet Signed', menungguCFO: false });
    expect(row('NTR-00001')[C('STATUS')]).toBe('Wet Signed');
    const a = aprs('NTR-00001').filter((x) => x[CA('Level')] === 4);
    expect(a.map((x) => [x[CA('Approver_Name')], x[CA('Approver_Email')], x[CA('Method')], x[CA('Action')], x[CA('Role_Label')]])).toEqual([['Eko', 'eko@x.id', 'E-SIGN', 'APPROVED', 'Disetujui Oleh,']]);
    const logs = w.store.rowsOf(AUDIT_LOG).filter((x) => x[CL('ID_Trx')] === 'NTR-00001').map((x) => x[CL('Action')]);
    expect(logs.sort()).toEqual(['APPROVAL', 'STATUS_CHANGE']);
  });
  it('dengan CFO: Fin. Mgr -> tetap Tax Verified (menunggu CFO); CFO sebelum Fin. Mgr ditolak; CFO -> Wet Signed', async () => {
    expect(await kode(setujui(gita, 'NTR-00002', 'cfo'))).toBe('RULE_VIOLATION');
    const r1 = await setujui(eko, 'NTR-00002', 'finmgr');
    expect(r1).toMatchObject({ status: 'Tax Verified', menungguCFO: true });
    expect(row('NTR-00002')[C('STATUS')]).toBe('Tax Verified');
    expect(await kode(setujui(eko, 'NTR-00002', 'finmgr'))).toBe('CONFLICT'); // Fin. Mgr dua kali
    const r2 = await setujui(gita, 'NTR-00002', 'cfo');
    expect(r2).toMatchObject({ status: 'Wet Signed' });
    expect(aprs('NTR-00002').map((x) => x[CA('Level')])).toEqual([3, 4, 5]);
  });
  it('orang yang sama tidak bisa menjadi Fin. Mgr DAN CFO untuk dokumen yang sama', async () => {
    await setujui(rangkap, 'NTR-00002', 'finmgr');
    expect(await kode(setujui(rangkap, 'NTR-00002', 'cfo'))).toBe('RULE_VIOLATION');
    expect(await kode(setujui(gita, 'NTR-00002', 'cfo'))).toBe('OK');
  });
  it('step-up password wajib: tanpa step-up = 403 stepUp, status tidak berubah', async () => {
    const e = await setujui(eko, 'NTR-00001', 'finmgr', { stepUp: false }).catch((x: AppError) => x);
    expect(e).toMatchObject({ code: 'FORBIDDEN', fields: { stepUp: 'required' } });
    expect(row('NTR-00001')[C('STATUS')]).toBe('Tax Verified');
    expect(aprs('NTR-00001')).toHaveLength(1);
  });
  it('level persis: Finance Staff / Manager / CFO-sebagai-finmgr = 403; status lain = 409; etag basi = 409', async () => {
    expect(await kode(setujui(dani, 'NTR-00001', 'finmgr'))).toBe('FORBIDDEN');
    expect(await kode(setujui(gita, 'NTR-00001', 'finmgr'))).toBe('FORBIDDEN');
    expect(await kode(setujui(sess('m@x.id', 'M', 2), 'NTR-00001', 'finmgr'))).toBe('FORBIDDEN');
    expect(await kode(setujui(eko, 'NTR-00003', 'finmgr'))).toBe('CONFLICT');
    const t = await tok(eko);
    expect(await kode(setujuiFinance(w.deps, eko, t, 'NTR-00001', { etag: 'z'.repeat(20), sebagai: 'finmgr' }, key()))).toBe('CONFLICT');
  });
  it('siklus ulang: persetujuan Fin. Mgr lama tidak terbawa setelah dikembalikan & diverifikasi ulang', async () => {
    await setujui(eko, 'NTR-00002', 'finmgr');
    // dikembalikan oleh CFO, lalu (simulasi) diajukan & diverifikasi pajak ulang
    await kembalikanFinance(w.deps, gita, 'NTR-00002', { etag: etagOf(row('NTR-00002')), alasan: 'Lampiran kurang' }, key());
    expect(row('NTR-00002')[C('STATUS')]).toBe('Revision Needed');
    expect(aprs('NTR-00002').filter((x) => x[CA('Level')] === 5).map((x) => x[CA('Action')])).toEqual(['REJECTED']);
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === 'NTR-00002') { x[C('STATUS')] = 'Tax Verified'; x[C('LAST_UPDATE')] = 46100; } return x; }));
    w.store.seed(TRX_APPROVAL, [...w.store.rowsOf(TRX_APPROVAL), l3('NTR-00002', w.store.rowsOf(TRX_APPROVAL).reduce((m, x) => Math.max(m, Number(x[CA('Timestamp')])), 0) + 1)]);
    expect(await kode(setujui(gita, 'NTR-00002', 'cfo'))).toBe('RULE_VIOLATION'); // Fin. Mgr lama tidak berlaku
    expect(await kode(setujui(eko, 'NTR-00002', 'finmgr'))).toBe('OK');
  });
  it('penanda SoD (bukan blokir): Fin. Mgr menyetujui ajuannya sendiri -> berhasil, penanda di audit & approval', async () => {
    const r = await setujui(eko, 'NTR-00004', 'finmgr');
    expect(r.penanda).toMatch(/penyetuju = pengaju/);
    expect(String(aprs('NTR-00004').find((x) => x[CA('Level')] === 4)![CA('Notes')])).toMatch(/Penanda SoD/);
  });
  it('idempotensi & race: dua Fin. Mgr bersamaan -> tepat satu persetujuan L4', async () => {
    const fina = sess('fm2@x.id', 'FM2', 4);
    const [a, b] = await Promise.all([kode(setujui(eko, 'NTR-00001', 'finmgr')), kode(setujui(fina, 'NTR-00001', 'finmgr'))]);
    expect([a, b].sort()).toEqual(['CONFLICT', 'OK']);
    expect(aprs('NTR-00001').filter((x) => x[CA('Level')] === 4)).toHaveLength(1);
  });
  it('Fin. Mgr hanya boleh mengembalikan di tahap persetujuan; antrean menampilkan siapa yang sudah menyetujui', async () => {
    expect(await kode(kembalikanFinance(w.deps, eko, 'NTR-00003', { etag: etagOf(row('NTR-00003')), alasan: 'xxx' }, key()))).toBe('FORBIDDEN');
    await setujui(eko, 'NTR-00002', 'finmgr');
    const q = await antreanFinance(w.deps, gita, 'persetujuan');
    expect(q.peran).toEqual({ staff: false, finMgr: false, coo: false, cfo: true });
    expect(q.items.find((i) => i.id === 'NTR-00002')!.persetujuan).toEqual({ finMgr: 'Eko', coo: null, cfo: null, finMgrSaya: false, cooSaya: false, wa: { target: 'cfo', terkirim: false } });
  });
});

describe('COO (2026-11-09): dokumen General Affairs >= ambang CFO — Fin. Mgr -> COO -> CFO', () => {
  const coo = sess('rusli@x.id', 'Rusli', 6);
  const GA = 'GENERAL AFFAIRS';
  beforeEach(() => {
    w.store.seed(TRX_PENGAJUAN, [
      ...w.store.rowsOf(TRX_PENGAJUAN),
      trxRow('NTR-00010', { STATUS: 'Tax Verified', DEPARTEMENT: GA, BRAND: 'All Brand (Shared Service)', CREATED_BY: 'naila@x.id', FINAL_AMOUNT: 7_000_000, REQUIRE_CFO: 'YES', LAST_UPDATE: 46000 }),
      trxRow('NTR-00011', { STATUS: 'Tax Verified', DEPARTEMENT: GA, BRAND: 'HEYLOCAL', CREATED_BY: 'naila@x.id', FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO', LAST_UPDATE: 46000 }),
      trxRow('NTR-00012', { STATUS: 'Tax Verified', DEPARTEMENT: GA, BRAND: 'SHUWA', CREATED_BY: 'naila@x.id', FINAL_AMOUNT: 5_000_000, REQUIRE_CFO: '', LAST_UPDATE: 46000 }), // flag kosong/diedit, nominal tepat di ambang
    ]);
    w.store.seed(TRX_APPROVAL, [...w.store.rowsOf(TRX_APPROVAL), l3('NTR-00010', 46000), l3('NTR-00011', 46000), l3('NTR-00012', 46000)]);
  });
  it('alur penuh: CFO & COO ditahan sampai gilirannya; COO L6 tercatat E-SIGN; urutan approval 3,4,6,5; baru Wet Signed setelah CFO', async () => {
    expect(await kode(setujui(coo, 'NTR-00010', 'coo'))).toBe('RULE_VIOLATION'); // COO sebelum Fin. Mgr
    expect(await kode(setujui(gita, 'NTR-00010', 'cfo'))).toBe('RULE_VIOLATION'); // CFO sebelum Fin. Mgr
    const r1 = await setujui(eko, 'NTR-00010', 'finmgr');
    expect(r1).toMatchObject({ status: 'Tax Verified', menungguBerikut: 'coo', menungguCFO: false });
    expect(await kode(setujui(gita, 'NTR-00010', 'cfo'))).toBe('RULE_VIOLATION'); // CFO sebelum COO
    expect(await kode(setujui(eko, 'NTR-00010', 'coo'))).toBe('FORBIDDEN'); // level persis
    expect(await kode(setujui(gita, 'NTR-00010', 'coo'))).toBe('FORBIDDEN');
    const r2 = await setujui(coo, 'NTR-00010', 'coo');
    expect(r2).toMatchObject({ status: 'Tax Verified', menungguBerikut: 'cfo', menungguCFO: true });
    expect(row('NTR-00010')[C('STATUS')]).toBe('Tax Verified');
    expect(await kode(setujui(coo, 'NTR-00010', 'coo'))).toBe('CONFLICT'); // COO dua kali
    expect(await setujui(gita, 'NTR-00010', 'cfo')).toMatchObject({ status: 'Wet Signed', menungguBerikut: null });
    expect(aprs('NTR-00010').map((x) => x[CA('Level')])).toEqual([3, 4, 6, 5]);
    expect(aprs('NTR-00010').find((x) => x[CA('Level')] === 6)).toSatisfy((x: RawRow) => x[CA('Approver_Email')] === 'rusli@x.id' && x[CA('Method')] === 'E-SIGN' && x[CA('Action')] === 'APPROVED');
  });
  it('GA di bawah ambang: tanpa COO (Fin. Mgr langsung selesai); COO ditolak', async () => {
    expect(await kode(setujui(coo, 'NTR-00011', 'coo'))).toBe('RULE_VIOLATION');
    expect(await setujui(eko, 'NTR-00011', 'finmgr')).toMatchObject({ status: 'Wet Signed', menungguBerikut: null });
  });
  it('gagal tertutup: GA tepat Rp 5.000.000 dengan REQUIRE_CFO kosong tetap wajib COO lalu CFO (I1 + COO)', async () => {
    expect(await setujui(eko, 'NTR-00012', 'finmgr')).toMatchObject({ status: 'Tax Verified', menungguBerikut: 'coo' });
    expect(await kode(setujui(gita, 'NTR-00012', 'cfo'))).toBe('RULE_VIOLATION');
    await setujui(coo, 'NTR-00012', 'coo');
    expect(await kode(setujui(gita, 'NTR-00012', 'cfo'))).toBe('OK');
  });
  it('dept selain GA tidak pernah minta COO, berapa pun nominalnya', async () => {
    await setujui(eko, 'NTR-00002', 'finmgr'); // NTR-00002: 7 jt, bukan GA
    expect(await kode(setujui(coo, 'NTR-00002', 'coo'))).toBe('RULE_VIOLATION');
    expect(await kode(setujui(gita, 'NTR-00002', 'cfo'))).toBe('OK');
  });
  it('dua tanda tangan = dua orang: COO tidak boleh orang yang sama dengan Fin. Mgr; CFO tidak boleh sama dengan COO', async () => {
    const rangkap46 = sess('dua@x.id', 'Dua', 4, 6), rangkap65 = sess('tiga@x.id', 'Tiga', 6, 5);
    await setujui(rangkap46, 'NTR-00010', 'finmgr');
    expect(await kode(setujui(rangkap46, 'NTR-00010', 'coo'))).toBe('RULE_VIOLATION');
    await setujui(rangkap65, 'NTR-00010', 'coo');
    expect(await kode(setujui(rangkap65, 'NTR-00010', 'cfo'))).toBe('RULE_VIOLATION');
    expect(await kode(setujui(gita, 'NTR-00010', 'cfo'))).toBe('OK');
  });
  it('step-up password wajib untuk COO juga', async () => {
    await setujui(eko, 'NTR-00010', 'finmgr');
    const e = await setujui(coo, 'NTR-00010', 'coo', { stepUp: false }).catch((x: AppError) => x);
    expect(e).toMatchObject({ code: 'FORBIDDEN', fields: { stepUp: 'required' } });
    expect(aprs('NTR-00010').some((x) => x[CA('Level')] === 6)).toBe(false);
  });
  it('antrean: peran COO terlihat, perluCOO/persetujuan COO muncul, COO boleh melihat antrean Finance', async () => {
    await setujui(eko, 'NTR-00010', 'finmgr');
    const q = await antreanFinance(w.deps, coo);
    expect(q.peran).toEqual({ staff: false, finMgr: false, coo: true, cfo: false });
    const i = q.items.find((x) => x.id === 'NTR-00010')!;
    expect(i).toMatchObject({ perluCOO: true, perluCFO: true });
    expect(i.persetujuan).toMatchObject({ finMgr: 'Eko', coo: null, cfo: null });
    expect(q.items.find((x) => x.id === 'NTR-00002')!.perluCOO).toBe(false);
  });
  it('Fin. Mgr / COO / CFO bisa mengembalikan dokumen di tahap persetujuan; COO tidak bisa mengembalikan di tahap lain', async () => {
    await kembalikanFinance(w.deps, coo, 'NTR-00010', { etag: etagOf(row('NTR-00010')), alasan: 'Perlu revisi' }, key());
    expect(row('NTR-00010')[C('STATUS')]).toBe('Revision Needed');
    expect(aprs('NTR-00010').find((x) => x[CA('Action')] === 'REJECTED')![CA('Level')]).toBe(6);
    expect(await kode(kembalikanFinance(w.deps, coo, 'NTR-00003', { etag: etagOf(row('NTR-00003')), alasan: 'x' }, key()))).toBe('FORBIDDEN'); // Manager Approved = tahap Finance Staff
  });
});
