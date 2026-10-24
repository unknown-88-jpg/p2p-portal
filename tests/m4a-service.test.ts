import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, DB_PO, DB_SJ, MASTER_PPH, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { PengajuanInput } from '@/domain/pengajuan';
import type { SessionData } from '@/infra/session';
import { createDraft, getMine, listMine, submitPengajuan, updateDraft } from '@/server/pengajuan';
import { authWorld } from './auth-helpers';

import type { RawRow } from '@/ports/store';
type R = RawRow;
const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const poRow = (over: Record<string, string | number | null> = {}): (string | number | null)[] => {
  const base: Record<string, string | number | null> = { PO: 'PO/HL/2026/001', Company_Name: 'PT Dari PO', Tax_Status: 'Exclude PPN', Subtotal: 900_000, Grand_Total: 1_000_000, Item_Name: 'Kain', 'QTY PO': 10, 'Kode Vendor': 'V1' };
  return DB_PO.cols.map((c) => ({ ...base, ...over })[c.key] ?? null);
};
const sjRow = (poId: string, qty: number): (string | number | null)[] => DB_SJ.cols.map((c) => (c.key === 'PO_ID' ? poId : c.key === 'Total_Qty_Received' ? qty : c.key === 'GR_ID' ? 'GR1' : null));

const citra: SessionData = {
  phone: '6281200000002', email: 'citra@x.id', nama: 'Citra', jabatan: 'PIC', created: 0, ep: 0,
  roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND B', dept: 'DEPT Y', level: 1 }],
} as SessionData;
const budi: SessionData = { ...citra, phone: '6281200000001', email: 'budi@x.id', nama: 'Budi', jabatan: 'Manager', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] } as SessionData;

const nonTrade = (o: Partial<PengajuanInput> = {}): PengajuanInput => ({
  tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-1',
  dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN', ...o,
});
const trade = (o: Partial<PengajuanInput> = {}): PengajuanInput =>
  nonTrade({ tipe: 'Trade', vendorKode: 'V1', poNumber: 'PO/HL/2026/001', jenisPembayaran: 'DP', ...o });

let w: ReturnType<typeof authWorld>;
const trx = () => w.store.rowsOf(TRX_PENGAJUAN);
const rowOf = (id: string): R => trx().find((r) => r[C('ID_TRX')] === id)!;
const setCell = (id: string, k: string, v: string | number): void =>
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { if (r[C('ID_TRX')] === id) r[C(k)] = v; return r; }));
const attach = (id: string): void => setCell(id, 'FILE_URL', 'https://drive.google.com/file/d/abc/view');
let k = 0;
const key = (): string => `idem-key-${String(++k).padStart(8, '0')}`;
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'OK'; } catch (e) { return e instanceof AppError ? e.code : `ERR:${String(e)}`; } };
const draft = async (o: Partial<PengajuanInput> = {}, t = false): Promise<string> => (await createDraft(w.deps, citra, t ? trade(o) : nonTrade(o))).id;
const audits = () => w.store.rowsOf(AUDIT_LOG).map((r) => String(r[colIndex(AUDIT_LOG, 'Action')]));

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL'], ['PT B', 'BRAND B', '', '', 'HM']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(MASTER_VENDOR, [['V1', 'Alfa', 'Trade', "'0123", 'BCA', 'Alfa', "'99", 'Approved'], ['V2', 'Beta', 'Trade', '', '', '', '', 'Pending'], ['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved'], ['V4', 'Delta', 'Trade', '', '', '', '', 'Approved']]);
  w.store.seed(DB_PO, [poRow(), poRow({ PO: 'PO/HL/2026/002', 'Kode Vendor': 'V4' })]);
  w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', 10)]);
  w.store.seed(TRX_PENGAJUAN, []);
  w.store.seed(TRX_APPROVAL, []);
});

