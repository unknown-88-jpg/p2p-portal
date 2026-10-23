import { AppNav } from '@/ui/AppNav';
import { InboxPersetujuan } from '@/ui/InboxPersetujuan';
import { wajibSesi } from '../_lib/sesi';
import { propsNav } from '../_lib/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Persetujuan' };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const s = await wajibSesi('approve.manager');
  const q = await searchParams;
  const id = typeof q.id === 'string' && /^(TRD|NTR)-\d{5,}$/.test(q.id) ? q.id : undefined;
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="persetujuan" />
      <main className="wrap-xl pt">
        <InboxPersetujuan idAwal={id} />
      </main>
    </>
  );
}
