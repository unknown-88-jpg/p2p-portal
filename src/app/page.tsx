import { can } from '@/domain/capabilities';
import { KELOMPOK_STATUS } from '@/domain/status-label';
import { rupiah } from '@/domain/pengajuan-form';
import { labelStatus } from '@/domain/status-label';
import { inbox } from '@/server/approval';
import { dashboard } from '@/server/dokumen';
import { listMine } from '@/server/pengajuan';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { wajibSesi } from './_lib/sesi';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await wajibSesi();
  const bisa = can(s.roles, 'pengajuan.write');
  const daftar = bisa ? await listMine(authDeps(), s) : [];
  const bisaSetuju = can(s.roles, 'approve.manager');
  const menunggu = bisaSetuju ? (await inbox(authDeps(), s)).length : 0;
  const dash = await dashboard(authDeps(), s);
  const n = (k: string) => daftar.filter((d) => KELOMPOK_STATUS.find((x) => x.kunci === k)!.cocok(d.status)).length;
  return (
    <>
      <AppNav nama={s.nama} bisaAjukan={bisa} bisaSetujui={bisaSetuju} jumlahMenunggu={menunggu} aktif="beranda" />
      <main><header className="tile parchment">
        <div className="wrap">
          <h1 className="hero-h">Halo, {s.nama.split(' ')[0]}</h1>
          <p className="hero-sub">{s.jabatan}</p>
          {bisaSetuju && <div className="cta-row"><a className="btn btn-primary" href="/persetujuan">Persetujuan{menunggu ? ` (${menunggu} menunggu)` : ''}</a></div>}
          {bisa ? (
            <>
              <div className="cta-row">
                <a className="btn btn-primary" href="/pengajuan/baru">Buat pengajuan</a>
                <a className="btn btn-secondary" href="/pengajuan">Pengajuan saya</a>
              </div>
              <div className="statistik">
                <div className={`stat${n('perlu-tindakan') ? ' merah' : ''}`}><div className="n">{n('perlu-tindakan')}</div><div className="l">Perlu tindakan</div></div>
                <div className="stat"><div className="n">{n('diproses')}</div><div className="l">Sedang diproses</div></div>
                <div className="stat"><div className="n">{n('selesai')}</div><div className="l">Selesai</div></div>
              </div>
            </>
          ) : <p className="muted pt">Fitur Finance menyusul di milestone berikutnya.</p>}
          {dash.manager && (
            <>
              <h2 className="sec-h">Antrean Manager</h2>
              <div className="statistik">
                <div className={`stat${dash.manager.antrean ? ' merah' : ''}`}><div className="n">{dash.manager.antrean}</div><div className="l">Menunggu persetujuan</div></div>
                <div className="stat"><div className="n n-uang">{rupiah(dash.manager.totalNominal)}</div><div className="l">Total nominal antrean</div></div>
                <div className="stat"><div className="n">{dash.manager.tertuaHari === null ? '—' : `${dash.manager.tertuaHari} hr`}</div><div className="l">Tertua di antrean</div></div>
              </div>
              {dash.manager.divisi.length > 0 && (
                <div className="kartu"><span className="kartu-h">Pengajuan divisi bulan ini</span>
                  <ul className="ringkas">{dash.manager.divisi.map((v) => <li key={v.nama}><span>{v.nama}</span><span>{v.jumlah} dok · {rupiah(v.nominal)}</span></li>)}</ul></div>
              )}
            </>
          )}
          {bisa && dash.pic.terbaru.length > 0 && (
            <div className="kartu"><span className="kartu-h">Aktivitas terakhir</span>
              {(dash.pic.revisi > 0 || dash.pic.menunggu > 0) && <p className="muted">{dash.pic.revisi} perlu revisi · {dash.pic.draft} draft · {dash.pic.menunggu} menunggu Manager</p>}
              <ul className="ringkas">{dash.pic.terbaru.map((t) => <li key={t.id}><a href={`/pengajuan/${encodeURIComponent(t.id)}`}>{t.id} · {t.vendor || '—'}</a><span>{labelStatus(t.status).label} · {t.waktu}</span></li>)}</ul></div>
          )}
        </div>
      </header></main>
    </>
  );
}
