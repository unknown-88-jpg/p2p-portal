import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'trial', APP_BASE_URL: 'http://localhost:3000', SHEET_ID: 'sheet-id-1234567', DRIVE_ROOT_ID: 'drive-root', GOOGLE_SA_JSON: 'x'.repeat(60),
    JWT_SECRET: 'j'.repeat(40), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't'.repeat(20), CRON_SECRET: 'c'.repeat(20), HEALTH_TOKEN: 'h'.repeat(20),
  });
});

// next/server after(): di luar request scope tidak tersedia -> ganti dengan antrean yang bisa ditahan (gate).
const afterCtl = vi.hoisted(() => ({ pending: [] as Promise<unknown>[], gate: Promise.resolve() as Promise<void> }));
vi.mock('next/server', async (orig) => {
  const m = await orig<typeof import('next/server')>();
  return { ...m, after: (fn: () => unknown) => { afterCtl.pending.push(afterCtl.gate.then(() => fn())); } };
});

import { POST as forgot } from '@/app/api/auth/forgot/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as setPassword } from '@/app/api/auth/set-password/route';
import { POST as stepUp } from '@/app/api/auth/step-up/route';
import { GET as home } from '@/app/api/home/route';
import { GET as me } from '@/app/api/me/route';
import { issueSetPasswordLink } from '@/server/auth';
import { __setAuthDepsForTests } from '@/server/runtime';
import { __setScryptCostForTests } from '@/infra/password';
import { P, authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const req = (path: string, o: { method?: string; body?: unknown; origin?: string | null; cookie?: string; raw?: string; headers?: Record<string, string> } = {}): Request => {
  const h: Record<string, string> = { 'x-real-ip': '10.1.1.1', ...(o.headers ?? {}) };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  const body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  if (body !== undefined) h['content-type'] = 'application/json';
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? 'POST', headers: h, body });
};
const cookieOf = (r: Response): string => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

let w: ReturnType<typeof authWorld>;
beforeEach(() => { w = authWorld(); __setAuthDepsForTests(w.deps); afterCtl.pending.length = 0; afterCtl.gate = Promise.resolve(); });

async function provision(phone = P.budi, pw = 'Kopi-Manis-47'): Promise<void> {
  const { link } = await issueSetPasswordLink(w.deps, phone);
  const r = await setPassword(req('/api/auth/set-password', { body: { token: tokenOf(link), password: pw } }));
  expect(r.status).toBe(200);
}

