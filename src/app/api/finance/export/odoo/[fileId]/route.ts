import { AppError } from '@/lib/errors';
import { unduhExport } from '@/server/export-odoo';
import { fileIdParam } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-B: unduh ulang file export yang tercatat di riwayat (bukan sembarang file Drive). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => {
  const id = fileIdParam.safeParse(new URL(req.url).pathname.split('/').filter(Boolean).pop());
  if (!id.success) throw new AppError('VALIDATION', 'ID file tidak valid.');
  const f = await unduhExport(authDeps(), session!, id.data);
  return {
    raw: new Response(f.body, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${f.namaFile.replace(/[^\w.-]/g, '_')}"`, 'x-content-type-options': 'nosniff' },
    }),
  };
});
