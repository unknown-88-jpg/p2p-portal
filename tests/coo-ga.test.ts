// Aturan COO (keputusan user 2026-11-09): dokumen dept General Affairs (semua brand, termasuk Shared Service) dengan nominal >= ambang CFO
// wajib persetujuan COO (L6), SESUDAH Fin. Mgr dan SEBELUM CFO. Ambang & mekanisme sama dengan CFO.
import { describe, expect, it } from 'vitest';
import { can } from '@/domain/capabilities';
import { CONFIG, LEVEL, butuhCOO } from '@/domain/config';
import { bangunKotakTTD } from '@/domain/dokumen';
import { cekBolehDibayar, cekEApprove, persetujuanLengkap, statusPersetujuan, targetPersetujuan, tugasRangkapBayar, wajibCOO, type BarisApproval, type StatusPersetujuan } from '@/domain/finance';
import { validasiUser } from '@/domain/admin';

const R = (...l: number[]) => l.map((level) => ({ brand: 'ALL', dept: 'ALL', level }));
const orang = (nama: string) => ({ nama, email: `${nama.toLowerCase()}@x.id` });
const st = (o: Partial<StatusPersetujuan> = {}): StatusPersetujuan => ({ verifikator: orang('Dani'), finMgr: null, coo: null, cfo: null, ...o });

describe('COO: kapan wajib (turunan dari dept + nominal, tanpa kolom baru)', () => {
  it('hanya General Affairs dan nominal >= ambang CFO (batas inklusif, sama dengan CFO)', () => {
    expect(CONFIG.COO_DEPT).toBe('GENERAL AFFAIRS');
    expect(butuhCOO('GENERAL AFFAIRS', 5_000_000)).toBe(true);
    expect(butuhCOO('general affairs ', 9_000_000)).toBe(true); // huruf & spasi tidak jadi celah
    expect(butuhCOO('GENERAL AFFAIRS', 4_999_999)).toBe(false);
    expect(butuhCOO('HCCA', 50_000_000)).toBe(false);
    expect(butuhCOO('FATS', 5_000_000)).toBe(false);
    expect(wajibCOO(undefined, 9e9)).toBe(false);
    expect(wajibCOO('GENERAL AFFAIRS', 5_000_000)).toBe(true);
  });
  it('berlaku untuk GA di semua brand, termasuk Shared Service (yang diputuskan = dept, bukan brand)', () => {
    // Fungsi hanya menerima dept + nominal: brand tidak bisa mengecualikan GA dari aturan ini.
    expect(wajibCOO.length).toBe(2);
    expect(wajibCOO('GENERAL AFFAIRS', 6_000_000)).toBe(true);
  });
});

describe('COO: urutan Fin. Mgr -> COO -> CFO', () => {
  it('targetPersetujuan', () => {
    expect(targetPersetujuan(true, true, st())).toBe('finmgr');
    expect(targetPersetujuan(true, true, st({ finMgr: orang('Eko') }))).toBe('coo');
    expect(targetPersetujuan(true, true, st({ finMgr: orang('Eko'), coo: orang('Rusli') }))).toBe('cfo');
    expect(targetPersetujuan(true, true, st({ finMgr: orang('Eko'), coo: orang('Rusli'), cfo: orang('Gita') }))).toBeNull();
    expect(targetPersetujuan(true, false, st({ finMgr: orang('Eko') }))).toBe('cfo'); // non-GA: tanpa COO
    expect(targetPersetujuan(false, false, st({ finMgr: orang('Eko') }))).toBeNull();
  });
  it('COO: level persis (L6), setelah Fin. Mgr, hanya bila wajib, bukan orang yang sama dengan Fin. Mgr, tidak dobel', () => {
    const fm = st({ finMgr: orang('Eko') });
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, true, fm)).toBeNull();
    expect(cekEApprove('coo', R(5), 'rusli@x.id', true, true, fm)?.kode).toBe('FORBIDDEN');
    expect(cekEApprove('coo', R(4), 'rusli@x.id', true, true, fm)?.kode).toBe('FORBIDDEN');
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, true, st())?.pesan).toMatch(/Fin. Mgr lebih dulu/);
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, false, fm)?.pesan).toMatch(/tidak membutuhkan persetujuan COO/);
    expect(cekEApprove('coo', R(4, 6), 'EKO@x.id', true, true, fm)?.pesan).toMatch(/berbeda dari Fin. Mgr/);
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, true, st({ finMgr: orang('Eko'), coo: orang('Rusli') }))?.kode).toBe('CONFLICT');
  });
  it('CFO ditahan sampai COO setuju (dokumen GA), dan harus orang berbeda dari COO; non-GA tidak berubah', () => {
    const fm = st({ finMgr: orang('Eko') });
    expect(cekEApprove('cfo', R(5), 'gita@x.id', true, true, fm)?.pesan).toMatch(/menunggu persetujuan COO/);
    const lengkap = st({ finMgr: orang('Eko'), coo: orang('Rusli') });
    expect(cekEApprove('cfo', R(5), 'gita@x.id', true, true, lengkap)).toBeNull();
    expect(cekEApprove('cfo', R(5, 6), 'RUSLI@x.id', true, true, lengkap)?.pesan).toMatch(/berbeda dari COO/);
    expect(cekEApprove('cfo', R(5), 'gita@x.id', true, false, fm)).toBeNull();
  });
  it('status baru hanya setelah CFO: Fin. Mgr dan COO tidak pernah menyelesaikan tahap bila CFO/COO wajib', () => {
    expect(persetujuanLengkap('finmgr', true, true)).toBe(false);
    expect(persetujuanLengkap('finmgr', true, false)).toBe(false);
    expect(persetujuanLengkap('finmgr', false, false)).toBe(true);
    expect(persetujuanLengkap('coo', true, true)).toBe(false);
    expect(persetujuanLengkap('cfo', true, true)).toBe(true);
  });
});

