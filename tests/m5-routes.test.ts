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
import { POST as stepUp } from '@/app/api/auth/step-up/route';
import { GET as inboxGet } from '@/app/api/approvals/inbox/route';
import { POST as approvePost } from '@/app/api/approvals/[id]/approve/route';
import { POST as rejectPost } from '@/app/api/approvals/[id]/reject/route';
import { __setScryptCostForTests } from '@/infra/password';
import { MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { issueSetPasswordLink } from '@/server/auth';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { __setAuthDepsForTests } from '@/server/runtime';
import { P, authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const get = (path: string, cookie?: string): Request => new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { 'x-real-ip': '10.6.6.6', ...(cookie ? { cookie } : {}) } });
const post = (path: string, body: unknown, o: { cookie?: string; idem?: string; origin?: string | null } = {}): Request => {
  const h: Record<string, string> = { 'x-real-ip': '10.6.6.6', 'content-type': 'application/json' };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  if (o.idem) h['idempotency-key'] = o.idem;
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
};
const j = async (r: Response) => (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PW = 'Kopi-Manis-47';

let w: ReturnType<typeof authWorld>;
let budi: string, citra: string;
const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const status = (id: string) => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)![C('STATUS')];
async function loginAs(plain: string, raw: string): Promise<string> {
  const { link } = await issueSetPasswordLink(w.deps, plain);
  await setPassword(post('/api/auth/set-password', { token: tokenOf(link), password: PW }));
  return ((await login(post('/api/auth/login', { phone: raw, password: PW }))).headers.get('set-cookie') ?? '').split(';')[0]!;
}
async function submitted(amount: number, inv: string): Promise<string> {
  const s = { phone: P.citra, email: 'citra@x.id', nama: 'Citra', jabatan: 'PIC', created: 0, ep: 0, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] };
  const r = await createDraft(w.deps, s, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Tes', vendorKode: 'V3', noInvoice: inv, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === r.id) x[C('FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return x; }));
  await submitPengajuan(w.deps, s, r.id, `idem-sub-${inv}-0001`, true);
  return r.id;
}
const etagOfInbox = async (id: string): Promise<string> => (await j(await inboxGet(get('/api/approvals/inbox', budi)))).items.find((i: { id: string }) => i.id === id).etag;

beforeEach(async () => {
  w = authWorld(); __setAuthDepsForTests(w.deps);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
  budi = await loginAs(P.budi, '081200000001');
  citra = await loginAs(P.citra, '081200000002');
});

describe('API approvals', () => {
  it('tanpa sesi => 401; PIC => 403; POST tanpa Origin => 403', async () => {
    const id = await submitted(1_000_000, 'R1');
    expect((await inboxGet(get('/api/approvals/inbox'))).status).toBe(401);
    expect((await inboxGet(get('/api/approvals/inbox', citra))).status).toBe(403);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: 'x'.repeat(22) }, { idem: 'idem-route-0001' }))).status).toBe(401);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: 'x'.repeat(22) }, { cookie: budi, idem: 'idem-route-0002', origin: null }))).status).toBe(403);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: 'x'.repeat(22) }, { cookie: citra, idem: 'idem-route-0003' }))).status).toBe(403);
    expect(status(id)).toBe('Submitted');
  });
  it('body ketat: kunci asing (status/level/nominal/approver) => 400; etag hilang/format salah => 400; tanpa Idempotency-Key => 400', async () => {
    const id = await submitted(1_000_000, 'R2');
    const e = await etagOfInbox(id);
    for (const extra of [{ status: 'Paid' }, { level: 5 }, { nominal: 1 }, { approver: 'x@y.id' }, { createdBy: 'budi@x.id' }]) {
      expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: e, ...extra }, { cookie: budi, idem: 'idem-route-1001' }))).status).toBe(400);
    }
    expect((await approvePost(post(`/api/approvals/${id}/approve`, {}, { cookie: budi, idem: 'idem-route-1002' }))).status).toBe(400);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: 'pendek' }, { cookie: budi, idem: 'idem-route-1003' }))).status).toBe(400);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi }))).status).toBe(400);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'x' }))).status).toBe(400);
    expect((await rejectPost(post(`/api/approvals/${id}/reject`, { etag: e }, { cookie: budi, idem: 'idem-route-1004' }))).status).toBe(400);
    expect((await approvePost(post('/api/approvals/BUKAN-ID/approve', { etag: e }, { cookie: budi, idem: 'idem-route-1005' }))).status).toBe(400);
    expect(status(id)).toBe('Submitted');
  });
  it('alur penuh < 5 jt: inbox -> approve 200 -> hilang dari inbox; respons tidak memuat data asing', async () => {
    const id = await submitted(1_000_000, 'R3');
    const inbox = await j(await inboxGet(get('/api/approvals/inbox', budi)));
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({ id, butuhStepUp: false, terkunci: null });
    const r = await approvePost(post(`/api/approvals/${id}/approve`, { etag: inbox.items[0].etag, notes: 'oke' }, { cookie: budi, idem: 'idem-route-2001' }));
    expect(r.status).toBe(200);
    expect((await j(r)).hasil).toMatchObject({ id, status: 'Manager Approved' });
    expect((await j(await inboxGet(get('/api/approvals/inbox', budi)))).items).toHaveLength(0);
  });
  it('>= 5 jt: 403 dengan penanda stepUp -> POST /api/auth/step-up (password benar) -> approve 200', async () => {
    const id = await submitted(7_000_000, 'R4');
    const e = await etagOfInbox(id);
    const r1 = await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'idem-route-3001' }));
    expect(r1.status).toBe(403);
    expect((await j(r1)).error.fields).toMatchObject({ stepUp: 'required' });
    expect(status(id)).toBe('Submitted');
    expect((await stepUp(post('/api/auth/step-up', { password: 'salah-salah' }, { cookie: budi }))).status).toBe(401);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'idem-route-3002' }))).status).toBe(403);
    expect((await stepUp(post('/api/auth/step-up', { password: PW }, { cookie: budi }))).status).toBe(200);
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'idem-route-3003' }))).status).toBe(200);
    expect(status(id)).toBe('Manager Approved');
  });
  it('etag usang => 409; status sudah berubah => 409; ID tak ada => 404', async () => {
    const id = await submitted(1_000_000, 'R5');
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: 'A'.repeat(22) }, { cookie: budi, idem: 'idem-route-4001' }))).status).toBe(409);
    expect((await approvePost(post('/api/approvals/NTR-99999/approve', { etag: 'A'.repeat(22) }, { cookie: budi, idem: 'idem-route-4002' }))).status).toBe(404);
    const e = await etagOfInbox(id);
    expect((await rejectPost(post(`/api/approvals/${id}/reject`, { etag: e, alasan: 'Lampiran buram' }, { cookie: budi, idem: 'idem-route-4003' }))).status).toBe(200);
    expect(status(id)).toBe('Revision Needed');
    expect((await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'idem-route-4004' }))).status).toBe(409);
  });
  it('replay Idempotency-Key yang sama => respons identik tanpa efek ganda', async () => {
    const id = await submitted(1_000_000, 'R6');
    const e = await etagOfInbox(id);
    const a = await j(await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'idem-route-5001' })));
    const b = await j(await approvePost(post(`/api/approvals/${id}/approve`, { etag: e }, { cookie: budi, idem: 'idem-route-5001' })));
    expect(b.hasil).toEqual(a.hasil);
    expect(w.store.rowsOf(TRX_APPROVAL).filter((r) => Number(r[colIndex(TRX_APPROVAL, 'Level')]) === 2)).toHaveLength(1);
  });
});