describe('routes: alur login', () => {
  it('login -> cookie httpOnly SameSite=Lax -> /api/me & /api/home -> logout membersihkan cookie & mencabut sesi', async () => {
    await provision();
    const r = await login(req('/api/auth/login', { body: { phone: '0812-0000-0001', password: 'Kopi-Manis-47' } }));
    expect(r.status).toBe(200);
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toMatch(/^p2p_session=/); expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/SameSite=Lax/); expect(sc).toMatch(/Path=\//); expect(sc).toMatch(/Max-Age=28800/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const j = await r.json() as { user: { nama: string }; capabilities: string[]; requestId: string };
    expect(j.user.nama).toBe('Budi'); expect(j.capabilities).toContain('approve.manager'); expect(j.requestId).toBeTruthy();
    expect(JSON.stringify(j)).not.toMatch(/hash|salt|password/i);
    const ck = cookieOf(r);
    const m = await me(req('/api/me', { method: 'GET', cookie: ck, origin: null }));
    expect(m.status).toBe(200);
    expect((await m.json() as { stepUp: boolean }).stepUp).toBe(false);
    const h = await home(req('/api/home', { method: 'GET', cookie: ck, origin: null }));
    expect((await h.json() as { bisa: Record<string, boolean> }).bisa).toEqual({ ajukan: false, approve: true, finance: false });
    const lo = await logout(req('/api/auth/logout', { cookie: ck }));
    expect(lo.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await me(req('/api/me', { method: 'GET', cookie: ck, origin: null }))).status).toBe(401);
  });

  it('step-up via route: salah 401, benar 200 dan /api/me menunjukkan stepUp=true', async () => {
    await provision();
    const ck = cookieOf(await login(req('/api/auth/login', { body: { phone: P.budi, password: 'Kopi-Manis-47' } })));
    expect((await stepUp(req('/api/auth/step-up', { cookie: ck, body: { password: 'salah-salah-1' } }))).status).toBe(401);
    const ok = await stepUp(req('/api/auth/step-up', { cookie: ck, body: { password: 'Kopi-Manis-47' } }));
    expect(ok.status).toBe(200);
    expect((await (await me(req('/api/me', { method: 'GET', cookie: ck, origin: null }))).json() as { stepUp: boolean }).stepUp).toBe(true);
    expect((await stepUp(req('/api/auth/step-up', { body: { password: 'x' } }))).status).toBe(401); // tanpa sesi
  });

  it('login salah: 401 generik; terkunci: 429 + Retry-After', async () => {
    await provision();
    for (let i = 0; i < 5; i++) {
      const r = await login(req('/api/auth/login', { body: { phone: P.budi, password: 'salah-salah-1' } }));
      expect(r.status).toBe(401);
    }
    const r = await login(req('/api/auth/login', { body: { phone: P.budi, password: 'Kopi-Manis-47' } }));
    expect(r.status).toBe(429); expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('forgot: balasan identik untuk nomor dikenal & tidak dikenal', async () => {
    const a = await forgot(req('/api/auth/forgot', { body: { phone: P.budi } }));
    const b = await forgot(req('/api/auth/forgot', { body: { phone: '089999999999' } }));
    const strip = async (r: Response) => { const j = await r.json() as Record<string, unknown>; delete j.requestId; return [r.status, j]; };
    expect(await strip(a)).toEqual(await strip(b));
    await Promise.all(afterCtl.pending);
    expect(w.sender.sent).toHaveLength(1);
  });

  it('forgot: respons terkirim SEBELUM kerja nomor-terdaftar (anti-enumerasi lewat timing)', async () => {
    let release!: () => void;
    afterCtl.gate = new Promise<void>((r) => { release = r; });
    const a = await forgot(req('/api/auth/forgot', { body: { phone: P.budi } }));
    expect(a.status).toBe(200);
    expect(w.sender.sent).toHaveLength(0); // belum ada token/link/audit saat respons sudah ada
    release(); await Promise.all(afterCtl.pending);
    expect(w.sender.sent).toHaveLength(1);
  });

  it('forgot: nomor tak dikenal tidak mengirim apa pun meski kerja susulan selesai', async () => {
    await forgot(req('/api/auth/forgot', { body: { phone: '089999999999' } }));
    await Promise.all(afterCtl.pending);
    expect(w.sender.sent).toHaveLength(0);
  });
});

describe('routes: perlindungan', () => {
  it('CSRF: origin asing ditolak; tanpa Origin hanya lolos bila Sec-Fetch-Site same-origin', async () => {
    const body = { phone: P.budi, password: 'x' };
    expect((await login(req('/api/auth/login', { body, origin: 'https://evil.example' }))).status).toBe(403);
    expect((await login(req('/api/auth/login', { body, origin: null }))).status).toBe(403);
    expect((await login(req('/api/auth/login', { body, origin: null, headers: { 'sec-fetch-site': 'same-origin' } }))).status).toBe(401);
    expect((await login(req('/api/auth/login', { body, origin: null, headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
  });
  it('validasi: JSON rusak, field hilang, body terlalu besar -> 400; metode salah ditolak', async () => {
    expect((await login(req('/api/auth/login', { raw: '{bukan json' }))).status).toBe(400);
    expect((await login(req('/api/auth/login', { body: { phone: P.budi } }))).status).toBe(400);
    expect((await login(req('/api/auth/login', { raw: JSON.stringify({ phone: P.budi, password: 'a'.repeat(9000) }) }))).status).toBe(400);
    expect((await login(req('/api/auth/login', { method: 'GET', origin: null }))).status).toBe(400);
  });
  it('endpoint wajib-login menolak tanpa/dengan cookie palsu', async () => {
    expect((await me(req('/api/me', { method: 'GET', origin: null }))).status).toBe(401);
    expect((await me(req('/api/me', { method: 'GET', origin: null, cookie: `p2p_session=${'a'.repeat(43)}` }))).status).toBe(401);
  });
  it('Redis mati -> 503 UPSTREAM_BUSY (bukan 500, bukan lolos)', async () => {
    w.redis.down = true;
    const r = await login(req('/api/auth/login', { body: { phone: P.budi, password: 'Kopi-Manis-47' } }));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/redis down/i);
  });
  it('set-password via route: kebijakan -> 400 dengan pesan; token dipakai ulang -> 400', async () => {
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    const t = tokenOf(link);
    const bad = await setPassword(req('/api/auth/set-password', { body: { token: t, password: 'password123' } }));
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: { message: string } }).error.message).toMatch(/umum/);
    expect((await setPassword(req('/api/auth/set-password', { body: { token: t, password: 'Kopi-Manis-47' } }))).status).toBe(200);
    expect((await setPassword(req('/api/auth/set-password', { body: { token: t, password: 'Kopi-Manis-48' } }))).status).toBe(400);
  });
});
