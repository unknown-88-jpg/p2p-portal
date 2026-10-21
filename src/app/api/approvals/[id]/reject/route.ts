import { after } from 'next/server';
import { reject } from '@/server/approval';
import { rejectSchema } from '@/server/approval-schema';
import { authDeps } from '@/server/runtime';
import { notifPIC } from '@/server/wa-notif';
import { route } from '../../../_lib/handler';
import { idempotencyKeyOf, idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Kembalikan ke PIC untuk revisi (status Revision Needed). Alasan wajib. Notif WA ke PIC jalan SETELAH respons (I15). */
export const POST = route({ method: 'POST', session: 'required', schema: rejectSchema }, async ({ req, body, session }) => {
  const hasil = await reject(authDeps(), session!, idTrxFromPath(req, 1), body, idempotencyKeyOf(req));
  after(() => notifPIC(authDeps(), { idTrx: hasil.id, jenis: 'dikembalikan', catatan: body.alasan.trim() }));
  return { body: { hasil } };
});
