import { auditQuery, lihatAudit, parseQuery } from '@/server/laporan';
import { authDeps } from '@/server/runtime';
import { route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F3-D: viewer Audit_Log baca-saja (Fin. Mgr / CFO / Admin). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => ({ body: await lihatAudit(authDeps(), session!, parseQuery(req, auditQuery)) }));
