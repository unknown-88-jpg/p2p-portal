import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'trial', APP_BASE_URL: 'http://localhost:3000', SHEET_ID: 'sheet-id-1234567', DRIVE_ROOT_ID: 'drive-root', GOOGLE_SA_JSON: 'x'.repeat(60),
    JWT_SECRET: 'j'.repeat(40), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't'.repeat(20), CRON_SECRET: 'c'.repeat(20), HEALTH_TOKEN: 'h'.repeat(20),
  });
});
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as setPassword } from '@/app/api/auth/set-password/route';
import { GET as coa } from '@/app/api/master/coa/route';
import { GET as entitas } from '@/app/api/master/entitas/route';
import { GET as kas } from '@/app/api/master/kas/route';
import { GET as org } from '@/app/api/master/org/route';
import { GET as pph } from '@/app/api/master/pph/route';
import { GET as vendors } from '@/app/api/master/vendors/route';
import { GET as po } from '@/app/api/po/[poNumber]/route';
import { POST as tax } from '@/app/api/calc/tax/route';
import { __setScryptCostForTests } from '@/infra/password';
import { DB_PO, DB_SJ, MASTER_COA, MASTER_PPH, MASTER_SETTING, MASTER_VENDOR, TRX_PENGAJUAN } from '@/repo/schema';
import { invalidateMaster } from '@/server/master';
import { issueSetPasswordLink } from '@/server/auth';
import { __setAuthDepsForTests } from '@/server/runtime';
import { P, authWorld, tokenOf } from './auth-helpers';
import { trxRow } from './helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
type R = (string | number | null)[];
const get = (path: string, cookie?: string): Request => new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { 'x-real-ip': '10.2.2.2', ...(cookie ? { cookie } : {}) } });
const post = (path: string, body: unknown, o: { cookie?: string; origin?: string | null } = {}): Request => {
  const h: Record<string, string> = { 'x-real-ip': '10.2.2.2', 'content-type': 'application/json' };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
};
const poRow = (over: Partial<Record<string, string | number | null>> = {}): R => {
  const base: Record<string, string | number | null> = { PO: 'PO/HL/2026/001', Company_Name: 'PT Dari PO', Tax_Status: 'Exclude PPN', Subtotal: 900_000, Grand_Total: 1_000_000, Item_Name: 'Kain', 'QTY PO': 10, 'Kode Vendor': 'V1' };
  return DB_PO.cols.map((c) => (c.key in { ...base, ...over } ? ({ ...base, ...over } as Record<string, string | number | null>)[c.key]! : null));
};
const sjRow = (poId: string, qty: number | string): R => DB_SJ.cols.map((c) => (c.key === 'PO_ID' ? poId : c.key === 'Total_Qty_Received' ? qty : c.key === 'GR_ID' ? 'GR1' : null));

