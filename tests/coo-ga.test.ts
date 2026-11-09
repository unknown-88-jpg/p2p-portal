// Aturan COO (keputusan user 2026-11-09): dokumen dept General Affairs (semua brand, termasuk Shared Service) yang DIAJUKAN dengan nominal >= ambang CFO
// wajib persetujuan COO (L6) langsung SETELAH Manager dan SEBELUM verifikasi pajak. Wajib-tidaknya dikunci saat pengajuan (nominal akhir boleh berubah).
import { describe, expect, it } from 'vitest';
import { can } from '@/domain/capabilities';
import { CONFIG, LEVEL, butuhCOO } from '@/domain/config';
import { bangunKotakTTD, petaPersetujuan } from '@/domain/dokumen';
import { cekBolehDibayar, cekEApprove, persetujuanLengkap, statusPersetujuan, targetPersetujuan, tugasRangkapBayar, wajibCOO, type BarisApproval, type StatusPersetujuan } from '@/domain/finance';
import { validasiUser } from '@/domain/admin';

const R = (...l: number[]) => l.map((level) => ({ brand: 'ALL', dept: 'ALL', level }));
const orang = (nama: string) => ({ nama, email: `${nama.toLowerCase()}@x.id` });
const st = (o: Partial<StatusPersetujuan> = {}): StatusPersetujuan => ({ verifikator: null, finMgr: null, coo: null, cfo: null, ...o });
const r = (level: number, t: number, nama = `L${level}`, action = 'APPROVED'): BarisApproval => ({ level, action, nama, email: `${nama.toLowerCase()}@x.id`, timestamp: t });

describe('COO: kapan wajib (dikunci saat pengajuan)', () => {
  it('butuhCOO (dipakai saat pengajuan): hanya General Affairs dan nominal >= ambang CFO (batas inklusif)', () => {
    expect(CONFIG.COO_DEPT).toBe('GENERAL AFFAIRS');
    expect(butuhCOO('GENERAL AFFAIRS', 5_000_000)).toBe(true);
    expect(butuhCOO('general affairs ', 9_000_000)).toBe(true); // huruf & spasi tidak jadi celah
    expect(butuhCOO('GENERAL AFFAIRS', 4_999_999)).toBe(false);
    expect(butuhCOO('HCCA', 50_000_000)).toBe(false);
    expect(butuhCOO('FATS', 5_000_000)).toBe(false);
  });
  it('butuhCOO hanya menerima dept + nominal: brand tidak bisa mengecualikan GA (berlaku semua brand incl. Shared Service)', () => {
    expect(butuhCOO.length).toBe(2);
  });
  it('wajibCOO (dipakai di semua gerbang) = flag REQUIRE_COO YES; kosong (dokumen sebelum aturan) = tidak wajib; tidak bergantung nominal akhir', () => {
    expect(wajibCOO('YES')).toBe(true);
    expect(wajibCOO(' yes ')).toBe(true);
    expect(wajibCOO('NO')).toBe(false);
    expect(wajibCOO('')).toBe(false);
    expect(wajibCOO(undefined)).toBe(false);
    expect(wajibCOO.length).toBe(1);
  });
});

