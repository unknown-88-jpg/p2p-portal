import { konfirmasiUnggah } from '@/server/lampiran';
import { konfirmasiUnggahSchema } from '@/server/lampiran-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../../_lib/handler';
import { idTrxFromPath } from '../../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Setelah browser selesai PUT ke Drive: server memverifikasi (nama, ukuran, folder, tipe, magic bytes) lalu menempelkan ke pengajuan. Body: { uploadId, fileId }. */
export const POST = route({ method: 'POST', session: 'required', schema: konfirmasiUnggahSchema }, async ({ req, body, session }) => ({
  body: { hasil: await konfirmasiUnggah(authDeps(), session!, idTrxFromPath(req, 2), body) },
}));
