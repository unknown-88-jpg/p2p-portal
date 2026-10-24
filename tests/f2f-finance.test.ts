import { beforeEach, describe, expect, it } from 'vitest';
import { pesanDigestFinance, pesanPICDikembalikan } from '@/domain/wa';
import { AppError } from '@/lib/errors';
import { MASTER_USER_TTD, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { detail, riwayatBayar } from '@/server/dokumen';
import { kirimDigestFinance } from '@/server/wa-digest-finance';
import { notifPIC } from '@/server/wa-notif';
import { authWorld, USERS } from './auth-helpers';
import { trxRow } from './helpers';

const sess = (email: string, ...levels: number[]): SessionData => ({ phone: '6280', email, nama: email, jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'BRAND A', dept: 'DEPT X', level })) });
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const PH = { dani: '6281200000003', fina: '6281200000021', eko: '6281200000022', gita: '6281200000023', citra: '6281200000002' };
const apr = (id: string, level: number, email: string, t: number) => [`APR-${id}-${level}`, id, level, 'x', email.split('@')[0]!, email, 'x', 'E-SIGN', 'APPROVED', t, '', ''];

let w: ReturnType<typeof authWorld>;
const to = (p: string): string[] => w.wa.sent.filter((m) => m.to === p).map((m) => m.text);

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [
    ...USERS,
    ['ALL', 'ALL', 3, 'Fin Staff', 'Fina', 'fina@x.id', 'YES', '081200000021', null, null],
    ['ALL', 'ALL', 4, 'Fin Mgr', 'Eko M', 'ekom@x.id', 'YES', '081200000022', null, null],
    ['ALL', 'ALL', 5, 'CFO', 'Gita', 'gita@x.id', 'YES', '081200000023', null, null],
  ]);
  w.store.seed(TRX_PENGAJUAN, [
    trxRow('NTR-00001', { STATUS: 'Manager Approved', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 1_000_000, BRAND: 'BRAND A', DEPARTEMENT: 'DEPT X', LAST_UPDATE: 46000 }),
    trxRow('NTR-00002', { STATUS: 'Manager Approved', CREATED_BY: 'dani@x.id', FINAL_AMOUNT: 2_000_000, LAST_UPDATE: 46000 }),
    trxRow('NTR-00003', { STATUS: 'Tax Verified', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 7_000_000, REQUIRE_CFO: 'YES', LAST_UPDATE: 46000 }),
    trxRow('NTR-00004', { STATUS: 'Tax Verified', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 6_000_000, REQUIRE_CFO: 'YES', LAST_UPDATE: 46000 }),
    trxRow('NTR-00005', { STATUS: 'Partially Paid', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 1_000_000, TOTAL_PAID: 400_000, SUB_COA: 'X', BUDGET: 'B', BRAND: 'BRAND A', DEPARTEMENT: 'DEPT X', LAST_UPDATE: 46000 }),
  ]);
  w.store.seed(TRX_APPROVAL, [
    apr('NTR-00003', 3, 'dani@x.id', 46000), apr('NTR-00004', 3, 'dani@x.id', 46000), apr('NTR-00004', 4, 'ekom@x.id', 46001),
    apr('NTR-00005', 2, 'budi@x.id', 45990), apr('NTR-00005', 3, 'dani@x.id', 46000), apr('NTR-00005', 4, 'ekom@x.id', 46001),
  ]);
  w.store.seed(TRX_PAYMENT_LOG, [['PAY-1', 'NTR-00005', 46010, 400_000, 'BCA 123', 'TRF-1', 'fina@x.id', 46010]]);
});