describe('COO: persetujuan siklus pengajuan (sebelum verifikasi pajak)', () => {
  it('COO sebelum verifikasi pajak tetap berlaku setelah L3, Fin. Mgr, dan CFO', () => {
    const s = statusPersetujuan([r(1, 1), r(2, 2), r(6, 3, 'Rusli'), r(3, 4, 'Dani'), r(4, 5, 'Eko'), r(5, 6, 'Gita')]);
    expect(s).toMatchObject({ coo: { nama: 'Rusli' }, finMgr: { nama: 'Eko' }, cfo: { nama: 'Gita' }, verifikator: { nama: 'Dani' } });
  });
  it('pengajuan ulang (L1 baru) membatalkan persetujuan COO lama', () => {
    expect(statusPersetujuan([r(1, 1), r(6, 3, 'Rusli'), r(3, 4), r(4, 5, 'Eko'), r(1, 10), r(2, 11)]).coo).toBeNull();
    expect(statusPersetujuan([r(1, 1), r(6, 3, 'Rusli'), r(1, 10), r(6, 12, 'Rusli')]).coo).toMatchObject({ nama: 'Rusli' });
  });
  it('gagal tertutup: waktu pengajuan tak terbaca = COO dianggap belum ada; REJECTED tidak dihitung', () => {
    expect(statusPersetujuan([{ ...r(1, 0), timestamp: 'rusak' }, r(6, 3, 'Rusli')]).coo).toBeNull();
    expect(statusPersetujuan([r(1, 1), r(6, 3, 'Rusli', 'REJECTED')]).coo).toBeNull();
  });
  it('kotak TTD voucher memakai batas siklus pengajuan untuk COO (bukan setelah L3)', () => {
    const p = petaPersetujuan([
      { level: 1, action: 'APPROVED', nama: 'Naila', jabatan: 'GA', timestamp: 1 }, { level: 2, action: 'APPROVED', nama: 'Oki', jabatan: 'Mgr', timestamp: 2 },
      { level: 6, action: 'APPROVED', nama: 'Rusli', jabatan: 'COO', timestamp: 3 }, { level: 3, action: 'APPROVED', nama: 'Dani', jabatan: 'Fin', timestamp: 4 },
      { level: 4, action: 'APPROVED', nama: 'Eko', jabatan: 'FM', timestamp: 5 },
    ]);
    expect(p.get(6)?.nama).toBe('Rusli');
    expect(petaPersetujuan([{ level: 1, action: 'APPROVED', nama: 'N', jabatan: '', timestamp: 1 }, { level: 6, action: 'APPROVED', nama: 'Rusli', jabatan: 'COO', timestamp: 3 }, { level: 1, action: 'APPROVED', nama: 'N', jabatan: '', timestamp: 9 }]).has(6)).toBe(false);
  });
});

describe('COO: aturan e-approve', () => {
  it('COO: level persis (L6), hanya bila wajib, tidak dobel; tidak bergantung pada Fin. Mgr/CFO', () => {
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, true, st())).toBeNull();
    expect(cekEApprove('coo', R(5), 'rusli@x.id', true, true, st())?.kode).toBe('FORBIDDEN');
    expect(cekEApprove('coo', R(4), 'rusli@x.id', true, true, st())?.kode).toBe('FORBIDDEN');
    expect(cekEApprove('coo', R(3), 'rusli@x.id', true, true, st())?.kode).toBe('FORBIDDEN');
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, false, st())?.pesan).toMatch(/tidak membutuhkan persetujuan COO/);
    expect(cekEApprove('coo', R(6), 'rusli@x.id', true, true, st({ coo: orang('Rusli') }))?.kode).toBe('CONFLICT');
  });
  it('Fin. Mgr dan CFO ditahan sampai COO setuju bila wajib (pertahanan berlapis di luar gerbang verifikasi pajak)', () => {
    expect(cekEApprove('finmgr', R(4), 'eko@x.id', true, true, st())?.pesan).toMatch(/menunggu persetujuan COO/);
    expect(cekEApprove('finmgr', R(4), 'eko@x.id', true, true, st({ coo: orang('Rusli') }))).toBeNull();
    const fm = st({ coo: orang('Rusli'), finMgr: orang('Eko') });
    expect(cekEApprove('cfo', R(5), 'gita@x.id', true, true, st({ finMgr: orang('Eko') }))?.pesan).toMatch(/menunggu persetujuan COO/);
    expect(cekEApprove('cfo', R(5), 'gita@x.id', true, true, fm)).toBeNull();
  });
  it('dua tanda tangan = dua orang: Fin. Mgr ≠ COO dan CFO ≠ COO', () => {
    expect(cekEApprove('finmgr', R(4, 6), 'RUSLI@x.id', true, true, st({ coo: orang('Rusli') }))?.pesan).toMatch(/berbeda dari COO/);
    expect(cekEApprove('cfo', R(5, 6), 'RUSLI@x.id', true, true, st({ coo: orang('Rusli'), finMgr: orang('Eko') }))?.pesan).toMatch(/berbeda dari COO/);
  });
  it('dokumen non-wajib-COO: perilaku Fin. Mgr/CFO tidak berubah', () => {
    expect(cekEApprove('finmgr', R(4), 'eko@x.id', true, false, st())).toBeNull();
    expect(cekEApprove('cfo', R(5), 'gita@x.id', true, false, st({ finMgr: orang('Eko') }))).toBeNull();
  });
  it('tahap persetujuan Finance tetap Fin. Mgr -> CFO (COO tidak ada di tahap ini); status baru hanya setelah CFO bila wajib', () => {
    expect(targetPersetujuan(true, st())).toBe('finmgr');
    expect(targetPersetujuan(true, st({ finMgr: orang('Eko') }))).toBe('cfo');
    expect(targetPersetujuan(false, st({ finMgr: orang('Eko') }))).toBeNull();
    expect(persetujuanLengkap('finmgr', true)).toBe(false);
    expect(persetujuanLengkap('finmgr', false)).toBe(true);
    expect(persetujuanLengkap('cfo', true)).toBe(true);
  });
});

