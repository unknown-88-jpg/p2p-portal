import { after } from 'next/server';
import { bacaPayload, prosesPesan, signatureWebhookValid } from '@/server/wa-approval';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { authDeps } from '@/server/runtime';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;
const json = (status: number, body: unknown): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Webhook gateway Lixus (S6). RAW body dibaca SEKALI -> HMAC-SHA256 hex dibandingkan timingSafeEqual dengan `X-Gateway-Signature`
 * -> baru JSON.parse. Secret/header hilang atau salah = 401 (fail-closed). Tanpa CSRF/Origin (server-ke-server).
 * Gateway tidak retry & tidak memeriksa status: kerja berat jalan SETELAH respons (after()); setiap perintah dibalas ke pengirim.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json(413, { ok: false });
  if (!signatureWebhookValid(raw, req.headers.get('x-gateway-signature'), env().WA_WEBHOOK_SECRET)) {
    logger.warn('wa_webhook_unauthorized', { hasSecret: !!env().WA_WEBHOOK_SECRET, hasHeader: !!req.headers.get('x-gateway-signature') });
    return json(401, { ok: false, reason: 'unauthorized' });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json(400, { ok: false, reason: 'bukan JSON' }); }
  const r = bacaPayload(payload);
  if ('skip' in r) { logger.info('wa_webhook_skip', { alasan: r.skip }); return json(200, { ok: true, skip: r.skip }); }
  after(() => prosesPesan(authDeps(), r.pesan));
  return json(200, { ok: true });
}
