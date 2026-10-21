import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/** Bearer CRON_SECRET (Vercel Cron & GitHub Actions mengirim header yang sama). Panjang disamakan dulu. */
export function bearerOk(req: Request): boolean {
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${env().CRON_SECRET}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
