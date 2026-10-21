import { LogoutButton } from './LogoutButton';
import { PaletPencarian } from './PaletPencarian';

export type NavAktif = 'beranda' | 'pengajuan' | 'baru' | 'persetujuan';

/** Nav global (hitam 44px). Komponen server; hanya tombol Keluar yang client. */
export function AppNav({ nama, bisaAjukan, bisaSetujui = false, jumlahMenunggu, aktif }: { nama: string; bisaAjukan: boolean; bisaSetujui?: boolean; jumlahMenunggu?: number; aktif?: NavAktif }) {
  return (
    <nav className="nav" aria-label="Navigasi utama">
      <div className="nav-in">
        <a className="brand" href="/">P2P Finance</a>
        <a className="nav-beranda" href="/" {...(aktif === 'beranda' ? { 'aria-current': 'page' as const } : {})}>Beranda</a>
        {bisaAjukan && <a href="/pengajuan" {...(aktif === 'pengajuan' ? { 'aria-current': 'page' as const } : {})}>Pengajuan saya</a>}
        {bisaSetujui && <a href="/persetujuan" {...(aktif === 'persetujuan' ? { 'aria-current': 'page' as const } : {})}>Persetujuan{jumlahMenunggu ? ` (${jumlahMenunggu})` : ''}</a>}
        {bisaAjukan && <a className="nav-cta" href="/pengajuan/baru" {...(aktif === 'baru' ? { 'aria-current': 'page' as const } : {})}>Ajukan</a>}
        <PaletPencarian />
        <span className="who">{nama}</span>
        <LogoutButton />
      </div>
    </nav>
  );
}
