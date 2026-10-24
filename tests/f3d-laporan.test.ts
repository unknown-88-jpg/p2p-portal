import { beforeEach, describe, expect, it } from 'vitest';
import { agingAP, bucketAging, cariAudit, logPembayaran, rekapPeriode } from '@/domain/laporan';
import { AppError } from '@/lib/errors';
import type { RawRow } from '@/ports/store';
import { AUDIT_LOG, TRX_PAYMENT_LOG, TRX_PENGAJUAN, type TabSchema } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { auditQuery, laporanAging, laporanPembayaran, laporanRekap, lihatAudit, parseQuery, rekapQuery } from '@/server/laporan';
import { authWorld } from './auth-helpers';

const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const baris = (schema: TabSchema, o: Record<string, unknown>): RawRow => schema.cols.map((c) => (o[c.key] ?? null) as RawRow[number]);
const sess = (...levels: number[]): SessionData => ({ phone: '62800', email: 'x@x.id', nama: 'X', jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
// serial tanggal (WIB) — 46300 = 2026-10-05
const S = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000 + 25569;

// Contoh perhitungan manual (hari ini 2026-10-24):
//  A  COA Posted     10.000.000, bayar 0          due 2026-10-30 -> belum jatuh tempo, sisa 10.000.000
//  B  Partially Paid  6.000.000, bayar 2.500.000  due 2026-10-01 -> lewat 23 hr (0–30),  sisa 3.500.000
//  C  Tax Verified    1.200.000                   due 2026-08-30 -> lewat 55 hr (31–60), sisa 1.200.000
//  D  Manager Appr.     800.000                   due 2026-07-01 -> lewat 115 hr (>60),  sisa   800.000
//  E  Paid            2.000.000, bayar 2.000.000  -> tidak dihitung
//  F  Draft / G Rejected / H Submitted -> tidak dihitung (belum/bukan kewajiban)
//  I  COA Posted        500.000, due kosong       -> tanpa jatuh tempo, sisa 500.000
//  J  Partially Paid    300.000, bayar 300.000 (log), kolom belum sinkron -> lunas lewat log, tidak dihitung
//  Total sisa = 10.000.000 + 3.500.000 + 1.200.000 + 800.000 + 500.000 = 16.000.000
const PENGAJUAN = [
  { ID_TRX: 'NTR-A', STATUS: 'COA Posted', VENDOR_NAME: 'PT SATU', BRAND: 'HL', DEPARTEMENT: 'OPS', FINAL_AMOUNT: 10_000_000, DUE_DATE: S('2026-10-30'), DATE_INVOICE: S('2026-10-02'), SUB_COA: 'Beban Sewa', BUDGET: 'EV1' },
  { ID_TRX: 'NTR-B', STATUS: 'Partially Paid', VENDOR_NAME: 'PT SATU', BRAND: 'HL', DEPARTEMENT: 'MKT', FINAL_AMOUNT: 6_000_000, DUE_DATE: S('2026-10-01'), DATE_INVOICE: S('2026-09-20'), SUB_COA: 'Beban Iklan', BUDGET: 'EV1' },
  { ID_TRX: 'TRD-C', STATUS: 'Tax Verified', VENDOR_NAME: 'CV DUA', BRAND: 'HM', DEPARTEMENT: 'OPS', FINAL_AMOUNT: 1_200_000, DUE_DATE: S('2026-08-30'), DATE_INVOICE: S('2026-10-10'), SUB_COA: '-', BUDGET: '' },
  { ID_TRX: 'TRD-D', STATUS: 'Manager Approved', VENDOR_NAME: 'CV DUA', BRAND: 'HM', DEPARTEMENT: 'OPS', FINAL_AMOUNT: 800_000, DUE_DATE: S('2026-07-01'), DATE_INVOICE: S('2026-10-11') },
  { ID_TRX: 'NTR-E', STATUS: 'Paid', VENDOR_NAME: 'PT TIGA', BRAND: 'HL', DEPARTEMENT: 'OPS', FINAL_AMOUNT: 2_000_000, DUE_DATE: S('2026-09-01'), DATE_INVOICE: S('2026-10-03'), SUB_COA: 'Beban Sewa' },
  { ID_TRX: 'NTR-F', STATUS: 'Draft', VENDOR_NAME: 'PT X', FINAL_AMOUNT: 9, DATE_INVOICE: S('2026-10-03') },
  { ID_TRX: 'NTR-G', STATUS: 'Rejected', VENDOR_NAME: 'PT X', FINAL_AMOUNT: 9, DATE_INVOICE: S('2026-10-03') },
  { ID_TRX: 'NTR-H', STATUS: 'Submitted', VENDOR_NAME: 'PT EMPAT', BRAND: 'HL', DEPARTEMENT: 'OPS', FINAL_AMOUNT: 400_000, DATE_INVOICE: '', TIMESTAMP: S('2026-10-15') + 0.5 },
  { ID_TRX: 'NTR-I', STATUS: 'COA Posted', VENDOR_NAME: 'PT EMPAT', BRAND: 'HL', DEPARTEMENT: 'OPS', FINAL_AMOUNT: 500_000, DUE_DATE: '', DATE_INVOICE: S('2026-11-02') },
  { ID_TRX: 'NTR-J', STATUS: 'Partially Paid', VENDOR_NAME: 'PT EMPAT', FINAL_AMOUNT: 300_000, DUE_DATE: S('2026-10-01') },
];
const BAYAR = [
  { Log_ID: 'PAY-1', ID_Trx: 'NTR-B', Tgl_Bayar: S('2026-10-05'), Nominal: 1_000_000, Sumber_Rekening: 'BCA Ops', Ref_No: 'R1', Created_By: 'fs@x.id' },
  { Log_ID: 'PAY-2', ID_Trx: 'ntr-b', Tgl_Bayar: S('2026-10-20'), Nominal: 1_500_000, Sumber_Rekening: 'BCA Ops', Ref_No: 'R2', Created_By: 'fs@x.id' },
  { Log_ID: 'PAY-3', ID_Trx: 'NTR-E', Tgl_Bayar: S('2026-09-30'), Nominal: 2_000_000, Sumber_Rekening: 'Mandiri', Ref_No: '', Created_By: 'fs@x.id' },
  { Log_ID: 'PAY-4', ID_Trx: 'NTR-J', Tgl_Bayar: S('2026-10-21'), Nominal: 300_000, Sumber_Rekening: 'BCA Ops', Ref_No: '', Created_By: 'fs@x.id' },
];

describe('F3-D domain — cocok dengan perhitungan manual', () => {
  it('bucket umur dari jatuh tempo', () => {
    expect([bucketAging('2026-10-24', '2026-10-24'), bucketAging('2026-09-24', '2026-10-24'), bucketAging('2026-09-23', '2026-10-24'), bucketAging('2026-08-25', '2026-10-24'), bucketAging('2026-08-24', '2026-10-24'), bucketAging('', '2026-10-24')].map((x) => x.bucket))
      .toEqual(['Belum jatuh tempo', '0–30 hari', '31–60 hari', '31–60 hari', '> 60 hari', 'Tanpa jatuh tempo']);
  });

  it('aging AP: sisa dari payment log, per bucket & per vendor', () => {
    const a = agingAP(PENGAJUAN, BAYAR, '2026-10-24');
    expect(a.baris.map((b) => [b.id, b.bucket, b.hariLewat, b.sisa])).toEqual([
      ['TRD-D', '> 60 hari', 115, 800_000], ['TRD-C', '31–60 hari', 55, 1_200_000], ['NTR-B', '0–30 hari', 23, 3_500_000], ['NTR-A', 'Belum jatuh tempo', -6, 10_000_000], ['NTR-I', 'Tanpa jatuh tempo', null, 500_000],
    ]);
    expect(a.totalSisa).toBe(16_000_000);
    expect(a.perBucket).toEqual([
      { bucket: 'Belum jatuh tempo', jumlah: 1, sisa: 10_000_000 }, { bucket: '0–30 hari', jumlah: 1, sisa: 3_500_000 }, { bucket: '31–60 hari', jumlah: 1, sisa: 1_200_000 },
      { bucket: '> 60 hari', jumlah: 1, sisa: 800_000 }, { bucket: 'Tanpa jatuh tempo', jumlah: 1, sisa: 500_000 },
    ]);
    expect(a.perVendor).toEqual([
      { vendor: 'PT SATU', jumlah: 2, sisa: 13_500_000, terlama: 23 }, { vendor: 'CV DUA', jumlah: 2, sisa: 2_000_000, terlama: 115 }, { vendor: 'PT EMPAT', jumlah: 1, sisa: 500_000, terlama: null },
    ]);
  });

  it('rekap periode Oktober per brand / COA (tanggal invoice, fallback submit; Paid sisa 0)', () => {
    const q = { dari: '2026-10-01', sampai: '2026-10-31' };
    const b = rekapPeriode(PENGAJUAN, BAYAR, { ...q, dimensi: 'brand' });
    // HL: A 10jt + E 2jt (dibayar 2jt) + H 0,4jt (fallback 15 Okt) ; HM: C 1,2jt + D 0,8jt ; B (Sept) & I (Nov) di luar
    expect(b.baris).toEqual([
      { kunci: 'HL', jumlah: 3, total: 12_400_000, dibayar: 2_000_000, sisa: 10_400_000 },
      { kunci: 'HM', jumlah: 2, total: 2_000_000, dibayar: 0, sisa: 2_000_000 },
    ]);
    expect(b.total).toEqual({ kunci: 'Total', jumlah: 5, total: 14_400_000, dibayar: 2_000_000, sisa: 12_400_000 });
    const c = rekapPeriode(PENGAJUAN, BAYAR, { ...q, dimensi: 'coa' });
    expect(c.baris.map((x) => [x.kunci, x.total])).toEqual([['Beban Sewa', 12_000_000], ['(belum dijurnal)', 2_400_000]]);
  });

  it('log pembayaran per tanggal bayar, terbaru dulu, total', () => {
    const l = logPembayaran(BAYAR, PENGAJUAN, { dari: '2026-10-01', sampai: '2026-10-31' });
    expect(l.baris.map((x) => [x.logId, x.tgl, x.idTrx, x.vendor])).toEqual([['PAY-4', '2026-10-21', 'NTR-J', 'PT EMPAT'], ['PAY-2', '2026-10-20', 'NTR-B', 'PT SATU'], ['PAY-1', '2026-10-05', 'NTR-B', 'PT SATU']]);
    expect(l.total).toBe(2_800_000);
  });

  it('viewer audit: filter ID/aktor/aksi/tanggal, terbaru dulu, penanda idempotensi disembunyikan', () => {
    const rows = [
      { Log_ID: 'LOG-1', Timestamp: S('2026-10-01') + 0.4, User_Email: 'fs@x.id', ID_Trx: 'NTR-B', Action: 'PAYMENT', Notes: 'ok [idem:abcd1234:k-1]' },
      { Log_ID: 'LOG-2', Timestamp: S('2026-10-02') + 0.4, User_Email: 'fm@x.id', ID_Trx: 'NTR-B', Action: 'APPROVE_FINMGR' },
      { Log_ID: 'LOG-3', Timestamp: S('2026-10-03') + 0.4, User_Email: 'fs@x.id', ID_Trx: 'NTR-C', Action: 'PAYMENT' },
    ];
    expect(cariAudit(rows, {}).baris.map((b) => b.logId)).toEqual(['LOG-3', 'LOG-2', 'LOG-1']);
    expect(cariAudit(rows, { id: 'ntr-b', aksi: 'payment' }).baris.map((b) => [b.logId, b.catatan])).toEqual([['LOG-1', 'ok']]);
    expect(cariAudit(rows, { aktor: 'FS@', dari: '2026-10-02', sampai: '2026-10-03' }).baris.map((b) => b.logId)).toEqual(['LOG-3']);
  });
});

describe('F3-D service', () => {
  let w: ReturnType<typeof authWorld>;
  beforeEach(() => {
    w = authWorld();
    w.store.seed(TRX_PENGAJUAN, PENGAJUAN.map((o) => baris(TRX_PENGAJUAN, o)));
    w.store.seed(TRX_PAYMENT_LOG, BAYAR.map((o) => baris(TRX_PAYMENT_LOG, o)));
    w.store.seed(AUDIT_LOG, [baris(AUDIT_LOG, { Log_ID: 'LOG-1', Timestamp: S('2026-10-01'), User_Email: 'a@x.id', ID_Trx: 'NTR-B', Action: 'PAYMENT' })]);
    w.clock.t = Date.parse('2026-10-24T03:00:00Z');
  });

  it('laporan: Finance Staff / Fin. Mgr / CFO / Admin; PIC & Manager ditolak. Audit: Fin. Mgr / CFO / Admin saja', async () => {
    for (const l of [1, 2]) expect(await kode(laporanAging(w.deps, sess(l)))).toBe('FORBIDDEN');
    for (const l of [3, 4, 5, 9]) expect(await kode(laporanAging(w.deps, sess(l)))).toBe('OK');
    for (const l of [1, 2, 3]) expect(await kode(lihatAudit(w.deps, sess(l), {}))).toBe('FORBIDDEN');
    for (const l of [4, 5, 9]) expect(await kode(lihatAudit(w.deps, sess(l), {}))).toBe('OK');
  });

  it('angka service = angka domain (satu sumber data)', async () => {
    const a = await laporanAging(w.deps, sess(3));
    expect([a.hariIni, a.totalSisa, a.basi]).toEqual(['2026-10-24', 16_000_000, false]);
    const r = await laporanRekap(w.deps, sess(4), { dari: '2026-10-01', sampai: '2026-10-31', dimensi: 'brand' });
    expect(r.total.total).toBe(14_400_000);
    const p = await laporanPembayaran(w.deps, sess(5), { dari: '2026-10-01', sampai: '2026-10-31' });
    expect(p.total).toBe(2_800_000);
    const au = await lihatAudit(w.deps, sess(9), { id: 'NTR-B' });
    expect(au.baris[0]).toMatchObject({ logId: 'LOG-1', aksi: 'PAYMENT', waktu: '01/10/2026 00:00' });
  });

  it('query divalidasi: tanggal rusak / terbalik / dimensi asing / parameter asing ditolak', () => {
    const q = (s: string) => new Request(`http://x/api?${s}`);
    expect(parseQuery(q('dari=2026-10-01&sampai=2026-10-31&dimensi=coa'), rekapQuery)).toEqual({ dari: '2026-10-01', sampai: '2026-10-31', dimensi: 'coa' });
    expect(() => parseQuery(q('dari=2026-11-01&sampai=2026-10-31&dimensi=coa'), rekapQuery)).toThrow(AppError);
    expect(() => parseQuery(q('dari=x&sampai=2026-10-31&dimensi=coa'), rekapQuery)).toThrow(AppError);
    expect(() => parseQuery(q('dari=2026-10-01&sampai=2026-10-31&dimensi=gaji'), rekapQuery)).toThrow(AppError);
    expect(() => parseQuery(q('id=1&hack=1'), auditQuery)).toThrow(AppError);
    expect(parseQuery(q('id=&aksi=PAYMENT'), auditQuery)).toEqual({ aksi: 'PAYMENT' });
  });
});