describe('COO: gerbang bayar (I4) gagal tertutup', () => {
  const g = { status: 'COA Posted', perluCFO: true, perluCOO: true, subCoa: 'X', manager: true };
  const lengkap = st({ finMgr: orang('Eko'), coo: orang('Rusli'), cfo: orang('Gita') });
  it('GA >= ambang tanpa COO tidak boleh dibayar walau CFO sudah setuju; lengkap = boleh', () => {
    expect(cekBolehDibayar({ ...g, st: st({ finMgr: orang('Eko'), cfo: orang('Gita') }) })).toMatch(/COO/);
    expect(cekBolehDibayar({ ...g, st: lengkap })).toBeNull();
  });
  it('non-GA tidak minta COO', () => {
    expect(cekBolehDibayar({ ...g, perluCOO: false, st: st({ finMgr: orang('Eko'), cfo: orang('Gita') }) })).toBeNull();
  });
  it('persetujuan COO lama (sebelum verifikasi pajak ulang) tidak terbawa ke siklus baru', () => {
    const r = (level: number, t: number, nama = `L${level}`): BarisApproval => ({ level, action: 'APPROVED', nama, email: `${nama.toLowerCase()}@x.id`, timestamp: t });
    expect(statusPersetujuan([r(3, 1), r(4, 2, 'Eko'), r(6, 3, 'Rusli'), r(5, 4, 'Gita'), r(3, 10)])).toMatchObject({ finMgr: null, coo: null, cfo: null });
    expect(statusPersetujuan([r(3, 1), r(4, 2, 'Eko'), r(6, 3, 'Rusli')])).toMatchObject({ finMgr: { nama: 'Eko' }, coo: { nama: 'Rusli' }, cfo: null });
  });
  it('pembayar yang juga COO diberi peringatan tugas rangkap (O5b: peringatan, bukan blokir)', () => {
    expect(tugasRangkapBayar('rusli@x.id', lengkap)).toEqual(['COO']);
  });
});

describe('COO: peran & voucher', () => {
  it('capability: COO bisa e-approve COO + melihat antrean Finance, tidak bisa tindakan Finance Staff / CFO / Admin', () => {
    const coo = R(LEVEL.COO);
    expect(can(coo, 'sign.eapprove.coo')).toBe(true);
    expect(can(coo, 'finance.view')).toBe(true);
    for (const c of ['sign.eapprove.cfo', 'sign.eapprove.finmgr', 'tax.verify', 'journal.post', 'payment.execute', 'admin.manage', 'pengajuan.write', 'approve.manager'] as const) expect(can(coo, c)).toBe(false);
    expect(can(R(LEVEL.CFO), 'sign.eapprove.coo')).toBe(false);
    expect(can(R(LEVEL.ADMIN), 'sign.eapprove.coo')).toBe(false);
  });
  it('kotak TTD: COO hanya untuk dokumen GA >= ambang, berurutan Fin. Mgr -> COO -> CFO', () => {
    const users = [
      { brand: 'B', dept: 'GENERAL AFFAIRS', level: 1, jabatan: 'GA Staff', nama: 'Naila', aktif: 'YES' },
      { brand: 'B', dept: 'GENERAL AFFAIRS', level: 2, jabatan: 'GA Manager', nama: 'Oki', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 3, jabatan: 'Fin', nama: 'Dani', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 4, jabatan: 'FAT Manager', nama: 'Eko', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 6, jabatan: 'Chief Operation Officer', nama: 'Rusli', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 5, jabatan: 'CFO', nama: 'Gita', aktif: 'YES' },
    ];
    const f = (x: unknown): string => String(x);
    expect(bangunKotakTTD(users, new Map(), 'B', 'GENERAL AFFAIRS', true, true, f).map((x) => x.level)).toEqual([1, 2, 3, 4, 6, 5]);
    expect(bangunKotakTTD(users, new Map(), 'B', 'GENERAL AFFAIRS', true, false, f).map((x) => x.level)).toEqual([1, 2, 3, 4, 5]);
    expect(bangunKotakTTD(users, new Map(), 'B', 'GENERAL AFFAIRS', false, false, f).map((x) => x.level)).toEqual([1, 2, 3, 4]);
  });
  it('Admin: level 6 sah untuk form user', () => {
    const r = validasiUser({ brand: 'ALL', dept: 'ALL', level: 6, jabatan: 'COO', nama: 'Rusli', email: 'rusli@dummy.test', aktif: true, noHp: '6285121271997' });
    expect(r.ok).toBe(true);
  });
});
