import { after } from 'next/server';
import { approve } from '@/server/approval';
import { approveSchema } from '@/server/approval-schema';
import { authDeps } from '@/server/runtime';
import { notifPIC } from '@/server/wa-notif';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Setujui satu dokumen. Idempotency-Key & etag (versi yang dilihat) wajib; nominal >= Rp 5 jt wajib step-up password. Notif WA ke PIC jalan SETELAH respons (I15). */
export const POST = route({ method: 'POST', session: 'required', schema: approveSchema }, async ({ req, body, session, token }) => {
  const hasil = await approve(authDeps(), session!, token!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req));
  after(() => notifPIC(authDeps(), { idTrx: hasil.id, jenis: 'disetujui', catatan: body.notes ?? '' }));
  return { body: { hasil } };
});
