import { isKunciTahap } from '@/domain/finance';
import { AppNav } from '@/ui/AppNav';
import { AntreanFinance } from '@/ui/AntreanFinance';
import { wajibSesi } from '../_lib/sesi';
import { propsNav } from '../_lib/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Antrean Finance' };

/** F2-A: antrean Finance per tahap. Hanya L3/L4/L5 (lainnya diarahkan ke beranda; API-nya 403). */
export default async function Page({ searchParams }: { searchParams: Promise<{ tahap?: string | string[] }> }) {
  const s = await wajibSesi('finance.view');
  const t = (await searchParams).tahap;
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="finance" />
      <main className="wrap-xl pt">
        <AntreanFinance tahapAwal={isKunciTahap(t) ? t : undefined} />
      </main>
    </>
  );
}
