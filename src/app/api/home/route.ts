import { LEVEL } from '@/domain/config';
import { bisaLihatFinance } from '@/domain/finance';
import { hasLevel } from '@/domain/roles';
import { antreanFinance } from '@/server/finance';
import { authDeps } from '@/server/runtime';
import { meDto, route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** getHomeContext: identitas + menu yang boleh dilihat. F2-F: hitungan antrean Finance per tahap (bila L3/L4/L5; tampilan ber-cache). */
export const GET = route({ method: 'GET', session: 'required' }, async ({ session }) => {
  const r = session!.roles;
  const fin = bisaLihatFinance(r);
  const antrean = fin ? await antreanFinance(authDeps(), session!).then((q) => Object.fromEntries(q.tahap.map((t) => [t.kunci, t.jumlah]))).catch(() => null) : null;
  return { body: { ...meDto(session!), bisa: { ajukan: hasLevel(r, LEVEL.PIC), approve: hasLevel(r, LEVEL.MANAGER), finance: fin }, ...(antrean ? { antreanFinance: antrean } : {}) } };
});
