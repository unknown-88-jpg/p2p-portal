import { beforeEach, describe, expect, it } from 'vitest';
import { peringatanVendor, rekeningSama, validasiVendor } from '@/domain/vendor';
import { daftarVendor as listUntukWizard } from '@/domain/master';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_USER_TTD, MASTER_VENDOR, colIndex } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { antreanVendor, daftarVendor, putuskanVendor, vendorSaya } from '@/server/vendor';
import { authWorld, USERS } from './auth-helpers';

const CV = (k: string): number => colIndex(MASTER_VENDOR, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const sess = (email: string, nama: string, ...levels: number[]): SessionData => ({ phone: `628${email.length}`, email, nama, jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
const citra = sess('citra@x.id', 'Citra', 1), dani = sess('dani@x.id', 'Dani', 3), fina = sess('fina@x.id', 'Fina', 3), fm = sess('fm@x.id', 'FM', 4);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const input = (o: Record<string, string> = {}) => ({ namaVendor: 'pt maju jaya', tipeVendor: 'Non-Trade', npwp: '', bank: 'bca', namaRekening: 'pt maju jaya', noRekening: '1234 5678 90', ...o });

let w: ReturnType<typeof authWorld>;
const rows = () => w.store.rowsOf(MASTER_VENDOR);
const vRow = (k: string) => rows().find((r) => r[0] === k)!;

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [...USERS, ['ALL', 'ALL', 3, 'Fin', 'Fina', 'fina@x.id', 'YES', '081200000021', null, null]]);
  w.store.seed(MASTER_VENDOR, [
    ['VND-0007', 'GAMA', 'Non-Trade', '01.2', 'MANDIRI', 'GAMA', '9999999999', 'Approved', 'x@x.id', 46000],
    ['VND-0003', 'LAMA DITOLAK', 'Trade', '', 'BNI', 'LAMA', '5555555555', 'Rejected', 'x@x.id', 46000],
  ]);
  w.store.seed(AUDIT_LOG, []);
});

describe('F3-A domain', () => {
  it('validasi & normalisasi: huruf besar, pemisah rekening dibuang, 6–20 digit, tipe wajib', () => {
    const v = validasiVendor(input());
    expect(v).toMatchObject({ ok: true, v: { nama: 'PT MAJU JAYA', bank: 'BCA', noRekening: '1234567890' } });
    expect(validasiVendor(input({ noRekening: '12a45678' }))).toMatchObject({ ok: false, galat: { noRekening: expect.stringMatching(/6–20 digit/) } });
    expect(validasiVendor(input({ noRekening: '12345' })).ok).toBe(false);
    expect(validasiVendor(input({ tipeVendor: 'Jasa' }))).toMatchObject({ ok: false, galat: { tipeVendor: expect.any(String) } });
    expect(validasiVendor(input({ namaVendor: ' ', bank: '' }))).toMatchObject({ ok: false, galat: { namaVendor: expect.any(String), bank: expect.any(String) } });
  });
  it('I7: rekening sama = bank + nomor; vendor Rejected tidak menghalangi; bank lain = hanya peringatan', () => {
    const r = rows();
    expect(rekeningSama(r, 'mandiri', '99999 99999')?.kode).toBe('VND-0007');
    expect(rekeningSama(r, 'BNI', '5555555555')).toBeNull();
    expect(rekeningSama(r, 'BCA', '9999999999')).toBeNull();
    const p = peringatanVendor({ kode: 'VND-0099', nama: 'GAMA', tipe: 'Trade', npwp: '', bank: 'BCA', namaRekening: 'X', noRekening: '9999999999', status: 'Pending' }, r);
    expect(p.join(' | ')).toMatch(/NPWP kosong.*sama dengan VND-0007.*Nama vendor sama/);
  });
});

