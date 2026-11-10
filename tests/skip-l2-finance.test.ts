// Keputusan user 2026-11-10: pengajuan divisi Finance (FATS) tanpa Manager L2 -> langsung Manager Approved, lanjut Staff Finance -> Fin. Mgr -> CFO (>= Rp 5 jt).
import { beforeEach, describe, expect, it } from 'vitest';
import { cekFinMgrPengajuSendiri, lewatiManager } from '@/domain/approval';
import { bangunOrg, picOptions } from '@/domain/master';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_PPH, MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { setujuiFinance } from '@/server/finance-aksi';
import { setujuiFinanceSchema } from '@/server/finance-schema';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const sess = (email: string, nama: string, ...roles: { brand: string; dept: string; level: number }[]): SessionData => ({ phone: `628${email.length}${nama.length}`, email, nama, jabatan: 'X', created: 0, ep: 0, roles });
const picFats = sess('harfy@x.id', 'Harfy', { brand: 'BRAND A', dept: 'FATS', level: 1 });
const picY = sess('citra@x.id', 'Citra', { brand: 'BRAND B', dept: 'DEPT Y', level: 1 });
const picX = sess('citra@x.id', 'Citra', { brand: 'BRAND A', dept: 'DEPT X', level: 1 });
const eko = sess('eko@x.id', 'Eko', { brand: 'ALL', dept: 'ALL', level: 4 });
const fina = sess('fina@x.id', 'Fina', { brand: 'ALL', dept: 'ALL', level: 4 });
const code = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

let w: ReturnType<typeof authWorld>;
const draft = async (s: SessionData, brand: string, dept: string, amount: number, inv: string) =>
  (await createDraft(w.deps, s, { tipe: 'Non-Trade', brand, departement: dept, description: 'Langganan tools', vendorKode: 'V3', noInvoice: inv, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' })).id;
const lampiran = (id: string): void => w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { if (r[C('ID_TRX')] === id) r[C('FILE_URL')] = 'https://drive.example/f'; return r; }));
const row = (id: string) => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL'], ['PT B', 'BRAND B', '', '', 'HB']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('domain', () => {
  it('lewatiManager: hanya FATS (tak peka huruf/spasi)', () => {
    expect(lewatiManager('FATS')).toBe(true);
    expect(lewatiManager(' fats ')).toBe(true);
    expect(lewatiManager('DEPT X')).toBe(false);
    expect(lewatiManager('')).toBe(false);
  });
  it('picOptions FATS: tanpa Manager L2 tetap bisa lanjut, penyetuju = Finance Manager', () => {
    const org = bangunOrg([['BRAND A', 'FATS', 1, 'PIC', 'Harfy', 'h@x.id', 'YES', '', '', '']], {});
    expect(picOptions(org, 'BRAND A', 'FATS', 'Harfy')).toMatchObject({ adaManager: true, manager: 'Finance Manager (Level 4)', peringatan: '' });
  });
  it('picOptions FATS tanpa PIC tetap memberi peringatan PIC', () => {
    const org = bangunOrg([['BRAND A', 'FATS', 3, 'Staff', 'Dani', 'd@x.id', 'YES', '', '', '']], {});
    expect(picOptions(org, 'BRAND A', 'FATS').peringatan).toMatch(/belum punya PIC/);
  });
  it('cekFinMgrPengajuSendiri: blokir hanya untuk dept Finance & pengaju sendiri', () => {
    expect(cekFinMgrPengajuSendiri('FATS', 'Eko@X.id', ' eko@x.id')).toMatch(/tidak boleh menyetujuinya/);
    expect(cekFinMgrPengajuSendiri('FATS', 'eko@x.id', 'fina@x.id')).toBeNull();
    expect(cekFinMgrPengajuSendiri('DEPT X', 'eko@x.id', 'eko@x.id')).toBeNull(); // dept lain: tetap penanda O5b, bukan blokir
  });
});

