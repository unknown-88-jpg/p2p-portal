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
import { GET as list, POST as create } from '@/app/api/pengajuan/route';
import { GET as detail } from '@/app/api/pengajuan/[id]/route';
import { POST as update } from '@/app/api/pengajuan/[id]/update/route';
import { POST as submit } from '@/app/api/pengajuan/[id]/submit/route';
import { __setScryptCostForTests } from '@/infra/password';
import { MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { issueSetPasswordLink } from '@/server/auth';
import { __setAuthDepsForTests } from '@/server/runtime';
import { P, authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const get = (path: string, cookie?: string): Request => new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { 'x-real-ip': '10.4.4.4', ...(cookie ? { cookie } : {}) } });
const post = (path: string, body: unknown, o: { cookie?: string; idem?: string; origin?: string | null } = {}): Request => {
  const h: Record<string, string> = { 'x-real-ip': '10.4.4.4', 'content-type': 'application/json' };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  if (o.idem) h['idempotency-key'] = o.idem;
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
};
const j = async (r: Response) => (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const body = (o: Record<string, unknown> = {}) => ({
  tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-1',
  dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN', ...o,
});

let w: ReturnType<typeof authWorld>;
let ck: string;
async function loginAs(phone: string, plain: string, raw: string): Promise<string> {
  const { link } = await issueSetPasswordLink(w.deps, plain);
  await setPassword(post('/api/auth/set-password', { token: tokenOf(link), password: 'Kopi-Manis-47' }));
  const r = await login(post('/api/auth/login', { phone: raw, password: 'Kopi-Manis-47' }));
  return (r.headers.get('set-cookie') ?? '').split(';')[0]!;
}
beforeEach(async () => {
  w = authWorld(); __setAuthDepsForTests(w.deps);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
  ck = await loginAs('', P.citra, '081200000002');
});

describe('API pengajuan', () => {
  it('tanpa sesi => 401; tanpa Origin pada POST => ditolak', async () => {
    expect((await list(get('/api/pengajuan'))).status).toBe(401);
    expect((await create(post('/api/pengajuan', body(), { origin: null, cookie: ck }))).status).toBe(403);
  });
  it('buat => 201 + hasil; angka dari klien (finalAmount/company/pic/createdBy) => 400 (strict)', async () => {
    const r = await create(post('/api/pengajuan', body(), { cookie: ck }));
    expect(r.status).toBe(201);
    expect((await j(r)).hasil).toMatchObject({ id: 'NTR-00001', finalAmount: 1_000_000, perluCFO: false });
    for (const extra of [{ finalAmount: 1 }, { company: 'X' }, { pic: 'Y' }, { createdBy: 'z@z' }, { requireCfo: 'NO' }, { dpp: 1 }, { status: 'Approved' }]) {
      const bad = await create(post('/api/pengajuan', body({ ...extra, noInvoice: 'INV-2' }), { cookie: ck }));
      expect(bad.status, JSON.stringify(extra)).toBe(400);
    }
    expect(w.store.rowsOf(TRX_PENGAJUAN)).toHaveLength(1);
  });
  it('angka negatif / bukan angka / tanggal bentuk salah => 400', async () => {
    for (const o of [{ invoiceAmount: -1 }, { invoiceAmount: '1000' }, { dateInvoice: '01-10-2026' }, { tipe: 'Lain' }, { jenisPembayaran: 'Cicil' }]) {
      expect((await create(post('/api/pengajuan', body(o), { cookie: ck }))).status, JSON.stringify(o)).toBe(400);
    }
  });
  it('divisi di luar peran => 403; vendor tak sah => 422', async () => {
    expect((await create(post('/api/pengajuan', body({ departement: 'DEPT Z' }), { cookie: ck }))).status).toBe(403);
    expect((await create(post('/api/pengajuan', body({ vendorKode: 'V99' }), { cookie: ck }))).status).toBe(422);
  });
  it('daftar + detail + update; ID berformat salah => 400/404', async () => {
    await create(post('/api/pengajuan', body(), { cookie: ck }));
    const l = await j(await list(get('/api/pengajuan', ck)));
    expect(l.pengajuan).toHaveLength(1);
    const d = await detail(get('/api/pengajuan/NTR-00001', ck));
    expect(d.status).toBe(200);
    const u = await update(post('/api/pengajuan/NTR-00001/update', body({ invoiceAmount: 2_000_000 }), { cookie: ck }));
    expect(u.status).toBe(200);
    expect((await j(u)).hasil.finalAmount).toBe(2_000_000);
    expect([400, 404]).toContain((await detail(get('/api/pengajuan/..%2Fx', ck))).status);
  });
  it('submit: tanpa Idempotency-Key => 400; tanpa lampiran => 422; dengan lampiran + kunci => 200, replay sama', async () => {
    await create(post('/api/pengajuan', body(), { cookie: ck }));
    // tambahkan Manager aktif (Budi punya password? tidak perlu: cukup baris aktif di Master_User_TTD)
    expect((await submit(post('/api/pengajuan/NTR-00001/submit', {}, { cookie: ck }))).status).toBe(400);
    expect((await submit(post('/api/pengajuan/NTR-00001/submit', {}, { cookie: ck, idem: 'idem-aaaaaaaa' }))).status).toBe(422);
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { r[colIndex(TRX_PENGAJUAN, 'FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return r; }));
    const a = await submit(post('/api/pengajuan/NTR-00001/submit', {}, { cookie: ck, idem: 'idem-bbbbbbbb' }));
    expect(a.status).toBe(200);
    const aj = await j(a);
    expect(aj.hasil.status).toBe('Submitted');
    const b = await submit(post('/api/pengajuan/NTR-00001/submit', {}, { cookie: ck, idem: 'idem-bbbbbbbb' }));
    expect((await j(b)).hasil).toEqual(aj.hasil);
    expect(w.store.rowsOf(TRX_APPROVAL)).toHaveLength(1);
  });
  it('pengguna lain tidak bisa melihat / mengubah / submit dokumen orang (404/403)', async () => {
    await create(post('/api/pengajuan', body(), { cookie: ck }));
    const other = await loginAs('', P.budi, '081200000001'); // Manager: tak punya hak buat, dan bukan pemilik
    expect((await detail(get('/api/pengajuan/NTR-00001', other))).status).toBe(404);
    expect((await j(await list(get('/api/pengajuan', other)))).pengajuan).toHaveLength(0);
    expect((await update(post('/api/pengajuan/NTR-00001/update', body(), { cookie: other }))).status).toBe(403);
    expect((await submit(post('/api/pengajuan/NTR-00001/submit', {}, { cookie: other, idem: 'idem-cccccccc' }))).status).toBe(403);
  });
});
