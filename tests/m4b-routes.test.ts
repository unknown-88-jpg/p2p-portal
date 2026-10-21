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
import { GET as cron } from '@/app/api/cron/lampiran-yatim/route';
import { POST as create } from '@/app/api/pengajuan/route';
import { GET as baca } from '@/app/api/pengajuan/[id]/lampiran/route';
import { POST as konfirmasi } from '@/app/api/pengajuan/[id]/lampiran/konfirmasi/route';
import { POST as sesi } from '@/app/api/pengajuan/[id]/lampiran/sesi/route';
import { POST as submit } from '@/app/api/pengajuan/[id]/submit/route';
import { __setScryptCostForTests } from '@/infra/password';
import { MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN } from '@/repo/schema';
import { issueSetPasswordLink } from '@/server/auth';
import { __setAuthDepsForTests } from '@/server/runtime';
import { P, authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const get = (path: string, h: Record<string, string> = {}): Request => new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { 'x-real-ip': '10.5.5.5', ...h } });
const post = (path: string, body: unknown, o: { cookie?: string; origin?: string | null; idem?: string } = {}): Request => {
  const h: Record<string, string> = { 'x-real-ip': '10.5.5.5', 'content-type': 'application/json' };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  if (o.idem) h['idempotency-key'] = o.idem;
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
};
const j = async (r: Response) => (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PDF = (() => { const b = new Uint8Array(200).fill(0x20); b.set(new TextEncoder().encode('%PDF-1.4\n')); return b; })();

let w: ReturnType<typeof authWorld>;
let ck: string;
let id: string;
async function loginAs(plain: string, raw: string): Promise<string> {
  const { link } = await issueSetPasswordLink(w.deps, plain);
  await setPassword(post('/api/auth/set-password', { token: tokenOf(link), password: 'Kopi-Manis-47' }));
  return ((await login(post('/api/auth/login', { phone: raw, password: 'Kopi-Manis-47' }))).headers.get('set-cookie') ?? '').split(';')[0]!;
}
beforeEach(async () => {
  w = authWorld(); __setAuthDepsForTests(w.deps);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
  ck = await loginAs(P.citra, '081200000002');
  id = (await j(await create(post('/api/pengajuan', { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Tes', vendorKode: 'V3', noInvoice: 'INV-1', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN' }, { cookie: ck })))).hasil.id;
});

describe('API lampiran', () => {
  it('alur penuh: sesi -> PUT (simulasi) -> konfirmasi -> baca -> submit', async () => {
    const a = await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, { namaAsli: 'Faktur.pdf', size: PDF.length, mimeType: 'application/pdf' }, { cookie: ck }));
    expect(a.status).toBe(201);
    const { uploadId, sessionUrl } = (await j(a)).hasil;
    const fileId = w.drive.upload(sessionUrl, PDF);
    const b = await konfirmasi(post(`/api/pengajuan/${id}/lampiran/konfirmasi`, { uploadId, fileId }, { cookie: ck }));
    expect(b.status).toBe(200);
    const r = await baca(get(`/api/pengajuan/${id}/lampiran`, { cookie: ck }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
    const s = await submit(post(`/api/pengajuan/${id}/submit`, {}, { cookie: ck, idem: 'idem-route-0001' }));
    expect(s.status).toBe(200);
  });
  it('tanpa sesi => 401; tanpa Origin => 403; kunci asing / tipe salah => 400', async () => {
    const body = { namaAsli: 'a.pdf', size: 10, mimeType: 'application/pdf' };
    expect((await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, body))).status).toBe(401);
    expect((await baca(get(`/api/pengajuan/${id}/lampiran`))).status).toBe(401);
    expect((await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, body, { cookie: ck, origin: null }))).status).toBe(403);
    expect((await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, { ...body, parents: ['x'] }, { cookie: ck }))).status).toBe(400);
    expect((await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, { ...body, size: '10' }, { cookie: ck }))).status).toBe(400);
    expect((await konfirmasi(post(`/api/pengajuan/${id}/lampiran/konfirmasi`, { uploadId: 'x'.repeat(30) }, { cookie: ck }))).status).toBe(400);
  });
  it('tipe terlarang => 422; ID format salah => 400', async () => {
    expect((await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, { namaAsli: 'a.exe', size: 10, mimeType: 'application/x-msdownload' }, { cookie: ck }))).status).toBe(422);
    expect((await sesi(post('/api/pengajuan/BUKAN-ID/lampiran/sesi', { namaAsli: 'a.pdf', size: 10, mimeType: 'application/pdf' }, { cookie: ck }))).status).toBe(400);
  });
  it('origin sesi Drive = APP_BASE_URL (bukan header klien)', async () => {
    const r = await sesi(post(`/api/pengajuan/${id}/lampiran/sesi`, { namaAsli: 'a.pdf', size: 10, mimeType: 'application/pdf' }, { cookie: ck }));
    expect(w.drive.sessions.get((await j(r)).hasil.sessionUrl)!.origin).toBe(ORIGIN);
  });
  it('sessionUrl tidak muncul di log (redaksi)', async () => {
    const { redactString } = await import('@/lib/redact');
    expect(redactString('gagal https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=AEnB2Ur-abc')).not.toContain('upload_id');
  });
});

describe('cron file yatim', () => {
  it('tanpa/ salah Bearer => 401; benar => 200', async () => {
    expect((await cron(get('/api/cron/lampiran-yatim'))).status).toBe(401);
    expect((await cron(get('/api/cron/lampiran-yatim', { authorization: 'Bearer salah' }))).status).toBe(401);
    expect((await cron(get('/api/cron/lampiran-yatim', { authorization: `Bearer ${'c'.repeat(20)}` }))).status).toBe(200);
  });
});