describe('COO: gerbang bayar (I4) gagal tertutup', () => {
  const g = { status: 'COA Posted', perluCFO: true, perluCOO: true, subCoa: 'X', manager: true };
  const dasar = { verifikator: orang('Dani'), finMgr: orang('Eko'), cfo: orang('Gita') };
  it('dokumen wajib-COO tanpa COO tidak boleh dibayar walau CFO sudah setuju; lengkap = boleh', () => {
    expect(cekBolehDibayar({ ...g, st: st(dasar) })).toMatch(/COO/);
    expect(cekBolehDibayar({ ...g, st: st({ ...dasar, coo: orang('Rusli') }) })).toBeNull();
  });
  it('non-wajib-COO tidak minta COO', () => {
    expect(cekBolehDibayar({ ...g, perluCOO: false, st: st(dasar) })).toBeNull();
  });
  it('pembayar yang juga COO diberi peringatan tugas rangkap (O5b: peringatan, bukan blokir)', () => {
    expect(tugasRangkapBayar('rusli@x.id', st({ ...dasar, coo: orang('Rusli') }))).toEqual(['COO']);
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
  it('kotak TTD: COO hanya bila wajib, urutan Manager -> COO -> pajak -> Fin. Mgr -> CFO', () => {
    const users = [
      { brand: 'B', dept: 'GENERAL AFFAIRS', level: 1, jabatan: 'GA Staff', nama: 'Naila', aktif: 'YES' },
      { brand: 'B', dept: 'GENERAL AFFAIRS', level: 2, jabatan: 'GA Manager', nama: 'Oki', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 3, jabatan: 'Fin', nama: 'Dani', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 4, jabatan: 'FAT Manager', nama: 'Eko', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 6, jabatan: 'Chief Operation Officer', nama: 'Rusli', aktif: 'YES' },
      { brand: 'ALL', dept: 'ALL', level: 5, jabatan: 'CFO', nama: 'Gita', aktif: 'YES' },
    ];
    const f = (x: unknown): string => String(x);
    expect(bangunKotakTTD(users, new Map(), 'B', 'GENERAL AFFAIRS', true, true, f).map((x) => x.level)).toEqual([1, 2, 6, 3, 4, 5]);
    expect(bangunKotakTTD(users, new Map(), 'B', 'GENERAL AFFAIRS', true, false, f).map((x) => x.level)).toEqual([1, 2, 3, 4, 5]);
    expect(bangunKotakTTD(users, new Map(), 'B', 'GENERAL AFFAIRS', false, false, f).map((x) => x.level)).toEqual([1, 2, 3, 4]);
  });
  it('Admin: level 6 sah untuk form user', () => {
    expect(validasiUser({ brand: 'ALL', dept: 'ALL', level: 6, jabatan: 'COO', nama: 'Rusli', email: 'rusli@dummy.test', aktif: true, noHp: '6285121271997' }).ok).toBe(true);
  });
});
