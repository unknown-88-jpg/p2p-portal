import { authDeps } from '@/server/runtime';
import { kirimWaManual } from '@/server/wa-manual';
import { route } from '../../../_lib/handler';
import { idTrxFromPath } from '../../../_lib/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F-15: PIC mengirim pengingat WA ke Manager untuk dokumennya yang Menunggu Manager. Maks. 1x/hari (WIB) per dokumen; ke-2 = 429. */
export const POST = route({ method: 'POST', session: 'required' }, async ({ req, session }) => ({
  body: { hasil: await kirimWaManual(authDeps(), session!, idTrxFromPath(req, 1)) },
}));
