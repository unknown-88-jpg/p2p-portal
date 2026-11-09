// Alur COO lewat service layer (2026-11-09): dokumen General Affairs yang diajukan >= Rp 5 jt disetujui COO langsung setelah Manager,
// SEBELUM verifikasi pajak. Flag REQUIRE_COO dikunci saat pengajuan; nominal akhir boleh berubah tanpa mengubah kewajiban ini.
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_PPH, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { kembalikanFinance, setujuiFinance, verifikasiPajak } from '@/server/finance-aksi';
import { antreanFinance } from '@/server/finance';
import { kembalikanFinanceSchema, setujuiFinanceSchema, verifikasiPajakSchema } from '@/server/finance-schema';
import { barisUntuk } from '@/server/wa-digest-finance';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const sess = (email: string, nama: string, ...levels: number[]): SessionData => ({ phone: `628${email.length}${nama.length}`, email, nama, jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
const dani = sess('dani@x.id', 'Dani', 3), eko = sess('eko@x.id', 'Eko', 4), gita = sess('gita@x.id', 'Gita', 5), rusli = sess('rusli@x.id', 'Rusli', 6);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

let w: ReturnType<typeof authWorld>;
let k = 0;
const key = (): string => `idem-coo-${String(++k).padStart(8, '0')}`;
const row = (id: string): RawRow => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;
const aprs = (id: string): RawRow[] => w.store.rowsOf(TRX_APPROVAL).filter((r) => r[CA('ID_Trx')] === id);
const tok = async (s: SessionData, stepUp = true): Promise<string> => { const t = await w.deps.sessions.create(s); if (stepUp) await w.deps.sessions.markStepUp(t); return t; };
const setujui = async (s: SessionData, id: string, sebagai: 'finmgr' | 'coo' | 'cfo', o: { stepUp?: boolean } = {}) =>
  setujuiFinance(w.deps, s, await tok(s, o.stepUp ?? true), id, setujuiFinanceSchema.parse({ etag: etagOf(row(id)), sebagai }), key());
const verifikasi = (s: SessionData, id: string, invAmount: number) =>
  verifikasiPajak(w.deps, s, id, verifikasiPajakSchema.parse({ etag: etagOf(row(id)), invAmount, statusPPN: 'Non PPN', jenisPPh: '-' }), key());
const apr = (id: string, level: number, nama: string, t: number, action = 'APPROVED') => [`APR-${id}-${level}-${t}`, id, level, 'x', nama, `${nama.toLowerCase()}@x.id`, 'x', 'E-SIGN', action, t, '', ''];
const ga = (id: string, o: Record<string, string | number>) => trxRow(id, { STATUS: 'Manager Approved', DEPARTEMENT: 'GENERAL AFFAIRS', BRAND: 'All Brand (Shared Service)', CREATED_BY: 'naila@x.id', LAST_UPDATE: 46000, STATUS_PPN: 'Non PPN', ...o });

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(TRX_PENGAJUAN, [
    ga('NTR-00010', { INV_AMOUNT: 7_000_000, FINAL_AMOUNT: 7_000_000, REQUIRE_CFO: 'YES', REQUIRE_COO: 'YES' }),
    ga('NTR-00011', { INV_AMOUNT: 1_000_000, FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO', REQUIRE_COO: 'NO' }),
    ga('NTR-00012', { INV_AMOUNT: 5_200_000, FINAL_AMOUNT: 5_200_000, REQUIRE_CFO: 'YES', REQUIRE_COO: 'YES', BRAND: 'HEYLOCAL' }),
    ga('NTR-00013', { INV_AMOUNT: 1_000_000, FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO', REQUIRE_COO: 'NO', BRAND: 'SHUWA' }),
    ga('NTR-00014', { DEPARTEMENT: 'HCCA', INV_AMOUNT: 7_000_000, FINAL_AMOUNT: 7_000_000, REQUIRE_CFO: 'YES', REQUIRE_COO: 'NO' }),
  ]);
  const a: (string | number)[][] = [];
  for (const id of ['NTR-00010', 'NTR-00011', 'NTR-00012', 'NTR-00013', 'NTR-00014']) a.push(apr(id, 1, 'Naila', 45000), apr(id, 2, 'Oki', 45500));
  w.store.seed(TRX_APPROVAL, a); w.store.seed(AUDIT_LOG, []);
});

describe('COO: alur lewat service', () => {
  it('urutan penuh: verifikasi pajak ditahan -> COO (status tetap Manager Approved) -> pajak -> Fin. Mgr -> CFO -> Wet Signed; approval 1,2,6,3,4,5', async () => {
    expect(await kode(verifikasi(dani, 'NTR-00010', 7_000_000))).toBe('RULE_VIOLATION'); // menunggu COO
    expect(row('NTR-00010')[C('STATUS')]).toBe('Manager Approved');
    expect(await kode(setujui(eko, 'NTR-00010', 'finmgr'))).toBe('CONFLICT'); // belum Tax Verified
    const r = await setujui(rusli, 'NTR-00010', 'coo');
    expect(r).toMatchObject({ status: 'Manager Approved', menungguBerikut: 'pajak', menungguCFO: false });
    expect(row('NTR-00010')[C('STATUS')]).toBe('Manager Approved');
    const l6 = aprs('NTR-00010').find((x) => x[CA('Level')] === 6)!;
    expect([l6[CA('Approver_Email')], l6[CA('Method')], l6[CA('Action')], l6[CA('Role_Label')]]).toEqual(['rusli@x.id', 'E-SIGN', 'APPROVED', 'Disetujui Oleh,']);
    expect(await kode(setujui(rusli, 'NTR-00010', 'coo'))).toBe('CONFLICT'); // COO dua kali
    expect(await verifikasi(dani, 'NTR-00010', 7_000_000)).toMatchObject({ status: 'Tax Verified' });
    expect(await setujui(eko, 'NTR-00010', 'finmgr')).toMatchObject({ status: 'Tax Verified', menungguBerikut: 'cfo' });
    expect(await setujui(gita, 'NTR-00010', 'cfo')).toMatchObject({ status: 'Wet Signed', menungguBerikut: null });
    expect(aprs('NTR-00010').map((x) => x[CA('Level')])).toEqual([1, 2, 6, 3, 4, 5]);
  });
  it('COO harus level 6, step-up password wajib, dan dokumen yang tidak wajib-COO ditolak', async () => {
    for (const s of [eko, gita, dani]) expect(await kode(setujui(s, 'NTR-00010', 'coo'))).toBe('FORBIDDEN');
    const e = await setujui(rusli, 'NTR-00010', 'coo', { stepUp: false }).catch((x: AppError) => x);
    expect(e).toMatchObject({ code: 'FORBIDDEN', fields: { stepUp: 'required' } });
    expect(aprs('NTR-00010').some((x) => x[CA('Level')] === 6)).toBe(false);
    expect(await kode(setujui(rusli, 'NTR-00011', 'coo'))).toBe('RULE_VIOLATION'); // GA di bawah ambang
    expect(await kode(setujui(rusli, 'NTR-00014', 'coo'))).toBe('RULE_VIOLATION'); // bukan GA
  });
  it('nominal AKHIR boleh berubah: yang diajukan >= ambang tetap wajib COO walau turun < 5 jt; yang diajukan < ambang tidak wajib COO walau naik >= 5 jt', async () => {
    // NTR-00012: diajukan 5,2 jt -> verifikasi menurunkan jadi 4,9 jt, tetap menunggu COO
    expect(await kode(verifikasi(dani, 'NTR-00012', 4_900_000))).toBe('RULE_VIOLATION');
    await setujui(rusli, 'NTR-00012', 'coo');
    expect(await verifikasi(dani, 'NTR-00012', 4_900_000)).toMatchObject({ status: 'Tax Verified', finalAmount: 4_900_000, perluCFO: false });
    expect(row('NTR-00012')[C('REQUIRE_COO')]).toBe('YES'); // tidak dihitung ulang
    // NTR-00013: diajukan 1 jt -> verifikasi menaikkan jadi 6 jt: tanpa COO, tetap butuh CFO (I1 dihitung ulang)
    expect(await verifikasi(dani, 'NTR-00013', 6_000_000)).toMatchObject({ status: 'Tax Verified', finalAmount: 6_000_000, perluCFO: true });
    expect(row('NTR-00013')[C('REQUIRE_COO')]).toBe('NO');
    expect(aprs('NTR-00013').some((x) => x[CA('Level')] === 6)).toBe(false);
  });
  it('pertahanan berlapis: dokumen wajib-COO yang (lewat edit manual) sudah Tax Verified tanpa COO tidak bisa disetujui Fin. Mgr/CFO', async () => {
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === 'NTR-00010') x[C('STATUS')] = 'Tax Verified'; return x; }));
    w.store.seed(TRX_APPROVAL, [...w.store.rowsOf(TRX_APPROVAL), apr('NTR-00010', 3, 'Dani', 46001)]);
    expect(await kode(setujui(eko, 'NTR-00010', 'finmgr'))).toBe('RULE_VIOLATION');
    expect(await kode(setujui(gita, 'NTR-00010', 'cfo'))).toBe('RULE_VIOLATION');
  });
  it('pengajuan ulang membatalkan persetujuan COO lama (siklus baru harus disetujui COO lagi)', async () => {
    await setujui(rusli, 'NTR-00010', 'coo');
    await kembalikanFinance(w.deps, dani, 'NTR-00010', kembalikanFinanceSchema.parse({ etag: etagOf(row('NTR-00010')), alasan: 'Lampiran invoice kurang' }), key());
    expect(row('NTR-00010')[C('STATUS')]).toBe('Revision Needed');
    // simulasi PIC mengajukan ulang & Manager menyetujui lagi
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === 'NTR-00010') { x[C('STATUS')] = 'Manager Approved'; x[C('LAST_UPDATE')] = 46100; } return x; }));
    const maks = w.store.rowsOf(TRX_APPROVAL).reduce((m, x) => Math.max(m, Number(x[CA('Timestamp')])), 0);
    w.store.seed(TRX_APPROVAL, [...w.store.rowsOf(TRX_APPROVAL), apr('NTR-00010', 1, 'Naila', maks + 1), apr('NTR-00010', 2, 'Oki', maks + 2)]);
    expect(await kode(verifikasi(dani, 'NTR-00010', 7_000_000))).toBe('RULE_VIOLATION');
    w.clock.advance(3 * 86_400_000); // persetujuan COO baru harus bertanggal SETELAH pengajuan ulang
    expect(await kode(setujui(rusli, 'NTR-00010', 'coo'))).toBe('OK');
    expect(await kode(verifikasi(dani, 'NTR-00010', 7_000_000))).toBe('OK');
  });
  it('COO bisa mengembalikan ke PIC hanya di tahapnya (Manager Approved); level 6 tercatat', async () => {
    await kembalikanFinance(w.deps, rusli, 'NTR-00010', kembalikanFinanceSchema.parse({ etag: etagOf(row('NTR-00010')), alasan: 'Perlu revisi lampiran' }), key());
    expect(row('NTR-00010')[C('STATUS')]).toBe('Revision Needed');
    expect(aprs('NTR-00010').find((x) => x[CA('Action')] === 'REJECTED')![CA('Level')]).toBe(6);
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === 'NTR-00011') x[C('STATUS')] = 'Tax Verified'; return x; }));
    expect(await kode(kembalikanFinance(w.deps, rusli, 'NTR-00011', kembalikanFinanceSchema.parse({ etag: etagOf(row('NTR-00011')), alasan: 'alasan uji' }), key()))).toBe('FORBIDDEN');
  });
  it('antrean & digest: COO melihat dokumen GA yang menunggunya di tahap pajak; staff tidak diberi dokumen yang masih menunggu COO', async () => {
    const qc = await antreanFinance(w.deps, rusli, 'pajak');
    expect(qc.peran).toEqual({ staff: false, finMgr: false, coo: true, cfo: false });
    const i = qc.items.find((x) => x.id === 'NTR-00010')!;
    expect(i).toMatchObject({ perluCOO: true });
    expect(i.persetujuan).toMatchObject({ coo: null });
    expect(qc.items.find((x) => x.id === 'NTR-00014')!.perluCOO).toBe(false);
    const bc = barisUntuk(await antreanFinance(w.deps, rusli), 'https://x');
    expect(bc.find((x) => x.label.startsWith('Persetujuan COO'))).toMatchObject({ jumlah: 2 }); // NTR-00010 & NTR-00012
    const bs = barisUntuk(await antreanFinance(w.deps, dani), 'https://x');
    expect(bs.find((x) => x.label === 'Verifikasi pajak')).toMatchObject({ jumlah: 3 }); // NTR-00011, -13, -14; NTR-00010 & -12 masih menunggu COO
  });
});
