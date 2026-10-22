import type { PeristiwaTimeline } from '@/domain/dokumen';
import { IkonSelesai, IkonSilang } from './icons';

const TAMPIL_AWAL = 4; // bila riwayat panjang, tampilkan peristiwa terbaru; yang lama dilipat (tanpa JS: <details>)

const Peristiwa = ({ t }: { t: PeristiwaTimeline }) => {
  const kembali = t.judul.startsWith('Dikembalikan');
  return (
    <li>
      <span className={`rw-mk ${kembali ? 'bad' : 'ok'}`} aria-hidden="true">{kembali ? <IkonSilang /> : <IkonSelesai />}</span>
      <div className="rw-isi">
        <div className="rw-baris"><span className="rw-j">{t.judul}</span>{t.metode && <span className="rw-chip">{t.metode}</span>}</div>
        <div className="rw-m num">{t.waktu} · {t.oleh}</div>
        {t.catatan && <p className="rw-c">{t.catatan}</p>}
      </div>
    </li>
  );
};

/**
 * Riwayat dokumen: linimasa vertikal (terlama di atas). Penanda hijau = selesai, merah = dikembalikan, cincin biru = tahap saat ini.
 * Peristiwa lama dilipat bila lebih dari TAMPIL_AWAL + 1. Warna bukan satu-satunya penanda: tiap penanda berikon dan tiap baris bertulisan.
 */
export function RiwayatTimeline({ timeline, sekarang }: { timeline: readonly PeristiwaTimeline[]; sekarang: { label: string; pj: string } | null }) {
  const lipat = timeline.length > TAMPIL_AWAL + 1 ? timeline.length - TAMPIL_AWAL : 0;
  const lama = timeline.slice(0, lipat);
  const baru = timeline.slice(lipat);
  return (
    <section className="kartu rw-kartu" aria-labelledby="rw-h">
      <div className="kartu-judul"><h2 className="kartu-t" id="rw-h">Riwayat</h2><span className="muted cap">{timeline.length} peristiwa</span></div>
      {timeline.length === 0 && !sekarang ? <p className="muted">Belum ada riwayat.</p> : (
        <div className="rw-wrap">
          {lama.length > 0 && (
            <details className="rw-lama">
              <summary><span className="rw-mk lm" aria-hidden="true">···</span><span className="rw-sum">Lihat {lama.length} riwayat sebelumnya</span></summary>
              <ol className="rw">{lama.map((t, i) => <Peristiwa key={i} t={t} />)}</ol>
            </details>
          )}
          <ol className="rw">
            {baru.map((t, i) => <Peristiwa key={i} t={t} />)}
            {sekarang && (
              <li aria-current="step">
                <span className="rw-mk now" aria-hidden="true" />
                <div className="rw-isi"><div className="rw-baris"><span className="rw-j">{sekarang.label}</span></div><div className="rw-m">Tahap saat ini · {sekarang.pj}</div></div>
              </li>
            )}
          </ol>
        </div>
      )}
    </section>
  );
}
