import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { getMine } from '@/server/pengajuan';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { PengajuanWizard } from '@/ui/wizard/PengajuanWizard';
import { wajibSesi } from '../../../_lib/sesi';
import { propsNav } from '../../../_lib/nav';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await wajibSesi('pengajuan.write');
  const { id } = await params;
  let doc;
  try { doc = await getMine(authDeps(), s, decodeURIComponent(id)); }
  catch (e) { if (e instanceof AppError && e.code === 'NOT_FOUND') redirect('/pengajuan'); throw e; }
  if (!doc.editable) redirect(`/pengajuan/${encodeURIComponent(doc.id)}`);
  return (<><AppNav nama={s.nama} {...await propsNav(s)} aktif="pengajuan" /><PengajuanWizard key={doc.id} roles={s.roles} email={s.email} nama={s.nama} awal={doc} /></>);
}
