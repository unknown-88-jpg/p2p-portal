import { can } from '@/domain/capabilities';
import { listMine } from '@/server/pengajuan';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { KELOMPOK_STATUS } from '@/domain/status-label';
import { DaftarPengajuan } from '@/ui/DaftarPengajuan';
import { wajibSesi } from '../_lib/sesi';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pengajuan saya' };

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const s = await wajibSesi('pengajuan.write');
  const data = await listMine(authDeps(), s);
  const q = (await searchParams).status;
  const awal = KELOMPOK_STATUS.find((k) => k.kunci === q)?.kunci;
  return (
    <>
      <AppNav nama={s.nama} bisaAjukan bisaSetujui={can(s.roles, 'approve.manager')} aktif="pengajuan" />
      <main className="wrap pt">
        <div className="toolbar"><h1 className="page-h">Pengajuan saya</h1><a className="btn btn-primary btn-sm" href="/pengajuan/baru">Buat pengajuan</a></div>
        <DaftarPengajuan data={data} {...(awal ? { kelompokAwal: awal } : {})} />
      </main>
    </>
  );
}
