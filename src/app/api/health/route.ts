import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { AppError, errorBody, newRequestId } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { runHealth } from '@/server/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenOk(got: string | null, expected: string): boolean {
  if (!got) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    if (!tokenOk(req.headers.get('x-health-token'), env().HEALTH_TOKEN)) {
      throw new AppError('UNAUTHENTICATED', 'Token health tidak valid.');
    }
    const result = await runHealth();
    return Response.json({ requestId, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const { status, body, headers } = errorBody(e, requestId);
    if (status >= 500) logger.error('health gagal', { requestId, err: e });
    return Response.json(body, { status, headers: { ...headers, 'cache-control': 'no-store' } });
  }
}
