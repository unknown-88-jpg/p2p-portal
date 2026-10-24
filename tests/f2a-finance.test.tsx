import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'trial', APP_BASE_URL: 'http://localhost:3000', SHEET_ID: 'sheet-id-1234567', DRIVE_ROOT_ID: 'drive-root', GOOGLE_SA_JSON: 'x'.repeat(60),
    JWT_SECRET: 'j'.repeat(40), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't'.repeat(20), CRON_SECRET: 'c'.repeat(20), HEALTH_TOKEN: 'h'.repeat(20),
  });
});
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));

import { renderToStaticMarkup } from 'react-dom/server';
import { GET as queues } from '@/app/api/finance/queues/route';
import { POST as login } from '@/app/api/auth/login/route';
import { bisaAksiTahap, bisaLihatFinance, ringkasTahap, tahapDariStatus, TAHAP_FINANCE } from '@/domain/finance';
import { labelStatus } from '@/domain/status-label';
import type { Role } from '@/domain/roles';
import { AppError } from '@/lib/errors';
import { toSheetSerial } from '@/lib/time';
import { MASTER_USER_TTD, TRX_PENGAJUAN } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { antreanFinance } from '@/server/finance';
import { __setAuthDepsForTests } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { authWorld, LEGACY_PW, USERS } from './auth-helpers';
import { trxRow } from './helpers';

const R = (...levels: number[]): Role[] => levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level }));
const sess = (email: string, ...levels: number[]): SessionData => ({ phone: '6280000000000', email, nama: email, jabatan: 'X', created: 0, ep: 0, roles: R(...levels) });
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const HARI = 86_400_000;

describe('F2-A domain: tahap & hak akses', () => {
  it('pemetaan status = getFinanceQueues lama (tax / wet / coa / treasury); status lain bukan antrean Finance', () => {
    expect(tahapDariStatus('Manager Approved')?.kunci).toBe('pajak');
    expect(tahapDariStatus('Tax Verified')?.kunci).toBe('persetujuan');
    expect(tahapDariStatus('Wet Signed')?.kunci).toBe('jurnal');
    expect(tahapDariStatus('COA Posted')?.kunci).toBe('bayar');
    expect(tahapDariStatus('Partially Paid')?.kunci).toBe('bayar');
    for (const s of ['Draft', 'Submitted', 'Revision Needed', 'Rejected', 'Paid', '', 'aneh']) expect(tahapDariStatus(s)).toBeNull();
  });
  it('melihat antrean: hanya L3/L4/L5 (PIC, Manager, Admin, 99 tidak)', () => {
    for (const l of [3, 4, 5]) expect(bisaLihatFinance(R(l))).toBe(true);
    for (const l of [1, 2, 9, 99]) expect(bisaLihatFinance(R(l))).toBe(false);
    expect(bisaLihatFinance(R(1, 3))).toBe(true); // peran ganda
  });
  it('bertindak per tahap: L3 pajak/jurnal/bayar; L4 & L5 hanya persetujuan (level persis)', () => {
    const aksi = (...l: number[]) => TAHAP_FINANCE.filter((t) => bisaAksiTahap(R(...l), t)).map((t) => t.kunci);
    expect(aksi(3)).toEqual(['pajak', 'jurnal', 'bayar']);
    expect(aksi(4)).toEqual(['persetujuan']);
    expect(aksi(5)).toEqual(['persetujuan']);
    expect(aksi(2)).toEqual([]);
  });
  it('ringkasan: jumlah, total (tahap bayar = sisa), tertua', () => {
    const r = ringkasTahap([
      { tahap: 'pajak', nominal: 100, sisa: 100, umurHari: 2 }, { tahap: 'pajak', nominal: 50, sisa: 50, umurHari: null },
      { tahap: 'bayar', nominal: 1000, sisa: 400, umurHari: 7 },
    ], R(3));
    expect(r.find((t) => t.kunci === 'pajak')).toMatchObject({ jumlah: 2, total: 150, tertuaHari: 2, bisaAksi: true });
    expect(r.find((t) => t.kunci === 'bayar')).toMatchObject({ jumlah: 1, total: 400, tertuaHari: 7 });
    expect(r.find((t) => t.kunci === 'jurnal')).toMatchObject({ jumlah: 0, total: 0, tertuaHari: null });
  });
  it('O4: label tahap persetujuan tidak lagi "TTD Basah"', () => {
    expect(labelStatus('Tax Verified').label).toBe('Menunggu Fin. Mgr / CFO');
  });
});