describe('buat draft', () => {
  it('menurunkan company/PIC/created_by dari server, bukan klien; angka dihitung server', async () => {
    const r = await createDraft(w.deps, citra, nonTrade({ invoiceAmount: 4_600_000, statusPPN: 'Exclude PPN' }));
    expect(r).toMatchObject({ id: 'NTR-00001', finalAmount: 5_106_000, perluCFO: true });
    const row = rowOf('NTR-00001');
    expect(row[C('COMPANY')]).toBe('PT A');
    expect(row[C('PIC')]).toBe('Citra');
    expect(row[C('CREATED_BY')]).toBe('citra@x.id');
    expect(row[C('STATUS')]).toBe('Draft');
    expect(row[C('REQUIRE_CFO')]).toBe('YES');
    expect(audits()).toEqual(['CREATE']);
  });
  it('ID berurutan per tipe', async () => {
    expect(await draft({ noInvoice: 'A' })).toBe('NTR-00001');
    expect(await draft({ noInvoice: 'B' })).toBe('NTR-00002');
    expect(await draft({ noInvoice: 'C', poNumber: undefined }, false)).toBe('NTR-00003');
  });
  it('otorisasi: brand/dept di luar peran Level 1 => FORBIDDEN; Manager => FORBIDDEN', async () => {
    expect(await code(createDraft(w.deps, citra, nonTrade({ departement: 'DEPT Z' })))).toBe('FORBIDDEN');
    expect(await code(createDraft(w.deps, budi, nonTrade()))).toBe('FORBIDDEN');
    expect(trx()).toHaveLength(0);
  });
  it('I8: vendor Pending / tipe tak cocok / tak ada => RULE_VIOLATION', async () => {
    expect(await code(createDraft(w.deps, citra, trade({ vendorKode: 'V2' })))).toBe('RULE_VIOLATION');
    expect(await code(createDraft(w.deps, citra, nonTrade({ vendorKode: 'V1' })))).toBe('RULE_VIOLATION');
    expect(await code(createDraft(w.deps, citra, nonTrade({ vendorKode: 'V99' })))).toBe('RULE_VIOLATION');
  });
  it('Trade: PO tak ada => NOT_FOUND; vendor != vendor PO => RULE_VIOLATION', async () => {
    expect(await code(createDraft(w.deps, citra, trade({ poNumber: 'PO/XX/1' })))).toBe('NOT_FOUND');
    expect(await code(createDraft(w.deps, citra, trade({ poNumber: 'PO/HL/2026/002' })))).toBe('RULE_VIOLATION'); // V1 vs V4
  });
  it('tanggal fiktif ditolak', async () => {
    expect(await code(createDraft(w.deps, citra, nonTrade({ dateInvoice: '2026-02-31' })))).toBe('RULE_VIOLATION');
  });
  it('I9: invoice sama vendor sama ditolak; setelah Rejected boleh lagi', async () => {
    const id = await draft();
    expect(await code(createDraft(w.deps, citra, nonTrade({ noInvoice: ' inv-1' })))).toBe('RULE_VIOLATION');
    setCell(id, 'STATUS', 'Rejected');
    expect(await code(createDraft(w.deps, citra, nonTrade()))).toBe('OK');
  });
  it('I9 race: 20 draft invoice sama paralel => tepat satu lolos', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => code(createDraft(w.deps, citra, nonTrade()))));
    expect(res.filter((x) => x === 'OK')).toHaveLength(1);
    expect(trx()).toHaveLength(1);
  });
  it('race ID: 20 draft invoice berbeda paralel => ID unik berurutan', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => createDraft(w.deps, citra, nonTrade({ noInvoice: `P-${i}` }))));
    const ids = trx().map((r) => r[C('ID_TRX')]);
    expect(new Set(ids).size).toBe(20);
  });
  it('idempotency-key sama => satu draft', async () => {
    const kk = key();
    const a = await createDraft(w.deps, citra, nonTrade(), kk);
    const b = await createDraft(w.deps, citra, nonTrade(), kk);
    expect(b).toEqual(a);
    expect(trx()).toHaveLength(1);
  });
});

