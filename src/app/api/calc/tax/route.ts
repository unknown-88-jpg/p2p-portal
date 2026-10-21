import { hitungPajakApi, taxSchema } from '@/server/calc';
import { getPph } from '@/server/master';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** previewPajak: hanya tampilan. Angka yang DISIMPAN selalu dihitung ulang di server saat submit/verifikasi (M4/M5, dengan tarif PPh SEGAR). */
export const POST = route({ method: 'POST', session: 'required', schema: taxSchema }, async ({ body }) => ({
  body: { hasil: hitungPajakApi(body, await getPph(authDeps())) },
}));
