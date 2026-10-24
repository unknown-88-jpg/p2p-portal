import { can } from '@/domain/capabilities';
import { KELOMPOK_STATUS } from '@/domain/status-label';
import { rupiah } from '@/domain/pengajuan-form';
import { inbox } from '@/server/approval';
import { dashboard } from '@/server/dokumen';
import { listMine } from '@/server/pengajuan';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { IkonPanah, IkonPerhatian, IkonProses, IkonSelesai, IkonSetuju, IkonUang, IkonWA } from '@/ui/icons';
import { StatusPill } from '@/ui/kit';
import { KirimWa } from '@/ui/KirimWa';
import { JADWAL_DIGEST_TEKS } from '@/domain/wa';
import { STATUS } from '@/domain/status';
import { sudahKirimHariIni } from '@/server/wa-manual';
import { wajibSesi } from './_lib/sesi';
import { propsNav } from './_lib/nav';
import { antreanFinance } from '@/server/finance';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Beranda' };

export default async function Home() {
  const s = await wajibSesi();
  const bisa = can(s.roles, 'pengajuan.write');
  const daftar = bisa ? await listMine(authDeps(), s) : [];
  const bisaSetuju = can(s.roles, 'approve.manager');
  const menunggu = bisaSetuju ? (await inbox(authDeps(), s)).length : 0;
  const fin = can(s.roles, 'finance.view') ? await antreanFinance(authDeps(), s).catch(() => null) : null;
  const dash = await dashboard(authDeps(), s);
  const waHariIni = bisa ? await sudahKirimHariIni(authDeps(), dash.pic.terbaru.filter((t) => t.status === STATUS.SUBMITTED).map((t) => t.id)) : new Set<string>();
  const n = (k: string) => daftar.filter((d) => KELOMPOK_STATUS.find((x) => x.kunci === k)!.cocok(d.status)).length;
  const total = daftar.length;
  const metrik = [
    { k: 'perlu-tindakan', label: 'Perlu tindakan', ikon: <IkonPerhatian />, nada: 'merah' },
    { k: 'diproses', label: 'Sedang diproses', ikon: <IkonProses />, nada: 'biru' },
    { k: 'selesai', label: 'Selesai', ikon: <IkonSelesai />, nada: 'hijau' },
  ] as const;
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="beranda" />
      <main className="dash">
        <div className="dash-head">
          <div>
            <h1 className="page-h">Halo, {s.nama.split(' ')[0]}</h1>
            <p className="muted">{s.jabatan}</p>
          </div>
          <div className="dash-aksi">
            {fin && <a className="btn btn-secondary" href="/finance">Antrean Finance</a>}
            {bisaSetuju && <a className="btn btn-secondary" href="/persetujuan">Persetujuan{menunggu ? ` (${menunggu} menunggu)` : ''}</a>}
            {bisa && <a className="btn btn-primary" href="/pengajuan/baru">Buat pengajuan</a>}
          </div>
        </div>

        {bisa ? (
          <div className="metrik">
            {metrik.map((m) => (
              <a key={m.k} className={`metrik-kartu${n(m.k) > 0 ? ` nada-${m.nada}` : ''}`} href={`/pengajuan?status=${m.k}`}>
                <span className="metrik-ikon">{m.ikon}</span>
                <div className="metrik-teks"><div className="metrik-n num">{n(m.k)}</div><div className="metrik-l">{m.label}</div></div>
                <span className="metrik-panah" aria-hidden="true"><IkonPanah /></span>
              </a>
            ))}
          </div>
        ) : null}

        {fin && (
          <>
            <h2 className="sec-h">Antrean Finance</h2>
            <div className="metrik metrik-4">
              {fin.tahap.map((t) => (
                <a key={t.kunci} className={`metrik-kartu${t.jumlah && t.bisaAksi ? ' nada-kuning' : ''}`} href={`/finance?tahap=${t.kunci}`}>
                  <span className="metrik-ikon"><IkonProses /></span>
                  <div className="metrik-teks"><div className="metrik-n num">{t.jumlah}</div><div className="metrik-l">{t.label}</div></div>
                  <span className="metrik-panah" aria-hidden="true"><IkonPanah /></span>
                </a>
              ))}
            </div>
          </>
        )}

        {dash.manager && (
          <>
            <h2 className="sec-h">Antrean Manager</h2>
            <div className="metrik">
              <a className={`metrik-kartu${dash.manager.antrean ? ' nada-kuning' : ''}`} href="/persetujuan"><span className="metrik-ikon"><IkonSetuju /></span><div className="metrik-teks"><div className="metrik-n num">{dash.manager.antrean}</div><div className="metrik-l">Menunggu persetujuan</div></div><span className="metrik-panah" aria-hidden="true"><IkonPanah /></span></a>
              <div className="metrik-kartu"><span className="metrik-ikon"><IkonUang /></span><div className="metrik-teks"><div className="metrik-n metrik-uang num">{rupiah(dash.manager.totalNominal)}</div><div className="metrik-l">Total nominal antrean</div></div></div>
              <div className="metrik-kartu"><span className="metrik-ikon"><IkonProses /></span><div className="metrik-teks"><div className="metrik-n num">{dash.manager.tertuaHari === null ? '—' : `${dash.manager.tertuaHari} hr`}</div><div className="metrik-l">Tertua di antrean</div></div></div>
            </div>
            {dash.manager.divisi.length > 0 && (
              <div className="kartu kartu-gap"><span className="kartu-h">Pengajuan divisi bulan ini</span>
                <ul className="ringkas">{dash.manager.divisi.map((v) => <li key={v.nama}><span>{v.nama}</span><span>{v.jumlah} dok · {rupiah(v.nominal)}</span></li>)}</ul></div>
            )}
          </>
        )}

        {bisa && (
          <div className="dash-grid">
            <section className="kartu" aria-labelledby="h-aktivitas">
              <div className="kartu-judul"><h2 className="kartu-t" id="h-aktivitas">Aktivitas terakhir</h2><a className="cap" href="/pengajuan">Lihat semua</a></div>
              {(dash.pic.revisi > 0 || dash.pic.menunggu > 0) && <p className="muted cap">{dash.pic.revisi} perlu revisi · {dash.pic.draft} draft · {dash.pic.menunggu} menunggu Manager</p>}
              {dash.pic.terbaru.length === 0 ? (
                <div className="kosong"><p>Belum ada pengajuan.</p><div className="cta-row cta-tengah"><a className="btn btn-primary" href="/pengajuan/baru">Buat pengajuan pertama</a></div></div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th scope="col">Dokumen</th><th scope="col">Status</th><th scope="col" className="tbl-wkt">Waktu</th></tr></thead>
                    <tbody>{dash.pic.terbaru.map((t) => (
                      <tr key={t.id}>
                        <td><a href={`/pengajuan/${encodeURIComponent(t.id)}`}><b>{t.id}</b></a><span className="tbl-sub">{t.vendor || '—'}</span></td>
                        <td><div className="st-aksi"><StatusPill status={t.status} />{t.status === STATUS.SUBMITTED && <KirimWa id={t.id} sudahHariIni={waHariIni.has(t.id)} />}</div></td>
                        <td className="tbl-wkt muted cap">{t.waktu}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="kartu" aria-labelledby="h-ringkas">
              <h2 className="kartu-t" id="h-ringkas">Ringkasan status</h2>
              <p className="muted cap">{total} pengajuan Anda</p>
              <div className="bar-list">
                {metrik.map((m) => (
                  <div key={m.k} className="bar-baris">
                    <div className="bar-ket"><span>{m.label}</span><span className="num">{n(m.k)}</span></div>
                    <progress className={m.k === 'perlu-tindakan' ? 'lewat' : m.k === 'selesai' ? 'ok' : ''} value={n(m.k)} max={Math.max(total, 1)} aria-label={`${m.label}: ${n(m.k)} dari ${total}`} />
                  </div>
                ))}
              </div>
              <p className="catatan-wa"><IkonWA /><span>Pengingat WA ke Manager dikirim <b>otomatis</b> pukul {JADWAL_DIGEST_TEKS}. Tombol <b>Kirim WA</b> mengirim sekarang, maks. 1× per hari per pengajuan.</span></p>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