describe('F3-A daftar vendor', () => {
  it('PIC mendaftar: kode lanjut dari nomor tertinggi di sheet, status Pending, pendaftar & tanggal dari server; audit tanpa nomor rekening penuh', async () => {
    const r = await daftarVendor(w.deps, citra, input(), 'idem-v-00000001');
    expect(r).toEqual({ kode: 'VND-0008', nama: 'PT MAJU JAYA', status: 'Pending' });
    const x = vRow('VND-0008');
    expect([x[CV('Status')], x[CV('Didaftarkan_Oleh')], x[CV('No Rekening')], x[CV('Bank')]]).toEqual(['Pending', 'citra@x.id', '1234567890', 'BCA']);
    const a = w.store.rowsOf(AUDIT_LOG).find((l) => l[CL('Action')] === 'VENDOR_CREATE')!;
    expect(String(a[CL('Notes')])).not.toContain('1234567890');
    expect(listUntukWizard(rows(), 'Non-Trade').map((v) => v.kode)).toEqual(['VND-0007']); // Pending belum bisa dipakai (I8)
  });
  it('I7 duplikat: Finance melihat vendor pemilik rekening; PIC hanya pesan umum (tidak bocor)', async () => {
    const e1 = await daftarVendor(w.deps, citra, input({ bank: 'Mandiri', noRekening: '9999999999' })).catch((e: AppError) => e);
    expect(e1).toMatchObject({ code: 'RULE_VIOLATION' }); expect((e1 as AppError).message).not.toMatch(/GAMA|VND-0007/);
    const e2 = await daftarVendor(w.deps, dani, input({ bank: 'Mandiri', noRekening: '9999999999' })).catch((e: AppError) => e);
    expect((e2 as AppError).message).toMatch(/GAMA.*VND-0007/);
  });
  it('race: dua pendaftaran rekening sama bersamaan -> tepat satu tercatat', async () => {
    const hasil = await Promise.all([kode(daftarVendor(w.deps, citra, input())), kode(daftarVendor(w.deps, dani, input({ namaVendor: 'nama lain' })))]);
    expect(hasil.sort()).toEqual(['OK', 'RULE_VIOLATION']);
    expect(rows().filter((r) => r[CV('No Rekening')] === '1234567890')).toHaveLength(1);
  });
  it('Fin. Mgr / CFO tidak berwenang mendaftar; validasi = 400 dengan galat per kolom', async () => {
    expect(await kode(daftarVendor(w.deps, fm, input()))).toBe('FORBIDDEN');
    expect(await daftarVendor(w.deps, citra, input({ noRekening: 'abc' })).catch((e: AppError) => e)).toMatchObject({ code: 'VALIDATION', fields: { noRekening: expect.any(String) } });
  });
});

describe('F3-A pengesahan (maker-checker, R-21)', () => {
  beforeEach(async () => { await daftarVendor(w.deps, dani, input()); }); // VND-0008 didaftarkan Dani (Finance)
  const rek = { bank: 'BCA', noRekening: '1234567890' };
  it('antrean hanya Finance Staff; menandai milik sendiri & peringatan', async () => {
    expect(await kode(antreanVendor(w.deps, citra))).toBe('FORBIDDEN');
    const q = await antreanVendor(w.deps, dani);
    expect(q.map((v) => [v.kode, v.milikSaya, v.didaftarkanOleh])).toEqual([['VND-0008', true, 'Dani']]);
    expect(q[0]!.peringatan.join(' ')).toMatch(/NPWP kosong/);
  });
  it('pendaftar tidak bisa mengesahkan sendiri; rekan Finance bisa -> Approved -> muncul di wizard (I8)', async () => {
    expect(await kode(putuskanVendor(w.deps, dani, 'VND-0008', 'approve', rek))).toBe('RULE_VIOLATION');
    expect(await kode(putuskanVendor(w.deps, fina, 'VND-0008', 'approve', rek))).toBe('OK');
    expect(vRow('VND-0008')[CV('Status')]).toBe('Approved');
    expect(listUntukWizard(rows(), 'Non-Trade').map((v) => v.kode)).toContain('VND-0008');
  });
  it('R-21: sheet diurutkan ulang di antara render & klik -> vendor yang BENAR yang disahkan (berdasarkan kode)', async () => {
    w.store.reorder(MASTER_VENDOR, (r) => [...r].reverse());
    await putuskanVendor(w.deps, fina, 'VND-0008', 'approve', rek);
    expect(vRow('VND-0008')[CV('Status')]).toBe('Approved');
    expect(vRow('VND-0003')[CV('Status')]).toBe('Rejected');
    expect(vRow('VND-0007')[CV('Status')]).toBe('Approved');
  });
  it('R-21: vendor Rejected tidak bisa disahkan; rekening yang dilihat beda dari sheet = 409; kode tak ada = 404', async () => {
    expect(await kode(putuskanVendor(w.deps, fina, 'VND-0003', 'approve', { bank: 'BNI', noRekening: '5555555555' }))).toBe('CONFLICT');
    expect(await kode(putuskanVendor(w.deps, fina, 'VND-0008', 'approve', { bank: 'BCA', noRekening: '1234567891' }))).toBe('CONFLICT');
    expect(await kode(putuskanVendor(w.deps, fina, 'VND-9999', 'approve', rek))).toBe('NOT_FOUND');
  });
  it('tolak: alasan tercatat di audit; pendaftar boleh menolak miliknya; setelah ditolak rekening boleh didaftarkan ulang', async () => {
    await putuskanVendor(w.deps, dani, 'VND-0008', 'reject', { ...rek, alasan: 'Salah nama' });
    expect(vRow('VND-0008')[CV('Status')]).toBe('Rejected');
    expect(w.store.rowsOf(AUDIT_LOG).some((l) => l[CL('Action')] === 'VENDOR_REJECT' && String(l[CL('Notes')]).includes('Salah nama'))).toBe(true);
    expect(await kode(daftarVendor(w.deps, citra, input()))).toBe('OK');
    expect((await vendorSaya(w.deps, citra))[0]).toMatchObject({ status: 'Pending', noRekening: '••••7890' });
  });
  it('PIC / Fin. Mgr tidak bisa mengesahkan', async () => {
    for (const s of [citra, fm]) expect(await kode(putuskanVendor(w.deps, s, 'VND-0008', 'approve', rek))).toBe('FORBIDDEN');
  });
});
