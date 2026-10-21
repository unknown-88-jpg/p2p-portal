import { createDraft, listMine } from '@/server/pengajuan';
import { pengajuanSchema } from '@/server/pengajuan-schema';
import { authDeps } from '@/server/runtime';
import { idempotencyKeyOf } from '../_lib/params';
import { route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Daftar pengajuan milik pengguna (terbaru dulu). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({ body: { pengajuan: await listMine(authDeps(), session!) } }));

/** Buat draft. Semua angka dihitung server; body ber-kunci asing ditolak. `Idempotency-Key` opsional (cegah draft ganda saat klik ulang/retry). */
export const POST = route({ method: 'POST', session: 'required', schema: pengajuanSchema }, async ({ req, body, session }) => ({
  status: 201, body: { hasil: await createDraft(authDeps(), session!, body, idempotencyKeyOf(req)) },
}));
