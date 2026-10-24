import { redirect } from 'next/navigation';
import { can } from '@/domain/capabilities';
import { AppNav } from '@/ui/AppNav';
import { HalamanVendor } from '@/ui/HalamanVendor';
import { wajibSesi } from '../_lib/sesi';
import { propsNav } from '../_lib/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vendor' };

/** F3-A: daftar vendor (PIC/Manager/Finance Staff/Admin) & pengesahan (Finance Staff). Lainnya diarahkan ke beranda. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const s = await wajibSesi();
  const bisaDaftar = can(s.roles, 'vendor.register'), bisaSahkan = can(s.roles, 'vendor.approve');
  if (!bisaDaftar && !bisaSahkan) redirect('/');
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="vendor" />
      <main className="wrap-wide pt"><HalamanVendor bisaDaftar={bisaDaftar} bisaSahkan={bisaSahkan} {...((await searchParams).tab === 'pengesahan' ? { tabAwal: 'pengesahan' as const } : {})} /></main>
    </>
  );
}
