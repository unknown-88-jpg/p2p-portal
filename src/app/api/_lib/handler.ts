import type { z } from 'zod';
import { capabilitiesOf, type Capability } from '@/domain/capabilities';
import { env } from '@/lib/env';
import { AppError, errorBody, newRequestId } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { SessionData } from '@/server/auth';
import { getSession } from '@/server/auth';
import { authDeps } from '@/server/runtime';

export const MAX_BODY_BYTES = 8 * 1024;

export function sessionCookieName(): string { return env().APP_ENV === 'production' ? '__Host-p2p_session' : 'p2p_session'; }
const secureCookie = (): boolean => env().APP_ENV === 'production' || env().APP_BASE_URL.startsWith('https://');

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); }
      catch { return undefined; } // cookie rusak (%) = tak ada sesi (401), bukan 500
    }
  }
  return undefined;
}
export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${sessionCookieName()}=${encodeURIComponent(token)}; HttpOnly; ${secureCookie() ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}
export const clearCookie = (): string => sessionCookie('', 0);

/** IP klien dari header yang diisi platform (Vercel mengisi x-real-ip / x-forwarded-for; klien tidak bisa memalsukannya di sisi Vercel). */
export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** CSRF: mutasi hanya dari origin aplikasi sendiri. Origin ada & cocok; bila tidak ada, wajib same-origin menurut Fetch Metadata. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  const mine = new URL(env().APP_BASE_URL).origin;
  if (origin) { if (origin !== mine) throw new AppError('FORBIDDEN', 'Permintaan lintas-origin ditolak.'); return; }
  if (req.headers.get('sec-fetch-site') !== 'same-origin') throw new AppError('FORBIDDEN', 'Permintaan lintas-origin ditolak.');
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) throw new AppError('VALIDATION', 'Permintaan terlalu besar.');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError('VALIDATION', 'Permintaan terlalu besar.');
  try { return JSON.parse(text); } catch { throw new AppError('VALIDATION', 'Body bukan JSON yang valid.'); }
}

export interface Ctx<B> { req: Request; requestId: string; ip: string; body: B; session: SessionData | null; token: string | undefined }
export interface Reply { status?: number; body?: unknown; headers?: Record<string, string> | [string, string][]; /** Respons mentah (stream file). Header keamanan dari `route` tetap ditambahkan bila belum ada. */ raw?: Response }

/**
 * Pembungkus semua route: requestId, CSRF (mutasi), body JSON ber-batas + zod, sesi (opsional/wajib), format error seragam, no-store.
 * `session: 'required'` -> 401 bila tidak login. `session: 'optional'` -> boleh kosong (mis. logout).
 */
export function route<S extends z.ZodTypeAny | undefined = undefined>(
  opts: { method: 'GET' | 'POST'; session: 'none' | 'optional' | 'required'; schema?: S },
  fn: (c: Ctx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<Reply>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const requestId = newRequestId();
    const headers = new Headers({ 'cache-control': 'no-store' });
    try {
      if (req.method !== opts.method) throw new AppError('VALIDATION', 'Metode tidak didukung.');
      if (opts.method !== 'GET') assertSameOrigin(req);
      let body: unknown;
      if (opts.schema) {
        const r = opts.schema.safeParse(await readJson(req));
        if (!r.success) {
          const fields: Record<string, string> = {};
          for (const i of r.error.issues) fields[i.path.join('.') || '_'] = 'tidak valid';
          throw new AppError('VALIDATION', 'Data yang dikirim tidak valid.', fields);
        }
        body = r.data;
      }
      const token = readCookie(req, sessionCookieName());
      let session: SessionData | null = null;
      if (opts.session !== 'none') {
        session = await getSession(authDeps(), token);
        if (!session && opts.session === 'required') throw new AppError('UNAUTHENTICATED', 'Silakan login terlebih dahulu.');
      }
      const out = await fn({ req, requestId, ip: clientIp(req), body: body as never, session, token });
      const h = out.headers ?? {};
      for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) headers.append(k, v);
      if (out.raw) {
        const rh = new Headers(out.raw.headers);
        rh.set('x-request-id', requestId);
        return new Response(out.raw.body, { status: out.raw.status, headers: rh });
      }
      return Response.json({ requestId, ...(out.body as object | undefined) }, { status: out.status ?? 200, headers });
    } catch (e) {
      const { status, body, headers: eh } = errorBody(e, requestId);
      if (status === 503) logger.warn('route_unavailable', { requestId, code: (e as { code?: string }).code }); // sementara (UPSTREAM_BUSY/READ_ONLY): bukan bug
      else if (status >= 500) logger.error('route_error', { requestId, err: e });
      for (const [k, v] of Object.entries(eh)) headers.set(k, v);
      return Response.json(body, { status, headers });
    }
  };
}

export function meDto(s: SessionData): { user: { nama: string; jabatan: string; email: string }; roles: SessionData['roles']; capabilities: Capability[] } {
  return { user: { nama: s.nama, jabatan: s.jabatan, email: s.email }, roles: s.roles, capabilities: capabilitiesOf(s.roles) };
}