describe('F2-F riwayat pembayaran', () => {
  it('dari Trx_Payment_Log: daftar, total, sisa, nama pembayar; ikut di detail dokumen', async () => {
    const r = await riwayatBayar(w.deps, sess('citra@x.id', 1), 'NTR-00005');
    expect(r).toEqual({ items: [{ tgl: expect.any(String), nominal: 400_000, sumber: 'BCA 123', ref: 'TRF-1', oleh: 'Fina' }], total: 400_000, sisa: 600_000 });
    expect((await detail(w.deps, sess('fina@x.id', 3), 'NTR-00005')).pembayaran.total).toBe(400_000);
  });
  it('I13: bukan pemilik / Manager divisi lain = 404', async () => {
    expect(await kode(riwayatBayar(w.deps, { ...sess('lain@x.id', 1) }, 'NTR-00005'))).toBe('NOT_FOUND');
  });
});

describe('F2-F notifikasi PIC saat dikembalikan Finance', () => {
  it('pesan menyebut Finance; dedup terpisah dari pengembalian Manager; gagal kirim tidak melempar (I15)', async () => {
    expect(pesanPICDikembalikan('NTR-1', 'Faktur kurang', 'L', 'Finance')).toContain('dikembalikan oleh Finance');
    expect(pesanPICDikembalikan('NTR-1', 'x', 'L')).toContain('dikembalikan oleh Manager');
    await notifPIC(w.deps, { idTrx: 'NTR-00001', jenis: 'dikembalikan', catatan: 'Faktur kurang', oleh: 'Finance' });
    await notifPIC(w.deps, { idTrx: 'NTR-00001', jenis: 'dikembalikan', catatan: 'Faktur kurang', oleh: 'Finance' });
    expect(to(PH.citra)).toHaveLength(1);
    expect(to(PH.citra)[0]).toMatch(/dikembalikan oleh Finance[\s\S]*Faktur kurang/);
    w.wa.failNext = true;
    await expect(notifPIC(w.deps, { idTrx: 'NTR-00003', jenis: 'dikembalikan', catatan: 'x', oleh: 'Finance' })).resolves.toBeUndefined();
  });
});

describe('F2-F digest WA Finance', () => {
  it('per peran: staff (pajak tanpa ajuan sendiri, bayar), Fin. Mgr (belum disetujui), CFO (sudah Fin. Mgr); tanpa kode SETUJU', async () => {
    const r = await kirimDigestFinance(w.deps);
    expect(r).toMatchObject({ penerima: 4, terkirim: 4, gagal: 0 });
    const dani = to(PH.dani)[0]!, fina = to(PH.fina)[0]!;
    expect(dani).toMatch(/Verifikasi pajak\*: 1 dokumen/); // NTR-00002 milik Dani tidak dihitung (I6)
    expect(fina).toMatch(/Verifikasi pajak\*: 2 dokumen/);
    expect(fina).toMatch(/Siap dibayar\*: 1 dokumen · Rp 600\.000/);
    expect(fina).toContain('/finance?tahap=bayar');
    expect(to(PH.eko)[0]).toMatch(/Persetujuan Fin. Mgr\*: 1 dokumen/); // NTR-00003 (NTR-00004 sudah)
    expect(to(PH.gita)[0]).toMatch(/Persetujuan CFO\*: 1 dokumen · Rp 6\.000\.000/); // hanya NTR-00004
    for (const t of w.wa.sent.map((m) => m.text)) expect(t).not.toMatch(/SETUJU \d{4}/);
    expect(to(PH.citra)).toHaveLength(0); // PIC bukan penerima
  });
  it('kunci 4 menit mencegah ganda; gagal kirim dihitung, tidak melempar (I15)', async () => {
    w.wa.failNext = true;
    const a = await kirimDigestFinance(w.deps);
    expect(a.gagal).toBe(1);
    expect(await kirimDigestFinance(w.deps)).toMatchObject({ penerima: 0, dilewati: expect.any(String) });
  });
  it('tidak ada antrean = tidak ada pesan', async () => {
    w.store.seed(TRX_PENGAJUAN, []);
    expect(await kirimDigestFinance(w.deps, { force: true })).toMatchObject({ penerima: 0, terkirim: 0 });
    expect(pesanDigestFinance({ nama: 'X', baris: [{ label: 'A', jumlah: 0, total: 0, link: 'l' }] })).not.toContain('*A*');
  });
});
