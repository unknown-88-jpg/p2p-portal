import { LogoutButton } from './LogoutButton';
import { PaletPencarian } from './PaletPencarian';
import { IkonBeranda, IkonDokumen, IkonSetuju, IkonTambah } from './icons';
import { LatarMenu, TombolMenu } from './SidebarToggle';

export type NavAktif = 'beranda' | 'pengajuan' | 'baru' | 'persetujuan';

const inisial = (nama: string): string => nama.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? '').join('') || '?';

/**
 * Kerangka dashboard: sidebar gelap di kiri + bar atas frosted. Komponen server; hanya tombol menu, pencarian, dan Keluar yang client.
 * Mengembalikan tiga saudara (sidebar, backdrop, bar atas); CSS (#isi:has(> .sidebar)) yang menatanya menjadi grid bersama <main> halaman.
 */
export function AppNav({ nama, bisaAjukan, bisaSetujui = false, jumlahMenunggu, aktif }: { nama: string; bisaAjukan: boolean; bisaSetujui?: boolean; jumlahMenunggu?: number; aktif?: NavAktif }) {
  const cur = (k: NavAktif) => (aktif === k ? { 'aria-current': 'page' as const } : {});
  return (
    <>
      <aside className="sidebar" id="sidebar">
        <a className="sb-brand" href="/"><span className="sb-logo" aria-hidden="true">P</span><span>P2P Finance</span></a>
        {bisaAjukan && <a className="btn btn-primary sb-cta" href="/pengajuan/baru" {...cur('baru')}><IkonTambah />Ajukan</a>}
        <nav className="sb-nav" aria-label="Navigasi utama">
          <a href="/" {...cur('beranda')}><IkonBeranda />Beranda</a>
          {bisaAjukan && <a href="/pengajuan" {...cur('pengajuan')}><IkonDokumen />Pengajuan saya</a>}
          {bisaSetujui && <a href="/persetujuan" {...cur('persetujuan')}><IkonSetuju />Persetujuan{jumlahMenunggu ? ` (${jumlahMenunggu})` : ''}</a>}
        </nav>
        <div className="sb-foot">
          <span className="avatar" aria-hidden="true">{inisial(nama)}</span>
          <span className="sb-who">{nama}</span>
          <LogoutButton />
        </div>
      </aside>
      <LatarMenu />
      <header className="topbar">
        <TombolMenu />
        <PaletPencarian />
        <span className="tb-user"><span className="avatar" aria-hidden="true">{inisial(nama)}</span><span className="tb-nama">{nama}</span></span>
      </header>
    </>
  );
}
