import { beforeEach, describe, expect, it } from 'vitest';
import { catatanTampil } from '@/domain/approval';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_PPH, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { kembalikanFinance, verifikasiPajak } from '@/server/finance-aksi';
import { kembalikanFinanceSchema, verifikasiPajakSchema } from '@/server/finance-schema';
import { getPph } from '@/server/master';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const sess = (email: string, nama: string, level: number): SessionData => ({ phone: '6280000000000', email, nama, jabatan: 'Fin Staff', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level }] });
const dani = sess('dani@x.id', 'Dani', 3), fina = sess('fina@x.id', 'Fina', 3);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

let w: ReturnType<typeof authWorld>;
let k = 0;
const key = (): string => `idem-f2b-${String(++k).padStart(8, '0')}`;
const row = (id: string): RawRow => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;
const aprs = (id: string): RawRow[] => w.store.rowsOf(TRX_APPROVAL).filter((r) => r[CA('ID_Trx')] === id);
const logs = (id: string, action?: string): RawRow[] => w.store.rowsOf(AUDIT_LOG).filter((r) => r[CL('ID_Trx')] === id && (!action || r[CL('Action')] === action));
const input = (id: string, o: Partial<{ invAmount: number; diskon: number; biayaLain: number; statusPPN: 'Include PPN' | 'Exclude PPN' | 'Non PPN'; jenisPPh: string; notes: string }> = {}) =>
  verifikasiPajakSchema.parse({ etag: etagOf(row(id)), invAmount: 1_000_000, statusPPN: 'Exclude PPN', jenisPPh: 'PPh 23', ...o });

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(TRX_PENGAJUAN, [
    trxRow('NTR-00001', { STATUS: 'Manager Approved', CREATED_BY: 'citra@x.id', INV_AMOUNT: 1_000_000, STATUS_PPN: 'Non PPN', FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO', NPWP_VENDOR: '01.234.567.8-901.000', TOTAL_PAID: 0, LAST_UPDATE: 46000 }),
    trxRow('NTR-00002', { STATUS: 'Manager Approved', CREATED_BY: 'Dani@X.id ', INV_AMOUNT: 2_000_000, FINAL_AMOUNT: 2_000_000, LAST_UPDATE: 46000 }),
    trxRow('NTR-00003', { STATUS: 'Submitted', CREATED_BY: 'citra@x.id', INV_AMOUNT: 2_000_000, FINAL_AMOUNT: 2_000_000, LAST_UPDATE: 46000 }),
    trxRow('NTR-00004', { STATUS: 'Manager Approved', CREATED_BY: 'citra@x.id', INV_AMOUNT: 4_600_000, STATUS_PPN: 'Non PPN', FINAL_AMOUNT: 4_600_000, REQUIRE_CFO: 'NO', NPWP_VENDOR: '', LAST_UPDATE: 46000 }),
  ]);
  w.store.seed(TRX_APPROVAL, []); w.store.seed(AUDIT_LOG, []);
});

