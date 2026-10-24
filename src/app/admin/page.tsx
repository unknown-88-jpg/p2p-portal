import { AppNav } from '@/ui/AppNav';
import { HalamanAdmin } from '@/ui/HalamanAdmin';
import { wajibSesi } from '../_lib/sesi';
import { propsNav } from '../_lib/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin' };

/** F3-C: System Admin (Level 9). */
export default async function Page() {
  const s = await wajibSesi('admin.manage');
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="admin" />
      <main className="wrap-xl pt">
        <HalamanAdmin emailSaya={s.email} />
      </main>
    </>
  );
}
