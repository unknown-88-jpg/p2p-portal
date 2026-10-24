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
