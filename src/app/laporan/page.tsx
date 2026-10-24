import { can } from '@/domain/capabilities';
import { awalBulanWib, wibDate } from '@/lib/time';
import { AppNav } from '@/ui/AppNav';
import { HalamanLaporan } from '@/ui/HalamanLaporan';
import { wajibSesi } from '../_lib/sesi';
import { propsNav } from '../_lib/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Laporan' };

/** F3-D: laporan AP + viewer audit. */
export default async function Page() {
  const s = await wajibSesi('report.view');
  const now = Date.now();
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="laporan" />
      <main className="wrap-xl pt">
        <HalamanLaporan bisaAudit={can(s.roles, 'audit.view')} hariIni={wibDate(now)} awalBulan={awalBulanWib(now)} />
      </main>
    </>
  );
}
