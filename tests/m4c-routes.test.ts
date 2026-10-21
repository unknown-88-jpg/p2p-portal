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
import { GET as cekInv } from '@/app/api/pengajuan/cek-invoice/route';
import { GET as detail } from '@/app/api/pengajuan/[id]/route';
import { __setScryptCostForTests } from '@/infra/password';
import { MASTER_SETTING, MASTER_VENDOR, TRX_PENGAJUAN } from '@/repo/schema';
import { issueSetPasswordLink } from '@/server/auth';
import { __setAuthDepsForTests } from '@/server/runtime';
import { P, authWorld, tokenOf } from './auth-helpers';
import { trxRow } from './helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const get = (path: string, cookie?: string): Request => new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { 'x-real-ip': '10.7.7.7', ...(cookie ? { cookie } : {}) } });
const post = (path: string, body: unknown): Request => new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'x-real-ip': '10.7.7.7', 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
const j = async (r: Response) => (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = (o: Record<string, string>): string => '/api/pengajuan/cek-invoice?' + new URLSearchParams(o).toString();

let w: ReturnType<typeof authWorld>;
let ck: string;
async function loginAs(plain: string, raw: string): Promise<string> {
  const { link } = await issueSetPasswordLink(w.deps, plain);
  await setPassword(post('/api/auth/set-password', { token: tokenOf(link), password: 'Kopi-Manis-47' }));
  return ((await login(post('/api/auth/login', { phone: raw, password: 'Kopi-Manis-47' }))).headers.get('set-cookie') ?? '').split(';')[0]!;
}
beforeEach(async () => {
  w = authWorld(); __setAuthDepsForTests(w.deps);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved'], ['V4', 'Hari', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, [
    trxRow('NTR-00001', { VENDOR_CODE: 'V3', VENDOR_NAME: 'Gama', NO_INVOICE: 'INV-1', STATUS: 'Submitted', CREATED_BY: 'orang-lain@x.id' }),
    trxRow('NTR-00002', { VENDOR_CODE: 'V3', VENDOR_NAME: 'Gama', NO_INVOICE: 'INV-RJ', STATUS: 'Rejected', CREATED_BY: 'orang-lain@x.id' }),
    trxRow('NTR-00003', { VENDOR_CODE: 'V3', VENDOR_NAME: 'Gama', NO_INVOICE: 'INV-DRAFT-SAYA', STATUS: 'Draft', CREATED_BY: 'citra@x.id' }),
  ]);
  ck = await loginAs(P.citra, '081200000002');
});

describe('GET /api/pengajuan/cek-invoice (saran inline)', () => {
  it('duplikat ditemukan: pesan sama dengan penolakan create, memuat ID dokumen lama', async () => {
    const r = await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-1' }), ck));
    expect(r.status).toBe(200);
    const b = await j(r);
    expect(b.duplikat).toMatchObject({ id: 'NTR-00001' });
    expect(b.duplikat.pesan).toContain('sudah pernah diajukan (NTR-00001)');
  });
  it('dinormalisasi (huruf besar/kecil & spasi), vendor beda = bukan duplikat, tak ada = null', async () => {
    expect((await j(await cekInv(get(q({ vendorKode: 'v3', noInvoice: '  inv-1 ' }), ck)))).duplikat?.id).toBe('NTR-00001');
    expect((await j(await cekInv(get(q({ vendorKode: 'V4', noInvoice: 'INV-1' }), ck)))).duplikat).toBeNull();
    expect((await j(await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-BARU' }), ck)))).duplikat).toBeNull();
  });
  it('dokumen Rejected tidak dihitung (I9); dokumen sendiri dikecualikan saat edit (excludeId)', async () => {
    expect((await j(await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-RJ' }), ck)))).duplikat).toBeNull();
    expect((await j(await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-DRAFT-SAYA' }), ck)))).duplikat?.id).toBe('NTR-00003');
    expect((await j(await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-DRAFT-SAYA', excludeId: 'NTR-00003' }), ck)))).duplikat).toBeNull();
  });
  it('vendor tak dikenal => null (bukan galat; create yang menolak)', async () => {
    const r = await cekInv(get(q({ vendorKode: 'V99', noInvoice: 'INV-1' }), ck));
    expect(r.status).toBe(200); expect((await j(r)).duplikat).toBeNull();
  });
  it('tanpa sesi 401; Manager (bukan pengaju) 403; parameter rusak 400', async () => {
    expect((await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-1' })))).status).toBe(401);
    const mgr = await loginAs(P.budi, '081200000001');
    expect((await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-1' }), mgr))).status).toBe(403);
    for (const bad of [q({ vendorKode: '', noInvoice: 'X' }), q({ vendorKode: 'V3', noInvoice: '' }), q({ vendorKode: 'V3', noInvoice: 'x'.repeat(61) }), q({ vendorKode: 'V3', noInvoice: 'A', excludeId: '../x' })]) {
      expect((await cekInv(get(bad, ck))).status, bad).toBe(400);
    }
  });
  it('hanya membaca: tidak ada baris baru / audit', async () => {
    const before = w.store.rowsOf(TRX_PENGAJUAN).length;
    await cekInv(get(q({ vendorKode: 'V3', noInvoice: 'INV-1' }), ck));
    expect(w.store.rowsOf(TRX_PENGAJUAN)).toHaveLength(before);
    expect(w.audit().filter((a) => a.action === 'CEK_INVOICE')).toHaveLength(0);
  });
  it('rute statis tidak bentrok dengan /api/pengajuan/[id] (ID tidak valid tetap 400)', async () => {
    expect((await detail(get('/api/pengajuan/cek-invoice', ck))).status).toBe(400);
  });
});