describe('update draft (I12)', () => {
  it('pemilik mengubah draft; PPh & catatan finance dikosongkan; audit UPDATE', async () => {
    const id = await draft();
    setCell(id, 'JENIS_PPH', 'PPh 23'); setCell(id, 'PPH_AMOUNT', 999); setCell(id, 'PPH_RATE', 0.02); setCell(id, 'NOTES_FINANCE', 'lama');
    const r = await updateDraft(w.deps, citra, id, nonTrade({ invoiceAmount: 2_000_000 }));
    expect(r.finalAmount).toBe(2_000_000);
    const row = rowOf(id);
    expect([row[C('JENIS_PPH')], row[C('PPH_AMOUNT')], row[C('PPH_RATE')], row[C('NOTES_FINANCE')]]).toEqual(['-', 0, 0, '']);
    expect(audits()).toEqual(['CREATE', 'UPDATE']);
  });
  it('bukan pemilik => FORBIDDEN', async () => {
    const id = await draft();
    const lain = { ...citra, email: 'lain@x.id' } as SessionData;
    expect(await code(updateDraft(w.deps, lain, id, nonTrade()))).toBe('FORBIDDEN');
  });
  it('status terkunci => CONFLICT; Revision Needed boleh', async () => {
    const id = await draft();
    setCell(id, 'STATUS', 'Submitted');
    expect(await code(updateDraft(w.deps, citra, id, nonTrade()))).toBe('CONFLICT');
    setCell(id, 'STATUS', 'Revision Needed');
    expect(await code(updateDraft(w.deps, citra, id, nonTrade()))).toBe('OK');
  });
  it('tipe tidak bisa diubah', async () => {
    const id = await draft();
    expect(await code(updateDraft(w.deps, citra, id, trade()))).toBe('RULE_VIOLATION');
  });
  it('ID tak ada => NOT_FOUND; invoice bentrok dokumen lain => RULE_VIOLATION; invoice sendiri tidak bentrok', async () => {
    expect(await code(updateDraft(w.deps, citra, 'NTR-99999', nonTrade()))).toBe('NOT_FOUND');
    const a = await draft({ noInvoice: 'A' }); await draft({ noInvoice: 'B' });
    expect(await code(updateDraft(w.deps, citra, a, nonTrade({ noInvoice: 'B' })))).toBe('RULE_VIOLATION');
    expect(await code(updateDraft(w.deps, citra, a, nonTrade({ noInvoice: 'A' })))).toBe('OK');
  });
});