let w: ReturnType<typeof authWorld>;
let ck: string;
beforeEach(async () => {
  w = authWorld(); __setAuthDepsForTests(w.deps);
  w.store.seed(MASTER_SETTING, [['PT Hemas', 'HEYLOCAL', '', '', 'HL'], ['PT Male', 'HEYMALE', '', '', 'HM']]);
  w.store.seed(MASTER_COA, [['ASET', 'LANCAR', 'KAS DAN SETARA KAS', 'BANK', 'BCA 1'], ['ASET', 'KAS DAN SETARA KAS', 'BANK', 'MANDIRI 2', '-'], ['BEBAN', 'A', 'B', 'C', 'D']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04], ['PPh 4(2)', 0.1, 0.2], ['PPh Salah', 2, 2]]);
  w.store.seed(MASTER_VENDOR, [['V1', 'Alfa', 'Trade', "'0123", 'BCA', 'Alfa', "'99", 'Approved'], ['V2', 'Beta', 'Trade', '', '', '', '', 'Pending'], ['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(DB_PO, [poRow(), poRow({ PO: 'PO/HL/2026/002', 'Kode Vendor': 'V2' }), poRow({ PO: 'PO/HL/2026/003', 'Kode Vendor': 'V9' }), poRow({ PO: 'PO/HM/2026/004', 'QTY PO': 0 })]);
  w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', 4), sjRow('po/hl/2026/001', 2)]);
  w.store.seed(TRX_PENGAJUAN, []);
  const { link } = await issueSetPasswordLink(w.deps, P.budi);
  await setPassword(post('/api/auth/set-password', { token: tokenOf(link), password: 'Kopi-Manis-47' }));
  const r = await login(post('/api/auth/login', { phone: '081200000001', password: 'Kopi-Manis-47' }));
  ck = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
});
const j = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M3: semua endpoint wajib login', () => {
  it('tanpa sesi -> 401', async () => {
    const hs: [string, (r: Request) => Promise<Response>][] = [['/api/master/org', org], ['/api/master/entitas', entitas], ['/api/master/coa', coa], ['/api/master/kas', kas], ['/api/master/pph', pph], ['/api/master/vendors?tipe=Trade', vendors], ['/api/po/PO-1', po]];
    for (const [p, h] of hs) expect((await h(get(p))).status, p).toBe(401);
    expect((await tax(post('/api/calc/tax', { invAmount: 1000 }))).status).toBe(401);
  });
});

describe('M3: master data', () => {
  it('org: tanpa email, dengan ?brand&dept memberi opsi PIC; parameter terlalu panjang -> 400', async () => {
    const r = await j(await org(get('/api/master/org', ck)));
    expect(r.org.brands).toEqual(['BRAND A', 'BRAND B']);
    expect(JSON.stringify(r)).not.toMatch(/@x\.id|"email"/);
    const p = await j(await org(get('/api/master/org?brand=brand%20a&dept=dept%20x', ck)));
    expect(p.pic).toMatchObject({ pics: ['Citra'], adaManager: true, manager: 'Budi' });
    expect((await j(await org(get('/api/master/org?brand=x', ck)))).pic.peringatan).toBe('Divisi tidak ditemukan.');
    expect((await org(get('/api/master/org?brand=' + 'A'.repeat(81) + '&dept=x', ck))).status).toBe(400);
  });
  it('entitas / coa / kas / pph', async () => {
    expect((await j(await entitas(get('/api/master/entitas', ck)))).entitas.prefixMap.HL).toEqual({ brand: 'HEYLOCAL', company: 'PT Hemas' });
    expect((await j(await coa(get('/api/master/coa', ck)))).coa).toHaveLength(3);
    expect((await j(await kas(get('/api/master/kas', ck)))).kas.map((k: { akun: string }) => k.akun)).toEqual(['BCA 1', 'MANDIRI 2']);
    expect((await j(await pph(get('/api/master/pph', ck)))).pph[0]).toEqual({ jenis: 'PPh 23', tarifNPWP: 0.02, tarifNon: 0.04 });
  });
  it('vendors: hanya Approved sesuai tipe; tipe salah -> 400', async () => {
    expect((await j(await vendors(get('/api/master/vendors?tipe=Trade', ck)))).vendors.map((v: { kode: string }) => v.kode)).toEqual(['V1']);
    expect((await j(await vendors(get('/api/master/vendors?tipe=Non-Trade', ck)))).vendors.map((v: { kode: string }) => v.kode)).toEqual(['V3']);
    expect((await vendors(get('/api/master/vendors?tipe=Lain', ck))).status).toBe(400);
  });
  it('cache: panggilan kedua tidak membaca Sheets; invalidateMaster memaksa baca ulang', async () => {
    await pph(get('/api/master/pph', ck));
    const n = w.store.reads;
    await pph(get('/api/master/pph', ck));
    expect(w.store.reads).toBe(n);
    w.store.seed(MASTER_PPH, [['PPh 23', 0.03, 0.06]]);
    await invalidateMaster(w.deps);
    expect((await j(await pph(get('/api/master/pph', ck)))).pph[0].tarifNPWP).toBe(0.03);
  });
});