describe('F2-B verifikasi pajak', () => {
  it('lolos: hitung ulang server (Exclude PPN + PPh 23 NPWP 2%), status Tax Verified, approval L3 atas nama verifikator, audit lengkap', async () => {
    const r = await verifikasiPajak(w.deps, dani, 'NTR-00001', input('NTR-00001', { notes: 'cek ok' }), key());
    // DPP 1.000.000, PPN 110.000, PPh 20.000 -> 1.090.000
    expect(r).toMatchObject({ status: 'Tax Verified', finalAmount: 1_090_000, dpp: 1_000_000, ppnAmount: 110_000, pphAmount: 20_000, perluCFO: false, berubah: true });
    const x = row('NTR-00001');
    expect([x[C('STATUS')], x[C('STATUS_PPN')], x[C('JENIS_PPH')], x[C('PPH_RATE')], x[C('FINAL_AMOUNT')], x[C('OS_BALANCE')], x[C('REQUIRE_CFO')]]).toEqual(['Tax Verified', 'Exclude PPN', 'PPh 23', 0.02, 1_090_000, 1_090_000, 'NO']);
    const a = aprs('NTR-00001');
    expect(a).toHaveLength(1);
    expect([a[0]![CA('Level')], a[0]![CA('Approver_Name')], a[0]![CA('Approver_Email')], a[0]![CA('Action')]]).toEqual([3, 'Dani', 'dani@x.id', 'APPROVED']);
    expect(String(a[0]![CA('Notes')])).toContain('Rp 1.090.000');
    expect(logs('NTR-00001', 'STATUS_CHANGE')).toHaveLength(1);
    expect(logs('NTR-00001', 'TAX_ADJUST')).toHaveLength(1);
  });
  it('I1: tanpa NPWP pakai tarif non-NPWP; nominal melewati Rp 5 jt -> REQUIRE_CFO jadi YES (tercatat)', async () => {
    const r = await verifikasiPajak(w.deps, dani, 'NTR-00004', input('NTR-00004', { invAmount: 4_600_000 }), key());
    // DPP 4.600.000 + PPN 506.000 - PPh 4% 184.000 = 4.922.000 -> belum 5 jt
    expect(r).toMatchObject({ finalAmount: 4_922_000, perluCFO: false });
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === 'NTR-00004') { x[C('STATUS')] = 'Manager Approved'; x[C('LAST_UPDATE')] = 46001; } return x; }));
    const r2 = await verifikasiPajak(w.deps, dani, 'NTR-00004', input('NTR-00004', { invAmount: 5_000_000, jenisPPh: '-' }), key());
    expect(r2).toMatchObject({ finalAmount: 5_550_000, perluCFO: true });
    expect(row('NTR-00004')[C('REQUIRE_CFO')]).toBe('YES');
    expect(logs('NTR-00004', 'CFO_FLAG')).toHaveLength(1);
  });
  it('I6: pengaju = verifikator DIBLOKIR (email dinormalisasi); percobaan tercatat; baris tidak berubah', async () => {
    const sebelum = [...row('NTR-00002')];
    const e = await verifikasiPajak(w.deps, dani, 'NTR-00002', input('NTR-00002'), key()).catch((x: AppError) => x);
    expect(e).toMatchObject({ code: 'RULE_VIOLATION' }); expect((e as AppError).message).toMatch(/tidak boleh memverifikasi pajaknya sendiri/);
    expect(row('NTR-00002')).toEqual(sebelum);
    expect(aprs('NTR-00002')).toHaveLength(0);
    expect(logs('NTR-00002', 'TAX_VERIFY_BLOCKED_SOD')).toHaveLength(1);
    expect(await kode(verifikasiPajak(w.deps, fina, 'NTR-00002', input('NTR-00002'), key()))).toBe('OK'); // rekan lain boleh
  });
  it('hanya Finance Staff (L3): Fin. Mgr, CFO, Manager, PIC = 403', async () => {
    for (const l of [1, 2, 4, 5, 9]) expect(await kode(verifikasiPajak(w.deps, sess('x@x.id', 'X', l), 'NTR-00001', input('NTR-00001'), key()))).toBe('FORBIDDEN');
  });
  it('status bukan Manager Approved / etag basi / tidak ada = 409 / 409 / 404; tanpa Idempotency-Key = 400', async () => {
    expect(await kode(verifikasiPajak(w.deps, dani, 'NTR-00003', input('NTR-00003'), key()))).toBe('CONFLICT');
    expect(await kode(verifikasiPajak(w.deps, dani, 'NTR-00001', { ...input('NTR-00001'), etag: 'a'.repeat(20) }, key()))).toBe('CONFLICT');
    expect(await kode(verifikasiPajak(w.deps, dani, 'NTR-09999', { ...input('NTR-00001') }, key()))).toBe('NOT_FOUND');
    expect(await kode(verifikasiPajak(w.deps, dani, 'NTR-00001', input('NTR-00001'), undefined))).toBe('VALIDATION');
  });
  it('idempotensi: kunci sama diulang = satu approval; dua Finance bersamaan = tepat satu berhasil, satu 409', async () => {
    const inp = input('NTR-00001'), kk = key();
    await verifikasiPajak(w.deps, dani, 'NTR-00001', inp, kk);
    await verifikasiPajak(w.deps, dani, 'NTR-00001', inp, kk);
    expect(aprs('NTR-00001')).toHaveLength(1);
    const inp4 = input('NTR-00004');
    const hasil = await Promise.all([kode(verifikasiPajak(w.deps, dani, 'NTR-00004', inp4, key())), kode(verifikasiPajak(w.deps, fina, 'NTR-00004', inp4, key()))]);
    expect(hasil.sort()).toEqual(['CONFLICT', 'OK']);
    expect(aprs('NTR-00004')).toHaveLength(1);
  });
  it('tarif PPh dibaca SEGAR (bukan cache tampilan); jenis PPh tak dikenal = 422', async () => {
    await getPph(w.deps); // isi cache tampilan dengan 2%
    w.store.seed(MASTER_PPH, [['PPh 23', 0.03, 0.06]]);
    const r = await verifikasiPajak(w.deps, dani, 'NTR-00001', input('NTR-00001'), key());
    expect(r.pphAmount).toBe(30_000);
    expect(await kode(verifikasiPajak(w.deps, dani, 'NTR-00004', input('NTR-00004', { jenisPPh: 'PPh Karangan' }), key()))).toBe('RULE_VIOLATION');
  });
  it('schema STRICT: nominal akhir/status dari klien ditolak; nominal pecahan ditolak', () => {
    const base = { etag: 'e'.repeat(20), invAmount: 1000, statusPPN: 'Non PPN' };
    expect(verifikasiPajakSchema.safeParse({ ...base, finalAmount: 1 }).success).toBe(false);
    expect(verifikasiPajakSchema.safeParse({ ...base, status: 'Paid' }).success).toBe(false);
    expect(verifikasiPajakSchema.safeParse({ ...base, invAmount: 1000.5 }).success).toBe(false);
    expect(verifikasiPajakSchema.safeParse(base).success).toBe(true);
  });
});

