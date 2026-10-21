import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'trial', APP_BASE_URL: 'http://localhost:3000', SHEET_ID: 'sheet-id-1234567', DRIVE_ROOT_ID: 'drive-root', GOOGLE_SA_JSON: 'x'.repeat(60),
    JWT_SECRET: 'j'.repeat(40), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't'.repeat(20), CRON_SECRET: 'c'.repeat(20), HEALTH_TOKEN: 'h'.repeat(20),
    WA_WEBHOOK_SECRET: 'webhook-secret-0123456789',
  });
});
const afterCtl = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { afterCtl.pending.push(Promise.resolve().then(() => fn())); } }));

import { POST as webhook } from '@/app/api/webhooks/wa/route';
import { GET as digest } from '@/app/api/cron/digest/route';
import { POST as approvePost } from '@/app/api/approvals/[id]/approve/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as setPassword } from '@/app/api/auth/set-password/route';
import { signWebhook } from '@/infra/wa-signature';
import { __setScryptCostForTests } from '@/infra/password';
import { MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { issueSetPasswordLink } from '@/server/auth';
import { etagOf } from '@/server/approval';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { __setAuthDepsForTests } from '@/server/runtime';
import { kirimDigestManager } from '@/server/wa-digest';
import { P, authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const SECRET = 'webhook-secret-0123456789';
const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
let w: ReturnType<typeof authWorld>;
const drain = async (): Promise<void> => { while (afterCtl.pending.length) await afterCtl.pending.shift(); };
const hook = (payload: unknown, o: { sig?: string | null; secret?: string; raw?: string } = {}): Request => {
  const raw = o.raw ?? JSON.stringify(payload);
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const sig = o.sig === undefined ? signWebhook(raw, o.secret ?? SECRET) : o.sig;
  if (sig !== null) h['x-gateway-signature'] = sig;
  return new Request(`${ORIGIN}/api/webhooks/wa`, { method: 'POST', headers: h, body: raw }); // TANPA Origin: server-ke-server
};
let mid = 0;
const masuk = (nomor: string, teks: string, ts = Math.floor(w.clock.now() / 1000)) => ({ event: 'message.received', sessionId: 's1', message: { key: { id: `WH${++mid}-${nomor}`, remoteJid: `${nomor}@s.whatsapp.net`, fromMe: false }, messageTimestamp: ts, message: { conversation: teks } } });
async function submitted(amount: number, inv: string): Promise<string> {
  const s = { phone: P.citra, email: 'citra@x.id', nama: 'Citra', jabatan: 'PIC', created: 0, ep: 0, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] };
  const r = await createDraft(w.deps, s, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Tes', vendorKode: 'V3', noInvoice: inv, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === r.id) x[C('FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return x; }));
  await submitPengajuan(w.deps, s, r.id, `idem-sub-${inv}-0001`, true);
  return r.id;
}
const status = (id: string) => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)![C('STATUS')];

