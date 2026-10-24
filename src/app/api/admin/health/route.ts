import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { cekKoneksi } from '@/server/admin';
import { runHealth } from '@/server/health';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-C: kesehatan koneksi (Redis/Sheets/Drive/WA), cron terakhir, validasi header semua tab. System Admin. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => {
  const e = env();
  const k = await cekKoneksi(authDeps(), session!, { waTerkonfigurasi: !!(e.WA_GATEWAY_URL && e.WA_API_KEY) });
  const header = await runHealth().then((h) => ({ ok: true as const, writable: h.writable, tabs: h.headers }), (x: unknown) => ({ ok: false as const, pesan: x instanceof AppError ? x.message : 'Gagal membaca header.' }));
  return { body: { ...k, header, appEnv: e.APP_ENV } };
});
