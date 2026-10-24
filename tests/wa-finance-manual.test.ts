import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { toSheetSerial } from '@/lib/time';
import { MASTER_USER_TTD, TRX_APPROVAL, TRX_PENGAJUAN } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { antreanFinance } from '@/server/finance';
import { kirimWaFinance } from '@/server/wa-manual-finance';
import { authWorld, USERS } from './auth-helpers';
import { trxRow } from './helpers';

const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const sess = (email: string, level: number, phone = '6281200000099'): SessionData => ({ phone, email, nama: email.split('@')[0]!, jabatan: 'X', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level }] });
const fs = sess('dani@x.id', 3, '6281200000003');
const HP_FM = '6281200000041', HP_FM2 = '6281200000042', HP_CFO = '6281200000051';

let w: ReturnType<typeof authWorld>;
const apr = (lvl: number, email: string, menitLalu: number) => ['APR-' + lvl + menitLalu, 'NTR-00001', lvl, 'L', email.split('@')[0]!, email, 'J', 'E-SIGN', 'APPROVED', toSheetSerial(w.clock.now() - menitLalu * 60_000), '', ''];

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [...USERS,
    ['ALL', 'ALL', 4, 'Fin Mgr', 'Fm', 'fm@x.id', 'YES', '081200000041', null, null],
    ['ALL', 'ALL', 4, 'Fin Mgr', 'Fm2', 'fm2@x.id', 'YES', '081200000042', null, null],
    ['ALL', 'ALL', 5, 'CFO', 'Cfo', 'cfo@x.id', 'YES', '081200000051', null, null],
    ['ALL', 'ALL', 5, 'CFO', 'Fm2', 'fm2@x.id', 'YES', '081200000042', null, null], // Fm2 juga CFO
  ]);
  w.store.seed(TRX_PENGAJUAN, [
    trxRow('NTR-00001', { STATUS: 'Tax Verified', FINAL_AMOUNT: 9_000_000, REQUIRE_CFO: 'YES', VENDOR_NAME: 'Vendor Dummy', CREATED_BY: 'citra@x.id' }),
    trxRow('NTR-00002', { STATUS: 'Manager Approved', FINAL_AMOUNT: 100 }),
  ]);
  w.store.seed(TRX_APPROVAL, [apr(3, 'dani@x.id', 60)]);
});

describe('Kirim WA tahap persetujuan Finance (1x per tujuan)', () => {
  it('belum ada Fin. Mgr -> ke semua Fin. Mgr; tanpa kode balasan; kedua kali 429; status tombol ikut di antrean', async () => {
    const r = await kirimWaFinance(w.deps, fs, 'NTR-00001');
    expect(r).toEqual({ target: 'finmgr', penerima: 2, terkirim: 2 });
    expect(w.wa.sent.map((m) => m.to).sort()).toEqual([HP_FM, HP_FM2]);
    expect(w.wa.sent[0]!.text).toMatch(/Menunggu persetujuan Fin\. Mgr[\s\S]*NTR-00001[\s\S]*portal/);
    expect(w.wa.sent[0]!.text).not.toMatch(/SETUJU|TOLAK/);
    expect(w.audit().at(-1)).toMatchObject({ action: 'WA_REMINDER_MANUAL', actor: 'dani@x.id' });
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('RATE_LIMITED');
    const q = await antreanFinance(w.deps, fs);
    expect(q.items.find((i) => i.id === 'NTR-00001')!.persetujuan!.wa).toEqual({ target: 'finmgr', terkirim: true });
  });

  it('setelah Fin. Mgr setuju & butuh CFO -> tombol pindah ke CFO (bukan orang yang sama dengan Fin. Mgr), 1x juga', async () => {
    await kirimWaFinance(w.deps, fs, 'NTR-00001');
    w.store.seed(TRX_APPROVAL, [apr(3, 'dani@x.id', 60), apr(4, 'fm2@x.id', 10)]);
    w.wa.sent = [];
    const q = await antreanFinance(w.deps, fs);
    expect(q.items.find((i) => i.id === 'NTR-00001')!.persetujuan!.wa).toEqual({ target: 'cfo', terkirim: false });
    expect(await kirimWaFinance(w.deps, sess('fm2@x.id', 4, HP_FM2), 'NTR-00001')).toEqual({ target: 'cfo', penerima: 1, terkirim: 1 });
    expect(w.wa.sent.map((m) => m.to)).toEqual([HP_CFO]); // Fm2 (CFO juga) tidak menerima: sudah jadi Fin. Mgr
    expect(w.wa.sent[0]!.text).toMatch(/Sudah disetujui Fin\. Mgr: fm2/);
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('RATE_LIMITED');
  });

  it('persetujuan lengkap / bukan tahap persetujuan / bukan Finance ditolak', async () => {
    w.store.seed(TRX_APPROVAL, [apr(3, 'dani@x.id', 60), apr(4, 'fm@x.id', 10), apr(5, 'cfo@x.id', 5)]);
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('RULE_VIOLATION');
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00002'))).toBe('RULE_VIOLATION');
    expect(await kode(kirimWaFinance(w.deps, sess('citra@x.id', 1), 'NTR-00001'))).toBe('FORBIDDEN');
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-09999'))).toBe('NOT_FOUND');
  });

  it('WA gagal ke semua penerima -> jatah dikembalikan; siklus verifikasi baru -> boleh kirim lagi', async () => {
    w.store.seed(MASTER_USER_TTD, [...USERS, ['ALL', 'ALL', 4, 'Fin Mgr', 'Fm', 'fm@x.id', 'YES', '081200000041', null, null]]);
    w.wa.failNext = true;
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('UPSTREAM_BUSY');
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('OK');
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('RATE_LIMITED');
    w.store.seed(TRX_APPROVAL, [apr(3, 'dani@x.id', 60), apr(3, 'dani@x.id', 1)]); // dikembalikan lalu diverifikasi ulang
    expect(await kode(kirimWaFinance(w.deps, fs, 'NTR-00001'))).toBe('OK');
  });
});