describe('F2-A service: antreanFinance', () => {
  let w: ReturnType<typeof authWorld>;
  const seed = () => {
    const now = w.clock.now();
    const lu = (hari: number) => toSheetSerial(now - hari * HARI);
    w.store.seed(TRX_PENGAJUAN, [
      trxRow('NTR-00001', { STATUS: 'Manager Approved', FINAL_AMOUNT: 1_000_000, LAST_UPDATE: lu(1), CREATED_BY: 'citra@x.id', VENDOR_NAME: 'Gama', NPWP_VENDOR: '01.234.567.8-901.000', NO_REKENING: '1234567890' }),
      trxRow('NTR-00002', { STATUS: 'Manager Approved', FINAL_AMOUNT: 7_000_000, LAST_UPDATE: lu(5), CREATED_BY: 'dani@x.id', REQUIRE_CFO: 'YES' }),
      trxRow('NTR-00003', { STATUS: 'Tax Verified', FINAL_AMOUNT: 2_000_000, LAST_UPDATE: lu(0) }),
      trxRow('NTR-00004', { STATUS: 'Wet Signed', FINAL_AMOUNT: 3_000_000, LAST_UPDATE: lu(3) }),
      trxRow('NTR-00005', { STATUS: 'Partially Paid', FINAL_AMOUNT: 4_000_000, TOTAL_PAID: 1_500_000, LAST_UPDATE: lu(9) }),
      trxRow('NTR-00006', { STATUS: 'Submitted', FINAL_AMOUNT: 9_000_000 }),
      trxRow('NTR-00007', { STATUS: 'Paid', FINAL_AMOUNT: 9_000_000 }),
    ]);
  };
  beforeEach(() => { w = authWorld(); seed(); });

  it('PIC / Manager / Admin = 403 FORBIDDEN', async () => {
    for (const l of [1, 2, 9]) expect(await kode(antreanFinance(w.deps, sess('x@x.id', l)))).toBe('FORBIDDEN');
  });
  it('L3: semua tahap, ringkasan benar, terbaru dulu, Submitted/Paid tidak ikut', async () => {
    const r = await antreanFinance(w.deps, sess('dani@x.id', 3));
    expect(r.items.map((i) => i.id)).toEqual(['NTR-00003', 'NTR-00001', 'NTR-00004', 'NTR-00002', 'NTR-00005']);
    const t = Object.fromEntries(r.tahap.map((x) => [x.kunci, x]));
    expect(t.pajak).toMatchObject({ jumlah: 2, total: 8_000_000, tertuaHari: 5, bisaAksi: true });
    expect(t.persetujuan).toMatchObject({ jumlah: 1, bisaAksi: false });
    expect(t.bayar).toMatchObject({ jumlah: 1, total: 2_500_000 }); // sisa, bukan nominal
    expect(r.items.find((i) => i.id === 'NTR-00005')).toMatchObject({ sisa: 2_500_000, totalPaid: 1_500_000, tahap: 'bayar' });
    expect(r.basi).toBe(false);
  });
  it('I6 (tampilan): ajuan sendiri ditandai; email pembuat, NPWP, rekening TIDAK dikirim', async () => {
    const r = await antreanFinance(w.deps, sess('dani@x.id', 3));
    expect(r.items.find((i) => i.id === 'NTR-00002')!.ajuanSendiri).toBe(true);
    expect(r.items.find((i) => i.id === 'NTR-00001')!.ajuanSendiri).toBe(false);
    const json = JSON.stringify(r);
    for (const bocor of ['citra@x.id', 'dani@x.id', '01.234.567.8-901.000', '1234567890']) expect(json).not.toContain(bocor);
  });
  it('filter ?stage; stage tak dikenal = 400; L4 melihat tapi hanya bisa aksi di persetujuan', async () => {
    const r = await antreanFinance(w.deps, sess('fm@x.id', 4), 'persetujuan');
    expect(r.items.map((i) => i.id)).toEqual(['NTR-00003']);
    expect(r.tahap).toHaveLength(4); // ringkasan tetap semua tahap
    expect(r.tahap.filter((t) => t.bisaAksi).map((t) => t.kunci)).toEqual(['persetujuan']);
    expect(await kode(antreanFinance(w.deps, sess('fm@x.id', 4), 'hapus'))).toBe('VALIDATION');
  });
});

describe('F2-A route: GET /api/finance/queues', () => {
  const ORIGIN = 'http://localhost:3000';
  it('tanpa sesi 401; Finance Staff 200', async () => {
    const w = authWorld(); __setAuthDepsForTests(w.deps);
    w.store.seed(MASTER_USER_TTD, USERS); w.store.seed(TRX_PENGAJUAN, [trxRow('NTR-00001', { STATUS: 'Manager Approved', FINAL_AMOUNT: 1_000 })]);
    expect((await queues(new Request(`${ORIGIN}/api/finance/queues`))).status).toBe(401);
    const res = await login(new Request(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '10.2.2.2' }, body: JSON.stringify({ phone: '081200000003', password: LEGACY_PW }) }));
    expect(res.status).toBe(200);
    const ck = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    const ok = await queues(new Request(`${ORIGIN}/api/finance/queues?stage=pajak`, { headers: { cookie: ck } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).items.map((i: { id: string }) => i.id)).toEqual(['NTR-00001']);
  });
});

describe('F2-A UI', () => {
  it('menu Finance hanya bila bisaFinance', () => {
    expect(renderToStaticMarkup(<AppNav nama="Dani" bisaAjukan={false} bisaFinance aktif="finance" />)).toMatch(/href="\/finance"[^>]*aria-current="page"/);
    expect(renderToStaticMarkup(<AppNav nama="Citra" bisaAjukan />)).not.toContain('/finance');
  });
});