describe('submit', () => {
  it('Idempotency-Key wajib', async () => {
    const id = await draft(); attach(id);
    expect(await code(submitPengajuan(w.deps, citra, id, undefined))).toBe('VALIDATION');
  });
  it('sukses: status Submitted, Trx_Approval L1, dua audit, nominal dihitung ulang', async () => {
    const id = await draft(); attach(id);
    const r = await submitPengajuan(w.deps, citra, id, key());
    expect(r).toMatchObject({ id, status: 'Submitted', finalAmount: 1_000_000, perluCFO: false });
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    const ap = w.store.rowsOf(TRX_APPROVAL);
    expect(ap).toHaveLength(1);
    expect(ap[0]![colIndex(TRX_APPROVAL, 'ID_Trx')]).toBe(id);
    expect(ap[0]![colIndex(TRX_APPROVAL, 'Level')]).toBe(1);
    expect(audits()).toEqual(['CREATE', 'STATUS_CHANGE', 'APPROVAL']);
  });
  it('I2: FINAL_AMOUNT / REQUIRE_CFO yang dirusak di sheet dikoreksi server saat submit', async () => {
    const id = await draft({ invoiceAmount: 6_000_000 }); attach(id);
    setCell(id, 'FINAL_AMOUNT', 1); setCell(id, 'REQUIRE_CFO', 'NO'); setCell(id, 'DPP', 1);
    const r = await submitPengajuan(w.deps, citra, id, key());
    expect(r).toMatchObject({ finalAmount: 6_000_000, perluCFO: true });
    expect(rowOf(id)[C('FINAL_AMOUNT')]).toBe(6_000_000);
    expect(rowOf(id)[C('REQUIRE_CFO')]).toBe('YES');
  });
  it('tanpa lampiran => RULE_VIOLATION', async () => {
    const id = await draft();
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('RULE_VIOLATION');
    expect(rowOf(id)[C('STATUS')]).toBe('Draft');
  });
  it('bukan pemilik => FORBIDDEN; ID tak ada => NOT_FOUND', async () => {
    const id = await draft(); attach(id);
    expect(await code(submitPengajuan(w.deps, { ...citra, email: 'lain@x.id' } as SessionData, id, key()))).toBe('FORBIDDEN');
    expect(await code(submitPengajuan(w.deps, citra, 'NTR-99999', key()))).toBe('NOT_FOUND');
  });
  it('submit dua kali (kunci beda) => kedua CONFLICT, tidak ada approval ganda', async () => {
    const id = await draft(); attach(id);
    await submitPengajuan(w.deps, citra, id, key());
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('CONFLICT');
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(1);
  });
  it('idempotency: kunci sama => replay hasil, satu approval', async () => {
    const id = await draft(); attach(id);
    const kk = key();
    const a = await submitPengajuan(w.deps, citra, id, kk);
    const b = await submitPengajuan(w.deps, citra, id, kk);
    expect(b).toEqual(a);
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(1);
  });
  it('tanpa Manager Level 2 di divisi => RULE_VIOLATION', async () => {
    const id = await draft(); attach(id);
    w.store.reorder(MASTER_USER_TTD, (rows) => rows.map((r) => (r[2] === 2 ? [...r.slice(0, 6), 'NO', ...r.slice(7)] : r)));
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('RULE_VIOLATION');
  });
  it('hak PIC dicabut setelah draft => FORBIDDEN', async () => {
    const id = await draft(); attach(id);
    const cabut = { ...citra, roles: [{ brand: 'BRAND B', dept: 'DEPT Y', level: 1 }] } as SessionData;
    expect(await code(submitPengajuan(w.deps, cabut, id, key()))).toBe('FORBIDDEN');
  });
  it('I8: vendor di-Pending-kan setelah draft => ditolak saat submit', async () => {
    const id = await draft(); attach(id);
    w.store.reorder(MASTER_VENDOR, (rows) => rows.map((r) => (r[0] === 'V3' ? [...r.slice(0, 7), 'Pending'] : r)));
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('RULE_VIOLATION');
  });
  it('I9: invoice dobel yang lolos lewat edit sheet langsung => submit dokumen kedua ditolak', async () => {
    const a = await draft({ noInvoice: 'X' }); const b = await draft({ noInvoice: 'Y' });
    attach(a); attach(b);
    await submitPengajuan(w.deps, citra, a, key());
    setCell(b, 'NO_INVOICE', 'X'); // simulasi edit langsung di sheet setelah draft sah
    expect(await code(submitPengajuan(w.deps, citra, b, key()))).toBe('RULE_VIOLATION');
    expect(rowOf(b)[C('STATUS')]).toBe('Draft');
  });
  it('fault injection: gagal tegas => tidak ada setengah-jadi, retry kunci sama berhasil sekali', async () => {
    const id = await draft(); attach(id);
    const kk = key();
    w.store.inject({ kind: 'beforeApply' });
    await expect(submitPengajuan(w.deps, citra, id, kk)).rejects.toThrow();
    expect(rowOf(id)[C('STATUS')]).toBe('Draft');
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(0);
    await submitPengajuan(w.deps, citra, id, kk);
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(1);
  });
  it('fault injection: timeout ambigu tapi berlaku => retry tidak menggandakan', async () => {
    const id = await draft(); attach(id);
    const kk = key();
    w.store.inject({ kind: 'afterApply' });
    expect(await code(submitPengajuan(w.deps, citra, id, kk))).toBe('UPSTREAM_BUSY');
    w.clock.advance(11_000);
    await submitPengajuan(w.deps, citra, id, kk);
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(1);
    expect(audits().filter((a) => a === 'STATUS_CHANGE')).toHaveLength(1);
  });
});