describe('M3: PO', () => {
  const trx = (id: string, poNo: string, status: string, final: number, paid = 0): R => trxRow(id, { PO_NUMBER: poNo, STATUS: status, FINAL_AMOUNT: final, TOTAL_PAID: paid, NO_INVOICE: 'INV-' + id, JENIS_PEMBAYARAN: 'DP' });
  it('ketemu: qty SJ dijumlah (case-insensitive), plafon 90% karena SJ belum penuh, vendor & brand dari prefix', async () => {
    const r = await j(await po(get('/api/po/po%2Fhl%2F2026%2F001', ck)));
    expect(r.po).toMatchObject({ poNumber: 'PO/HL/2026/001', companyName: 'PT Hemas', brandName: 'HEYLOCAL', qtyPO: 10, qtySJ: 6, qtyKurang: 4, plafonSJ: 900_000, sisaBolehTagih: 900_000, grandTotalPO: 1_000_000 });
    expect(r.po.vendor).toMatchObject({ kode: 'V1', npwp: '0123', noRekening: '99', status: 'Approved' });
  });
  it('tidak ada -> 404 (bukan 503)', async () => { expect((await po(get('/api/po/PO-NGAWUR', ck))).status).toBe(404); });
  it('DB_PO IMPORTRANGE error / loading -> 503 UPSTREAM_BUSY, BUKAN 404', async () => {
    for (const bad of ['#REF!', 'Loading...', '#N/A']) {
      w.store.seed(DB_PO, [poRow({ PO: bad })]);
      const r = await po(get('/api/po/PO%2FHL%2F2026%2F001', ck));
      expect(r.status, bad).toBe(503);
      expect((await j(r)).error.code).toBe('UPSTREAM_BUSY');
      expect(r.headers.get('retry-after')).toBe('3');
    }
  });
  it('DB_SJ error -> 503; sel error di kolom tak terpakai TIDAK memblokir; error di baris PO lain (kolom terpakai) TIDAK memblokir', async () => {
    w.store.seed(DB_SJ, [sjRow('#REF!', 1)]);
    expect((await po(get('/api/po/PO%2FHL%2F2026%2F001', ck))).status).toBe(503);
    w.store.seed(DB_SJ, [sjRow('PO/HL/2026/001', '#N/A')]);
    expect((await po(get('/api/po/PO%2FHL%2F2026%2F001', ck))).status).toBe(503);
    w.store.seed(DB_SJ, [sjRow('PO/LAIN', '#N/A'), sjRow('PO/HL/2026/001', 10)]);
    w.store.seed(DB_PO, [poRow({ Vendor_Quote_No: '#N/A', Grand_Total: 1_000_000 }), poRow({ PO: 'PO/LAIN', Grand_Total: '#REF!' })]);
    const ok = await j(await po(get('/api/po/PO%2FHL%2F2026%2F001', ck)));
    expect(ok.po.plafonSJ).toBe(1_000_000); // SJ penuh
    w.store.seed(DB_PO, [poRow({ Grand_Total: '#REF!' })]);
    expect((await po(get('/api/po/PO%2FHL%2F2026%2F001', ck))).status).toBe(503); // baris yang cocok rusak
  });
  it('vendor tak ada di master / belum Approved -> 422 dengan pesan lama', async () => {
    const a = await po(get('/api/po/PO%2FHL%2F2026%2F003', ck));
    expect(a.status).toBe(422); expect((await j(a)).error.message).toBe('Vendor "V9" di PO ini tidak ada di Master_Vendor.');
    const b = await po(get('/api/po/PO%2FHL%2F2026%2F002', ck));
    expect(b.status).toBe(422); expect((await j(b)).error.message).toMatch(/masih berstatus Pending/);
  });
  it('tagihan kumulatif: Rejected tidak dihitung; excludeIdTrx hanya untuk tampilan; sisa tidak negatif', async () => {
    w.store.seed(TRX_PENGAJUAN, [trx('T1', 'PO/HL/2026/001', 'Submitted', 400_000, 100_000), trx('T2', 'po/hl/2026/001', 'Rejected', 300_000), trx('T3', 'PO/HL/2026/001', 'Paid', 600_000, 600_000), trx('T4', 'PO/LAIN', 'Paid', 5)]);
    const r = await j(await po(get('/api/po/PO%2FHL%2F2026%2F001', ck)));
    expect(r.po.billing).toMatchObject({ totalDiajukan: 1_000_000, totalDibayar: 700_000 });
    expect(r.po.billing.dokumen.map((d: { idTrx: string }) => d.idTrx)).toEqual(['T1', 'T3']);
    expect(r.po.sisaBolehTagih).toBe(0); // plafon 900k < 1jt diajukan -> 0, bukan negatif
    const ex = await j(await po(get('/api/po/PO%2FHL%2F2026%2F001?excludeIdTrx=T3', ck)));
    expect(ex.po.billing.totalDiajukan).toBe(400_000);
    expect(ex.po.sisaBolehTagih).toBe(500_000);
  });
  it('input aneh: nomor kosong/terlalu panjang/%-rusak -> 400', async () => {
    expect((await po(get('/api/po/%20', ck))).status).toBe(400);
    expect((await po(get('/api/po/' + 'A'.repeat(61), ck))).status).toBe(400);
    expect((await po(get('/api/po/%E0%A4%A', ck))).status).toBe(400);
  });
});