describe('submit FATS (tanpa Manager L2)', () => {
  it('< Rp 5 jt: langsung Manager Approved, baris L2 SKIP tercatat, audit eksplisit, REQUIRE_CFO NO', async () => {
    const id = await draft(picFats, 'BRAND A', 'FATS', 1_000_000, 'INV-F1'); lampiran(id);
    const res = await submitPengajuan(w.deps, picFats, id, 'idem-skipl2-0001');
    expect(res).toMatchObject({ status: 'Manager Approved', perluCFO: false });
    expect(row(id)[C('STATUS')]).toBe('Manager Approved');
    expect(row(id)[C('REQUIRE_CFO')]).toBe('NO');
    const apr = w.store.rowsOf(TRX_APPROVAL).filter((r) => r[CA('ID_Trx')] === id);
    expect(apr.map((r) => Number(r[CA('Level')]))).toEqual([1, 2]);
    expect(apr[1]![CA('Method')]).toBe('SKIP-L2');
    expect(apr[1]![CA('Action')]).toBe('APPROVED');
    expect(String(apr[1]![CA('Approver_Email')] ?? '')).toBe(''); // bukan atas nama orang
    const audit = w.store.rowsOf(AUDIT_LOG).map((r) => String(r[colIndex(AUDIT_LOG, 'Notes')] ?? ''));
    expect(audit.some((n) => n.includes('SKIP-L2'))).toBe(true);
  });
  it('>= Rp 5 jt: REQUIRE_CFO YES tetap dikunci (I1) dan status Manager Approved', async () => {
    const id = await draft(picFats, 'BRAND A', 'FATS', 7_000_000, 'INV-F2'); lampiran(id);
    expect(await submitPengajuan(w.deps, picFats, id, 'idem-skipl2-0002')).toMatchObject({ status: 'Manager Approved', perluCFO: true });
    expect(row(id)[C('REQUIRE_CFO')]).toBe('YES');
  });
  it('dept lain tanpa Manager L2 TETAP ditolak (aturan lama tak berubah)', async () => {
    const id = await draft(picY, 'BRAND B', 'DEPT Y', 1_000_000, 'INV-Y1'); lampiran(id);
    expect(await code(submitPengajuan(w.deps, picY, id, 'idem-skipl2-0003'))).toBe('RULE_VIOLATION');
    expect(row(id)[C('STATUS')]).toBe('Draft');
  });
  it('dept lain dengan Manager L2 TETAP ke Submitted', async () => {
    const id = await draft(picX, 'BRAND A', 'DEPT X', 1_000_000, 'INV-X1'); lampiran(id);
    expect(await submitPengajuan(w.deps, picX, id, 'idem-skipl2-0004')).toMatchObject({ status: 'Submitted' });
  });
});

describe('Fin. Mgr pengaju dokumen FATS', () => {
  const tok = async (s: SessionData): Promise<string> => { const t = await w.deps.sessions.create(s); await w.deps.sessions.markStepUp(t); return t; };
  const seed = (dept: string): void => {
    w.store.seed(TRX_PENGAJUAN, [trxRow('NTR-00020', { STATUS: 'Tax Verified', DEPARTEMENT: dept, BRAND: 'BRAND A', CREATED_BY: 'eko@x.id', LAST_UPDATE: 46000, INV_AMOUNT: 1_000_000, FINAL_AMOUNT: 1_000_000, REQUIRE_CFO: 'NO' })]);
  };
  const setujui = async (s: SessionData, key: string) =>
    setujuiFinance(w.deps, s, await tok(s), 'NTR-00020', setujuiFinanceSchema.parse({ etag: etagOf(row('NTR-00020')), sebagai: 'finmgr' }), key);
  it('FATS: pengaju sendiri diblokir, Fin. Mgr lain boleh', async () => {
    seed('FATS');
    expect(await code(setujui(eko, 'idem-skipl2-0005'))).toBe('RULE_VIOLATION');
    expect(row('NTR-00020')[C('STATUS')]).toBe('Tax Verified');
    expect(await code(setujui(fina, 'idem-skipl2-0006'))).toBe('OK');
    expect(row('NTR-00020')[C('STATUS')]).toBe('Wet Signed');
  });
  it('dept lain: pengaju sendiri tidak diblokir (tetap penanda O5b)', async () => {
    seed('DEPT X');
    expect(await code(setujui(eko, 'idem-skipl2-0007'))).toBe('OK');
  });
});