describe('submit Trade (I10, I11)', () => {
  // PO 1.000.000, qtyPO 10, SJ 10 (lengkap): plafon penuh 1.000.000.
  const mk = async (o: Partial<PengajuanInput> = {}): Promise<string> => { const id = await draft({ jenisPembayaran: 'Full Payment', ...o }, true); attach(id); return id; };

  it('sukses: qty snapshot & plafon dikembalikan', async () => {
    const id = await mk({ invoiceAmount: 500_000 });
    const r = await submitPengajuan(w.deps, citra, id, key());
    expect(r).toMatchObject({ status: 'Submitted', plafon: 1_000_000, sisaBolehTagih: 500_000 });
    expect(rowOf(id)[C('QTY_PO')]).toBe(10);
    expect(rowOf(id)[C('QTY_SJ')]).toBe(10);
  });
  it('plafon tepat = lolos; lebih 1 rupiah = ditolak', async () => {
    expect(await code(submitPengajuan(w.deps, citra, await mk({ invoiceAmount: 1_000_000 }), key()))).toBe('OK');
    w = authWorld(); setupAgain();
    expect(await code(submitPengajuan(w.deps, citra, await mk({ invoiceAmount: 1_000_001 }), key()))).toBe('RULE_VIOLATION');
  });
  it('SJ belum lengkap: plafon tetap grand total penuh (tanpa retensi); 1.000.000 lolos DP, 1.000.001 ditolak', async () => {
    w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', 5)]);
    const ok = await draft({ jenisPembayaran: 'DP', invoiceAmount: 1_000_000 }, true); attach(ok);
    expect(await code(submitPengajuan(w.deps, citra, ok, key()))).toBe('OK');
    w = authWorld(); setupAgain(); w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', 5)]);
    const over = await draft({ jenisPembayaran: 'DP', invoiceAmount: 1_000_001 }, true); attach(over);
    expect(await code(submitPengajuan(w.deps, citra, over, key()))).toBe('RULE_VIOLATION');
  });
  it('I11: SJ belum lengkap + Full Payment => ditolak; DP lolos', async () => {
    w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', 5)]);
    const fp = await mk({ invoiceAmount: 100_000 });
    expect(await code(submitPengajuan(w.deps, citra, fp, key()))).toBe('RULE_VIOLATION');
    const dp = await draft({ jenisPembayaran: 'DP', invoiceAmount: 100_000, noInvoice: 'DP-1' }, true); attach(dp);
    expect(await code(submitPengajuan(w.deps, citra, dp, key()))).toBe('OK');
  });
  it('kumulatif: hanya dokumen yang sudah diajukan menahan kuota (Draft tidak); dokumen kedua yang menembus plafon ditolak; Rejected/Revision melepas kuota', async () => {
    const a = await mk({ invoiceAmount: 600_000, noInvoice: 'A' });
    const b = await mk({ invoiceAmount: 600_000, noInvoice: 'B' });
    expect(await code(submitPengajuan(w.deps, citra, a, key()))).toBe('OK');           // draft b tidak menahan kuota
    expect(await code(submitPengajuan(w.deps, citra, b, key()))).toBe('RULE_VIOLATION'); // 600rb + 600rb > 1jt
    setCell(a, 'STATUS', 'Revision Needed');
    expect(await code(submitPengajuan(w.deps, citra, b, key()))).toBe('OK');           // a kembali ke PIC -> kuota lepas
    setCell(b, 'STATUS', 'Rejected');
    setCell(a, 'STATUS', 'Draft');
    expect(await code(submitPengajuan(w.deps, citra, a, key()))).toBe('OK');
  });
  it('I10 race: 20 submit paralel @300rb atas PO 1jt => tepat 3 lolos (lock po: menyerialkan), total <= plafon', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await mk({ invoiceAmount: 300_000, noInvoice: `R-${i}` }));
    const res = await Promise.all(ids.map((id) => code(submitPengajuan(w.deps, citra, id, key()))));
    expect(res.filter((x) => x === 'OK')).toHaveLength(3);
    expect(res.filter((x) => x !== 'OK').every((x) => x === 'RULE_VIOLATION' || x === 'CONFLICT' || x === 'UPSTREAM_BUSY')).toBe(true);
    const total = trx().filter((r) => r[C('STATUS')] === 'Submitted').reduce((x, r) => x + Number(r[C('FINAL_AMOUNT')]), 0);
    expect(total).toBeLessThanOrEqual(1_000_000);
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(3);
  });
  it('I10 race: 21 dokumen @50rb (1,05jt) submit paralel => tepat 20 lolos, 1 ditolak, total = plafon', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push(await mk({ invoiceAmount: 50_000, noInvoice: `S-${i}` }));
    const res = await Promise.all(ids.map((id) => code(submitPengajuan(w.deps, citra, id, key()))));
    expect(res.filter((x) => x === 'OK')).toHaveLength(20);
    const total = trx().filter((r) => r[C('STATUS')] === 'Submitted').reduce((x, r) => x + Number(r[C('FINAL_AMOUNT')]), 0);
    expect(total).toBe(1_000_000);
  });
  it('I10 race: 2 dokumen @600rb submit bersamaan => tepat satu lolos', async () => {
    const a = await mk({ invoiceAmount: 600_000, noInvoice: 'A' });
    const b = await mk({ invoiceAmount: 600_000, noInvoice: 'B' });
    const res = await Promise.all([a, b].map((id) => code(submitPengajuan(w.deps, citra, id, key()))));
    expect(res.filter((x) => x === 'OK')).toHaveLength(1);
  });
  it('I10 race: submit paralel dengan update yang menaikkan nominal dokumen lain => tidak pernah ada kumulatif Submitted di atas plafon', async () => {
    const a = await mk({ invoiceAmount: 500_000, noInvoice: 'A' });
    const b = await mk({ invoiceAmount: 400_000, noInvoice: 'B' });
    await Promise.all([
      code(submitPengajuan(w.deps, citra, a, key())),
      code(updateDraft(w.deps, citra, b, trade({ jenisPembayaran: 'Full Payment', invoiceAmount: 700_000, noInvoice: 'B' }))),
    ]);
    const c2 = await code(submitPengajuan(w.deps, citra, b, key()));
    const subs = trx().filter((r) => r[C('STATUS')] === 'Submitted').reduce((x, r) => x + Number(r[C('FINAL_AMOUNT')]), 0);
    expect(subs).toBeLessThanOrEqual(1_000_000);
    expect(['OK', 'RULE_VIOLATION']).toContain(c2);
  });
  it('PO hilang setelah draft => RULE_VIOLATION (bukan lolos)', async () => {
    const id = await mk({ invoiceAmount: 100_000 });
    w.store.seed(DB_PO, []);
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('RULE_VIOLATION');
    expect(rowOf(id)[C('STATUS')]).toBe('Draft');
  });
  it('PO tak terbaca (IMPORTRANGE error) => UPSTREAM_BUSY 503, tidak submit; pulih => bisa submit', async () => {
    const id = await mk({ invoiceAmount: 100_000 });
    for (const bad of ['#REF!', 'Loading...', '#N/A']) {
      w.store.seed(DB_PO, [poRow({ PO: bad })]);
      expect(await code(submitPengajuan(w.deps, citra, id, key())), bad).toBe('UPSTREAM_BUSY');
      expect(rowOf(id)[C('STATUS')]).toBe('Draft');
    }
    w.store.seed(DB_PO, [poRow()]);
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('OK');
  });
  it('vendor PO diganti setelah draft => ditolak', async () => {
    const id = await mk({ invoiceAmount: 100_000 });
    w.store.seed(DB_PO, [poRow({ 'Kode Vendor': 'V4' })]);
    expect(await code(submitPengajuan(w.deps, citra, id, key()))).toBe('RULE_VIOLATION');
  });
});