describe('M3: POST /api/calc/tax', () => {
  it('hitung (Exclude PPN + PPh 23 ber-NPWP)', async () => {
    const r = await tax(post('/api/calc/tax', { invAmount: 1_000_000, diskon: 100_000, statusPPN: 'Exclude PPN', jenisPPh: 'PPh 23', npwpVendor: "'01234" }, { cookie: ck }));
    expect(r.status).toBe(200);
    expect((await j(r)).hasil).toEqual({ dpp: 1_000_000, ppnAmount: 110_000, pphRate: 0.02, pphAmount: 20_000, finalAmount: 990_000 });
  });
  it('aturan bisnis -> 422 dengan pesan lama; tarif master rusak -> 422', async () => {
    const neg = await tax(post('/api/calc/tax', { invAmount: -5 }, { cookie: ck }));
    expect(neg.status).toBe(422); expect((await j(neg)).error.message).toBe('Nominal tidak boleh negatif.');
    expect((await j(await tax(post('/api/calc/tax', { invAmount: 100, diskon: 200 }, { cookie: ck })))).error.message).toBe('Diskon tidak boleh melebihi nilai invoice.');
    expect((await j(await tax(post('/api/calc/tax', { invAmount: 100, jenisPPh: 'PPh Gaib' }, { cookie: ck })))).error.message).toBe('Jenis PPh "PPh Gaib" tidak ada di Master_PPh.');
    const bad = await tax(post('/api/calc/tax', { invAmount: 100, jenisPPh: 'PPh Salah', npwpVendor: '1' }, { cookie: ck }));
    expect(bad.status).toBe(422); expect((await j(bad)).error.message).toMatch(/tidak valid/);
  });
  it('input ketat: string-angka, kunci asing, enum salah, NaN-like -> 400', async () => {
    for (const b of [{ invAmount: '1000' }, { invAmount: 1000, hasilBrowser: 1 }, { invAmount: 1000, statusPPN: 'Foo' }, { invAmount: 1e20 }, {}, { invAmount: null }]) {
      expect((await tax(post('/api/calc/tax', b, { cookie: ck }))).status, JSON.stringify(b)).toBe(400);
    }
  });
  it('CSRF: tanpa Origin yang sah -> 403', async () => {
    expect((await tax(post('/api/calc/tax', { invAmount: 1 }, { cookie: ck, origin: 'http://evil.test' }))).status).toBe(403);
  });
  it('respons no-store', async () => { expect((await tax(post('/api/calc/tax', { invAmount: 1 }, { cookie: ck }))).headers.get('cache-control')).toBe('no-store'); });
});
