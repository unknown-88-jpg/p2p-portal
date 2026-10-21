import { createHmac, timingSafeEqual } from 'node:crypto';

/** S6: `X-Gateway-Signature` = hex HMAC-SHA256 atas RAW body. Panjang disamakan dulu (timingSafeEqual melempar bila beda). Header/secret kosong = false (fail-closed). */
export function signatureWebhookValid(raw: string, header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header.trim().toLowerCase());
  return got.length === want.length && timingSafeEqual(got, want);
}
export const signWebhook = (raw: string, secret: string): string => createHmac('sha256', secret).update(raw).digest('hex');
