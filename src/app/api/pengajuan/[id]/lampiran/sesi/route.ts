import { env } from '@/lib/env';
import { sesiUnggahSchema } from '@/server/lampiran-schema';
import { mulaiUnggah } from '@/server/lampiran';
import { authDeps } from '@/server/runtime';
import { route } from '../../../../_lib/handler';
import { idTrxFromPath } from '../../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minta sesi upload langsung browser->Drive. Body: { namaAsli, size, mimeType }. Respons memuat `sessionUrl` (RAHASIA; jangan di-log). */
export const POST = route({ method: 'POST', session: 'required', schema: sesiUnggahSchema }, async ({ req, body, session }) => ({
  status: 201, body: { hasil: await mulaiUnggah(authDeps(), session!, idTrxFromPath(req, 2), body, new URL(env().APP_BASE_URL).origin) },
}));