beforeEach(() => {
  w = authWorld(); __setAuthDepsForTests(w.deps); afterCtl.pending.length = 0;
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('POST /api/webhooks/wa', () => {
  it('tanda tangan salah / hilang / secret lain = 401 dan TIDAK ada kerja yang dijadwalkan', async () => {
    const id = await submitted(1_000_000, 'INV-A1');
    await kirimDigestManager(w.deps, { sod: true, force: true });
    const k = await w.redis.get(`wa:d:${P.budi}:${id}`);
    const body = masuk(P.budi, `SETUJU ${k}`);
    for (const r of [hook(body, { sig: null }), hook(body, { sig: 'a'.repeat(64) }), hook(body, { secret: 'secret-yang-lain-0123456789' }), hook(body, { sig: '' })]) expect((await webhook(r)).status).toBe(401);
    expect(afterCtl.pending).toHaveLength(0); expect(status(id)).toBe('Submitted');
  });
  it('body diubah setelah ditandatangani = 401 (HMAC atas raw body)', async () => {
    const raw = JSON.stringify(masuk(P.budi, 'SETUJU 1234'));
    expect((await webhook(hook(null, { raw: raw.replace('1234', '1235'), sig: signWebhook(raw, SECRET) }))).status).toBe(401);
  });
  it('valid: 200 cepat, lalu SETUJU diproses SETELAH respons; replay signature+body yang sama tidak menggandakan aksi', async () => {
    const id = await submitted(1_000_000, 'INV-A2');
    await kirimDigestManager(w.deps, { sod: true, force: true });
    const k = await w.redis.get(`wa:d:${P.budi}:${id}`);
    w.wa.sent.length = 0;
    const body = masuk(P.budi, `SETUJU ${k}`);
    const r = await webhook(hook(body));
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true });
    expect(status(id)).toBe('Submitted'); // belum: kerja jalan setelah respons
    await drain();
    expect(status(id)).toBe('Manager Approved');
    const n = w.wa.sent.length;
    expect((await webhook(hook(body))).status).toBe(200); await drain(); // diputar ulang
    expect(w.wa.sent).toHaveLength(n);
    expect(w.store.rowsOf(TRX_APPROVAL).filter((a) => a[colIndex(TRX_APPROVAL, 'Level')] === 2)).toHaveLength(1);
  });
  it('event lain, pesan sendiri, @lid, tanpa teks, bukan JSON: 200 (atau 400) tanpa kerja', async () => {
    const lid = masuk(P.budi, 'SETUJU 1234'); lid.message.key.remoteJid = '999999999999999@lid';
    const sendiri = masuk(P.budi, 'x'); sendiri.message.key.fromMe = true;
    const kosong = masuk(P.budi, ''); (kosong.message.message as { conversation: string }).conversation = '';
    for (const b of [{ event: 'session.status' }, lid, sendiri, kosong]) expect((await webhook(hook(b))).status).toBe(200);
    expect(afterCtl.pending).toHaveLength(0);
    const raw = 'bukan json';
    expect((await webhook(hook(null, { raw }))).status).toBe(400);
  });
  it('terlalu besar = 413 (sebelum verifikasi mahal)', async () => {
    expect((await webhook(hook(null, { raw: 'x'.repeat(70_000) }))).status).toBe(413);
  });
});

describe('GET /api/cron/digest', () => {
  const get = (auth?: string): Request => new Request(`${ORIGIN}/api/cron/digest`, { method: 'GET', headers: auth ? { authorization: auth } : {} });
  it('tanpa/ salah Bearer = 401; Bearer benar = 200 dan manager menerima ringkasan', async () => {
    await submitted(1_000_000, 'INV-A3');
    expect((await digest(get())).status).toBe(401);
    expect((await digest(get('Bearer salah-salah-salah-salah'))).status).toBe(401);
    expect(w.wa.sent).toHaveLength(0);
    const r = await digest(get(`Bearer ${'c'.repeat(20)}`));
    expect(r.status).toBe(200);
    expect(w.wa.sent.some((m) => m.to === P.budi && m.text.includes('Ringkasan Approval'))).toBe(true);
  });
});

describe('approve via web -> notif PIC setelah respons', () => {
  async function cookieBudi(): Promise<string> {
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    await setPassword(new Request(`${ORIGIN}/api/auth/set-password`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenOf(link), password: 'Kopi-Manis-47' }) }));
    return ((await login(new Request(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '10.1.1.1' }, body: JSON.stringify({ phone: '081200000001', password: 'Kopi-Manis-47' }) }))).headers.get('set-cookie') ?? '').split(';')[0]!;
  }
  const doApprove = async (ck: string, id: string, idem: string): Promise<Response> => {
    const etag = etagOf(w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!);
    return approvePost(new Request(`${ORIGIN}/api/approvals/${id}/approve`, { method: 'POST', headers: { origin: ORIGIN, cookie: ck, 'content-type': 'application/json', 'idempotency-key': idem }, body: JSON.stringify({ etag }) }));
  };
  it('PIC dikabari lewat WA SETELAH respons (bukan sebelum)', async () => {
    const ck = await cookieBudi();
    const id = await submitted(1_000_000, 'INV-A4');
    expect((await doApprove(ck, id, 'idem-web-route-0001')).status).toBe(200);
    expect(w.wa.sent.filter((m) => m.to === P.citra)).toHaveLength(0);
    await drain();
    expect(w.wa.sent.filter((m) => m.to === P.citra && m.text.includes('disetujui Manager'))).toHaveLength(1);
  });
  it('gagal kirim WA tidak menggagalkan approve (I15)', async () => {
    const ck = await cookieBudi();
    const id = await submitted(1_000_000, 'INV-A5');
    w.wa.failNext = true;
    expect((await doApprove(ck, id, 'idem-web-route-0002')).status).toBe(200);
    await expect(drain()).resolves.toBeUndefined();
    expect(status(id)).toBe('Manager Approved');
  });
});
