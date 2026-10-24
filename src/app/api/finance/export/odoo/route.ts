import { exportOdoo, riwayatExport } from '@/server/export-odoo';
import { exportOdooSchema } from '@/server/finance-schema';
import { authDeps } from '@/server/runtime';
import { route } from '../../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-B: riwayat export Odoo (Finance Staff / Fin. Mgr / Admin). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => ({
  body: { riwayat: await riwayatExport(authDeps(), session!) },
}));

/** F3-B: export jurnal Odoo -> file CSV di Shared Drive + isi CSV untuk diunduh langsung. */
export const POST = route({ method: 'POST', session: 'required', schema: exportOdooSchema }, async ({ body, session }) => ({
  body: await exportOdoo(authDeps(), session!, body),
}));
