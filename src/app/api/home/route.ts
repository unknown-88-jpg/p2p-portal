import { LEVEL } from '@/domain/config';
import { hasLevel } from '@/domain/roles';
import { meDto, route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** getHomeContext (versi M2): identitas + menu yang boleh dilihat. Hitungan antrean (pendingApproval/pendingFinance) menyusul di M4/M5 saat Trx_Pengajuan dibaca. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => {
  const r = session!.roles;
  return { body: { ...meDto(session!), bisa: { ajukan: hasLevel(r, LEVEL.PIC), approve: hasLevel(r, LEVEL.MANAGER), finance: hasLevel(r, LEVEL.FINANCE_STAFF) } } };
});