describe('F2-B kembalikan ke PIC', () => {
  it('Manager Approved -> Revision Needed, alasan di NOTES_FINANCE, approval L3 REJECTED; PIC melihat "Dikembalikan Finance"', async () => {
    await kembalikanFinance(w.deps, dani, 'NTR-00001', kembalikanFinanceSchema.parse({ etag: etagOf(row('NTR-00001')), alasan: 'Faktur pajak belum ada' }), key());
    const x = row('NTR-00001');
    expect(x[C('STATUS')]).toBe('Revision Needed');
    expect(catatanTampil(String(x[C('NOTES_FINANCE')]))).toBe('Dikembalikan Finance: Faktur pajak belum ada');
    expect(aprs('NTR-00001').map((a) => [a[CA('Level')], a[CA('Action')]])).toEqual([[3, 'REJECTED']]);
    expect(logs('NTR-00001', 'STATUS_CHANGE')).toHaveLength(1);
  });
  it('Submitted (belum di Finance) = 409; L4 = 403; alasan < 3 huruf ditolak schema', async () => {
    expect(await kode(kembalikanFinance(w.deps, dani, 'NTR-00003', { etag: etagOf(row('NTR-00003')), alasan: 'xxx' }, key()))).toBe('CONFLICT');
    expect(await kode(kembalikanFinance(w.deps, sess('fm@x.id', 'FM', 4), 'NTR-00001', { etag: etagOf(row('NTR-00001')), alasan: 'xxx' }, key()))).toBe('FORBIDDEN');
    expect(kembalikanFinanceSchema.safeParse({ etag: 'e'.repeat(20), alasan: 'ok' }).success).toBe(false);
  });
  it('pengaju sendiri BOLEH mengembalikan (tidak melepaskan uang; sama dengan financeReject lama)', async () => {
    expect(await kode(kembalikanFinance(w.deps, dani, 'NTR-00002', { etag: etagOf(row('NTR-00002')), alasan: 'Salah lampiran' }, key()))).toBe('OK');
  });
});
