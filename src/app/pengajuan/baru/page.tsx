import { AppNav } from '@/ui/AppNav';
import { PengajuanWizard } from '@/ui/wizard/PengajuanWizard';
import { wajibSesi } from '../../_lib/sesi';
import { propsNav } from '../../_lib/nav';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const s = await wajibSesi('pengajuan.write');
  return (<><AppNav nama={s.nama} {...await propsNav(s)} aktif="baru" /><PengajuanWizard roles={s.roles} email={s.email} nama={s.nama} /></>);
}
