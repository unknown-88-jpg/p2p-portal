import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_COA, MASTER_PPH, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, type TabSchema } from '@/repo/schema';
import type { Mutation, ReadOpts, TableStore } from '@/ports/store';
import { etagOf } from '@/server/approval';
import type { AuthDeps, SessionData } from '@/server/auth';
import { bayar, jurnalCoa, kembalikanFinance, setujuiFinance, verifikasiPajak } from '@/server/finance-aksi';
import { antreanFinance } from '@/server/finance';
import { bayarSchema, jurnalSchema, verifikasiPajakSchema } from '@/server/finance-schema';
import { authWorld } from './auth-helpers';
import { trxRow } from './helpers';

const sess = (email: string, ...levels: number[]): SessionData => ({ phone: `628${email.length}${levels.join('')}`, email, nama: email, jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const hariIni = (now: number): string => new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);

/** Penghitung panggilan Sheets (kuota 60 baca + 60 tulis / menit / user). */
function hitung(store: TableStore) {
  const n = { baca: 0, tulis: 0 };
  const s: TableStore = {
    readRows: (sc: TabSchema, o?: ReadOpts) => { n.baca++; return store.readRows(sc, o); },
    readColumn: (sc: TabSchema, k: string, o?: ReadOpts) => { n.baca++; return store.readColumn(sc, k, o); },
    readRow: (sc: TabSchema, r: number) => { n.baca++; return store.readRow(sc, r); },
    applyBatch: (m: readonly Mutation[]) => { n.tulis++; return store.applyBatch(m); },
  };
  return { s, n };
}

let w: ReturnType<typeof authWorld>;
let k = 0;
const key = (): string => `idem-f2g-${String(++k).padStart(8, '0')}`;
const ids = Array.from({ length: 30 }, (_, i) => `NTR-${String(i + 1).padStart(5, '0')}`);

describe('F2-G kuota Sheets: aksi massal 30 dokumen', () => {
  beforeEach(() => {
    w = authWorld();
    w.store.seed(MASTER_COA, [['ASET', 'KAS DAN SETARA KAS', 'BANK', 'BCA 123', '-'], ['BEBAN', 'BEBAN OPERASIONAL', '-', '-', '-']]);
    w.store.seed(TRX_PAYMENT_LOG, []); w.store.seed(AUDIT_LOG, []);
  });
  it('bayar 30 dokumen = 1 panggilan tulis dan <= 5 baca (bukan per dokumen)', async () => {
    w.store.seed(TRX_PENGAJUAN, ids.map((id) => trxRow(id, { STATUS: 'COA Posted', FINAL_AMOUNT: 100_000, SUB_COA: 'X', BUDGET: 'B', REQUIRE_CFO: 'NO', LAST_UPDATE: 46000 })));
    w.store.seed(TRX_APPROVAL, ids.flatMap((id) => [2, 3, 4].map((l) => [`A-${id}-${l}`, id, l, 'x', 'n', `u${l}@x.id`, 'j', 'E-SIGN', 'APPROVED', 46000 + l, '', ''])));
    const { s, n } = hitung(w.store);
    const d: AuthDeps = { ...w.deps, store: s };
    const fin = sess('fin@x.id', 3);
    const t = await w.deps.sessions.create(fin); await w.deps.sessions.markStepUp(t);
    const rows = w.store.rowsOf(TRX_PENGAJUAN);
    const r = await bayar(d, fin, t, bayarSchema.parse({ items: rows.map((x) => ({ id: String(x[0]), etag: etagOf(x), nominal: 100_000 })), tglBayar: hariIni(w.clock.now()), sumberRekening: 'BCA 123' }), key());
    expect(r.berhasil).toHaveLength(30);
    expect(n.tulis).toBe(1);
    expect(n.baca).toBeLessThanOrEqual(5);
    expect(w.store.rowsOf(TRX_PAYMENT_LOG)).toHaveLength(30);
  });
  it('jurnal 30 dokumen = 1 panggilan tulis dan <= 4 baca', async () => {
    w.store.seed(TRX_PENGAJUAN, ids.map((id) => trxRow(id, { STATUS: 'Wet Signed', FINAL_AMOUNT: 100_000, LAST_UPDATE: 46000 })));
    const { s, n } = hitung(w.store);
    const rows = w.store.rowsOf(TRX_PENGAJUAN);
    const r = await jurnalCoa({ ...w.deps, store: s }, sess('fin@x.id', 3), jurnalSchema.parse({ items: rows.map((x) => ({ id: String(x[0]), etag: etagOf(x), lvl1: 'BEBAN', lvl2: 'BEBAN OPERASIONAL', budget: 'B' })) }), key());
    expect(r.berhasil).toHaveLength(30);
    expect(n.tulis).toBe(1);
    expect(n.baca).toBeLessThanOrEqual(4);
  });
});

describe('F2-G matriks otorisasi Finance (level persis; tidak berwenang = 403 sebelum menyentuh data)', () => {
  beforeEach(() => {
    w = authWorld();
    w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
    w.store.seed(TRX_PENGAJUAN, [trxRow('NTR-00001', { STATUS: 'Manager Approved', CREATED_BY: 'p@x.id', INV_AMOUNT: 1000, FINAL_AMOUNT: 1000, LAST_UPDATE: 46000 })]);
    w.store.seed(TRX_APPROVAL, []); w.store.seed(AUDIT_LOG, []);
  });
  const et = () => etagOf(w.store.rowsOf(TRX_PENGAJUAN)[0]!);
  const aksi = async (l: number): Promise<Record<string, string>> => {
    const s = sess(`u${l}@x.id`, l);
    const t = await w.deps.sessions.create(s); await w.deps.sessions.markStepUp(t);
    const tgl = hariIni(w.clock.now());
    return {
      antrean: await kode(antreanFinance(w.deps, s)),
      pajak: await kode(verifikasiPajak(w.deps, s, 'NTR-00009', verifikasiPajakSchema.parse({ etag: et(), invAmount: 1000, statusPPN: 'Non PPN' }), key())),
      kembalikan: await kode(kembalikanFinance(w.deps, s, 'NTR-00009', { etag: et(), alasan: 'xxx' }, key())),
      finmgr: await kode(setujuiFinance(w.deps, s, t, 'NTR-00009', { etag: et(), sebagai: 'finmgr' }, key())),
      cfo: await kode(setujuiFinance(w.deps, s, t, 'NTR-00009', { etag: et(), sebagai: 'cfo' }, key())),
      jurnal: await kode(jurnalCoa(w.deps, s, jurnalSchema.parse({ items: [{ id: 'NTR-00009', etag: et(), lvl1: 'A', lvl2: 'B', budget: 'C' }] }), key())),
      bayar: await kode(bayar(w.deps, s, t, bayarSchema.parse({ items: [{ id: 'NTR-00009', etag: et(), nominal: 1 }], tglBayar: tgl, sumberRekening: 'X' }), key())),
    };
  };
  // Dokumen NTR-00009 sengaja TIDAK ADA: yang berwenang lolos authz lalu kena 404/422/400; yang tidak berwenang 403 lebih dulu.
  it.each([
    [1, { antrean: 'FORBIDDEN', pajak: 'FORBIDDEN', kembalikan: 'FORBIDDEN', finmgr: 'FORBIDDEN', cfo: 'FORBIDDEN', jurnal: 'FORBIDDEN', bayar: 'FORBIDDEN' }],
    [2, { antrean: 'FORBIDDEN', pajak: 'FORBIDDEN', kembalikan: 'FORBIDDEN', finmgr: 'FORBIDDEN', cfo: 'FORBIDDEN', jurnal: 'FORBIDDEN', bayar: 'FORBIDDEN' }],
    [3, { antrean: 'OK', pajak: 'NOT_FOUND', kembalikan: 'NOT_FOUND', finmgr: 'FORBIDDEN', cfo: 'FORBIDDEN', jurnal: 'RULE_VIOLATION', bayar: 'VALIDATION' }],
    [4, { antrean: 'OK', pajak: 'FORBIDDEN', kembalikan: 'NOT_FOUND', finmgr: 'NOT_FOUND', cfo: 'FORBIDDEN', jurnal: 'FORBIDDEN', bayar: 'FORBIDDEN' }],
    [5, { antrean: 'OK', pajak: 'FORBIDDEN', kembalikan: 'NOT_FOUND', finmgr: 'FORBIDDEN', cfo: 'NOT_FOUND', jurnal: 'FORBIDDEN', bayar: 'FORBIDDEN' }],
    [9, { antrean: 'FORBIDDEN', pajak: 'FORBIDDEN', kembalikan: 'FORBIDDEN', finmgr: 'FORBIDDEN', cfo: 'FORBIDDEN', jurnal: 'FORBIDDEN', bayar: 'FORBIDDEN' }],
  ])('level %i', async (l, harap) => {
    expect(await aksi(l)).toEqual(harap);
    expect(w.store.rowsOf(TRX_PENGAJUAN)[0]![0]).toBe('NTR-00001'); // tidak ada yang berubah
  });
});

describe('F2-G perbaikan temuan review', () => {
  beforeEach(() => {
    w = authWorld();
    w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
    w.store.seed(MASTER_COA, [['ASET', 'KAS DAN SETARA KAS', 'BANK', 'BCA 123', '-']]);
    w.store.seed(TRX_PAYMENT_LOG, []); w.store.seed(AUDIT_LOG, []);
  });
  const row = (id: string) => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[0] === id)!;
  it('#1 akun tanpa email tidak bisa bertindak di jalur uang (cegah Fin. Mgr = CFO lewat email kosong)', async () => {
    w.store.seed(TRX_PENGAJUAN, [trxRow('NTR-00001', { STATUS: 'Tax Verified', FINAL_AMOUNT: 7_000_000, REQUIRE_CFO: 'YES', LAST_UPDATE: 46000 })]);
    w.store.seed(TRX_APPROVAL, [['A-3', 'NTR-00001', 3, 'x', 'D', 'd@x.id', 'x', 'E-SIGN', 'APPROVED', 46000, '', '']]);
    const s = { ...sess('', 4, 5) };
    const t = await w.deps.sessions.create(s); await w.deps.sessions.markStepUp(t);
    expect(await kode(setujuiFinance(w.deps, s, t, 'NTR-00001', { etag: etagOf(row('NTR-00001')), sebagai: 'finmgr' }, key()))).toBe('FORBIDDEN');
    expect(await kode(bayar(w.deps, { ...sess('', 3) }, t, bayarSchema.parse({ items: [{ id: 'NTR-00001', etag: 'e'.repeat(20), nominal: 1 }], tglBayar: hariIni(w.clock.now()), sumberRekening: 'BCA 123' }), key()))).toBe('FORBIDDEN');
  });
  it('#2 verifikasi pajak dengan nominal akhir 0 ditolak (tidak macet di Siap Dibayar)', async () => {
    w.store.seed(TRX_PENGAJUAN, [trxRow('NTR-00001', { STATUS: 'Manager Approved', CREATED_BY: 'p@x.id', FINAL_AMOUNT: 1000, LAST_UPDATE: 46000 })]);
    w.store.seed(TRX_APPROVAL, []);
    expect(await kode(verifikasiPajak(w.deps, sess('f@x.id', 3), 'NTR-00001', verifikasiPajakSchema.parse({ etag: etagOf(row('NTR-00001')), invAmount: 0, statusPPN: 'Non PPN' }), key()))).toBe('RULE_VIOLATION');
  });
  it('#3 REQUIRE_CFO kosong/diedit tetapi nominal >= 5 jt: CFO tetap wajib (setujui & bayar)', async () => {
    w.store.seed(TRX_PENGAJUAN, [
      trxRow('NTR-00001', { STATUS: 'Tax Verified', FINAL_AMOUNT: 10_000_000, REQUIRE_CFO: '', LAST_UPDATE: 46000 }),
      trxRow('NTR-00002', { STATUS: 'COA Posted', FINAL_AMOUNT: 10_000_000, REQUIRE_CFO: 'NO', SUB_COA: 'X', BUDGET: 'B', LAST_UPDATE: 46000 }),
    ]);
    w.store.seed(TRX_APPROVAL, [
      ['A-1', 'NTR-00001', 3, 'x', 'D', 'd@x.id', 'x', 'E-SIGN', 'APPROVED', 46000, '', ''],
      ...[2, 3, 4].map((l) => [`B-${l}`, 'NTR-00002', l, 'x', 'n', `u${l}@x.id`, 'x', 'E-SIGN', 'APPROVED', 46000 + l, '', '']),
    ]);
    const fm = sess('fm@x.id', 4), fin = sess('fin@x.id', 3);
    const t = await w.deps.sessions.create(fm); await w.deps.sessions.markStepUp(t);
    const r = await setujuiFinance(w.deps, fm, t, 'NTR-00001', { etag: etagOf(row('NTR-00001')), sebagai: 'finmgr' }, key());
    expect(r).toMatchObject({ status: 'Tax Verified', menungguCFO: true });
    const t2 = await w.deps.sessions.create(fin); await w.deps.sessions.markStepUp(t2);
    const e = await bayar(w.deps, fin, t2, bayarSchema.parse({ items: [{ id: 'NTR-00002', etag: etagOf(row('NTR-00002')), nominal: 1_000 }], tglBayar: hariIni(w.clock.now()), sumberRekening: 'BCA 123' }), key()).catch((x: AppError) => x);
    expect((e as AppError).message).toMatch(/CFO/);
  });
  it('#4 waktu verifikasi pajak tak terbaca -> persetujuan L4/L5 lama tidak dihitung (gagal tertutup)', async () => {
    const { statusPersetujuan } = await import('@/domain/finance');
    const st = statusPersetujuan([
      { level: 4, action: 'APPROVED', nama: 'Lama', email: 'l@x.id', timestamp: 100 },
      { level: 3, action: 'APPROVED', nama: 'D', email: 'd@x.id', timestamp: 'bukan tanggal' },
    ]);
    expect(st.finMgr).toBeNull();
    expect(st.verifikator).not.toBeNull();
  });
});
