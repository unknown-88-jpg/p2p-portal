import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { cekInvoice } from '@/server/pengajuan';
import { idTrxParam } from '@/server/pengajuan-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const query = z.object({
  vendorKode: z.string().trim().min(1).max(30),
  noInvoice: z.string().trim().min(1).max(60),
  excludeId: idTrxParam.optional(),
});

/** Cek duplikat invoice saat user selesai mengetik (saran dini, bukan penjaga). Penjaga sebenarnya: create/update/submit. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => {
  const sp = new URL(req.url).searchParams;
  const r = query.safeParse({ vendorKode: sp.get('vendorKode') ?? '', noInvoice: sp.get('noInvoice') ?? '', excludeId: sp.get('excludeId') || undefined });
  if (!r.success) throw new AppError('VALIDATION', 'Parameter vendorKode/noInvoice tidak valid.');
  return { body: await cekInvoice(authDeps(), session!, r.data) };
});
