import { AppNav } from '@/ui/AppNav';
import { InboxPersetujuan } from '@/ui/InboxPersetujuan';
import { wajibSesi } from '../_lib/sesi';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Persetujuan' };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const s = await wajibSesi('approve.manager');
  const q = await searchParams;
  const id = typeof q.id === 'string' && /^(TRD|NTR)-\d{5,}$/.test(q.id) ? q.id : undefined;
  return (
    <>
      <AppNav nama={s.nama} bisaAjukan={false} bisaSetujui aktif="persetujuan" />
      <main className="wrap-wide pt">
        <h1 className="page-h">Persetujuan</h1>
        <InboxPersetujuan idAwal={id} />
      </main>
    </>
  );
}
