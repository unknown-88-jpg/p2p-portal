import { beforeEach, describe, expect, it } from 'vitest';
import { cronBermasalah, susunNotifikasi } from '@/domain/notifikasi';
import { MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { catatCron } from '@/server/admin';
import { notifikasiSaya } from '@/server/notifikasi';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const sess = (email: string, ...roles: [number, string?, string?][]): SessionData => ({
  phone: '62800', email, nama: email, jabatan: 'X', created: 0, ep: 0, roles: roles.map(([level, brand = 'ALL', dept = 'ALL']) => ({ level, brand, dept })),
});

describe('lonceng: domain', () => {
  it('hanya butir > 0, urut per peran, total = jumlah semua', () => {
    const n = susunNotifikasi({ pic: { revisi: 2, draft: 0 }, manager: { antrean: 3 }, finance: { pajak: 1, bayar: 0 }, vendor: { menunggu: 1 }, admin: { cronBermasalah: [] } });
    expect(n.butir.map((b) => [b.kunci, b.jumlah, b.href])).toEqual([
      ['pic-revisi', 2, '/pengajuan?status=perlu-tindakan'], ['manager', 3, '/persetujuan'], ['fin-pajak', 1, '/finance?tahap=pajak'], ['vendor', 1, '/vendor?tab=pengesahan'],
    ]);
    expect(n.total).toBe(7);
    expect(susunNotifikasi({})).toEqual({ butir: [], total: 0 });
  });
  it('cron bermasalah: gagal / dilewati / tidak jalan > 25 jam (digest: > 4 hari); belum pernah jalan tidak dianggap alarm', () => {
    const now = 10 * 86_400_000;
    expect(cronBermasalah([
      { nama: 'backup', at: now - 26 * 3_600_000, hasil: 'ok' }, { nama: 'lampiran-yatim', at: now - 3_600_000, hasil: 'gagal' },
      { nama: 'digest', at: now - 3 * 86_400_000, hasil: 'ok' }, { nama: 'x', at: null, hasil: 'belum pernah' }, { nama: 'y', at: now, hasil: 'dilewati' },
    ], now)).toEqual(['backup', 'lampiran-yatim', 'y']);
  });
});

describe('lonceng: per peran (semua pengguna)', () => {
  let w: ReturnType<typeof authWorld>;
  beforeEach(() => {
    w = authWorld();
    w.store.seed(TRX_PENGAJUAN, [
      trxRow('NTR-00001', { STATUS: 'Revision Needed', CREATED_BY: 'citra@x.id', BRAND: 'BRAND A', DEPARTEMENT: 'DEPT X' }),
      trxRow('NTR-00002', { STATUS: 'Draft', CREATED_BY: 'citra@x.id', BRAND: 'BRAND A', DEPARTEMENT: 'DEPT X' }),
      trxRow('NTR-00003', { STATUS: 'Submitted', CREATED_BY: 'citra@x.id', BRAND: 'BRAND A', DEPARTEMENT: 'DEPT X' }),
      trxRow('NTR-00004', { STATUS: 'Submitted', CREATED_BY: 'lain@x.id', BRAND: 'BRAND B', DEPARTEMENT: 'DEPT Y' }),
      trxRow('NTR-00005', { STATUS: 'Manager Approved', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 100 }),
      trxRow('NTR-00006', { STATUS: 'Manager Approved', CREATED_BY: 'fs@x.id', FINAL_AMOUNT: 100 }),
      trxRow('NTR-00007', { STATUS: 'Tax Verified', CREATED_BY: 'citra@x.id', FINAL_AMOUNT: 9_000_000 }),
    ]);
    w.store.seed(TRX_APPROVAL, []);
    w.store.seed(MASTER_VENDOR, [
      ['VND-0001', 'A', 'Trade', '', 'BCA', 'A', '1234567', 'Pending', 'fs@x.id', 46000],
      ['VND-0002', 'B', 'Trade', '', 'BCA', 'B', '7654321', 'Pending', 'citra@x.id', 46000],
    ]);
  });
  const kunci = async (s: SessionData) => (await notifikasiSaya(w.deps, s)).butir.map((b) => `${b.kunci}:${b.jumlah}`);

  it('PIC: revisi & draft miliknya', async () => {
    expect(await kunci(sess('citra@x.id', [1, 'BRAND A', 'DEPT X']))).toEqual(['pic-revisi:1', 'pic-draft:1']);
  });
  it('Manager: hanya antrean brand/dept berwenang, bukan ajuan sendiri', async () => {
    expect(await kunci(sess('budi@x.id', [2, 'BRAND A', 'DEPT X']))).toEqual(['manager:1']);
  });
  it('Finance Staff: pajak tanpa ajuan sendiri (I6) + vendor bukan daftaran sendiri', async () => {
    expect(await kunci(sess('fs@x.id', [3]))).toEqual(['fin-pajak:1', 'vendor:1']);
  });
  it('Fin. Mgr: persetujuan belum ada Fin. Mgr; CFO: menunggu Fin. Mgr dulu -> kosong', async () => {
    expect(await kunci(sess('fm@x.id', [4]))).toEqual(['fin-finmgr:1']);
    expect(await kunci(sess('cfo@x.id', [5]))).toEqual([]);
  });
  it('Admin: cron gagal muncul; peran tanpa apa pun -> kosong, bukan error', async () => {
    await catatCron(w.deps, 'backup', 'gagal');
    expect(await kunci(sess('adm@x.id', [9]))).toEqual(['admin-cron:1']);
    expect(await notifikasiSaya(w.deps, sess('x@x.id', [99]))).toEqual({ butir: [], total: 0 });
  });
  it('sumber gagal dibaca dilewati (lonceng tidak merusak halaman)', async () => {
    const asli = w.store.readRows.bind(w.store);
    w.store.readRows = async (sc, o) => { if (sc.tab === MASTER_VENDOR.tab) throw new Error('Sheets 500 (tes)'); return asli(sc, o); };
    expect(await kunci(sess('fs@x.id', [3]))).toEqual(['fin-pajak:1']);
  });
});
