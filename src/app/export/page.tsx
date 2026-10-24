import { awalBulanWib, wibDate } from '@/lib/time';
import { AppNav } from '@/ui/AppNav';
import { HalamanExportOdoo } from '@/ui/HalamanExportOdoo';
import { wajibSesi } from '../_lib/sesi';
import { propsNav } from '../_lib/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Export Odoo' };

/** F3-B: export jurnal Odoo (Finance Staff / Fin. Mgr / Admin). */
export default async function Page() {
  const s = await wajibSesi('export.odoo');
  const now = Date.now();
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="export" />
      <main className="wrap-xl pt">
        <HalamanExportOdoo hariIni={wibDate(now)} awalBulan={awalBulanWib(now)} />
      </main>
    </>
  );
}