function setupAgain(): void {
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL'], ['PT B', 'BRAND B', '', '', 'HM']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(MASTER_VENDOR, [['V1', 'Alfa', 'Trade', "'0123", 'BCA', 'Alfa', "'99", 'Approved'], ['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved'], ['V4', 'Delta', 'Trade', '', '', '', '', 'Approved']]);
  w.store.seed(DB_PO, [poRow()]);
  w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', 10)]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
}

describe('baca (owner-only)', () => {
  it('daftar hanya milik sendiri, terbaru dulu, tanpa URL file mentah', async () => {
    const a = await draft({ noInvoice: 'A' }); const b = await draft({ noInvoice: 'B' }); attach(a);
    await createDraft(w.deps, { ...citra, email: 'lain@x.id', roles: citra.roles } as SessionData, nonTrade({ noInvoice: 'L' }));
    const l = await listMine(w.deps, citra);
    expect(l.map((x) => x.id)).toEqual([b, a]);
    expect(l[1]).toMatchObject({ punyaLampiran: true, editable: true });
    expect(JSON.stringify(l)).not.toContain('drive.google.com');
  });
  it('detail milik orang lain => NOT_FOUND (tidak membocorkan keberadaan)', async () => {
    const id = await draft();
    expect(await code(getMine(w.deps, { ...citra, email: 'lain@x.id' } as SessionData, id))).toBe('NOT_FOUND');
    expect(await code(getMine(w.deps, citra, id))).toBe('OK');
  });
});
