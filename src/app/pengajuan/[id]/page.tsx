import { catatanTampil } from '@/domain/approval';
import { can } from '@/domain/capabilities';
import { notFound } from 'next/navigation';
import { rupiah, samarkanRekening } from '@/domain/pengajuan-form';
import { labelStatus } from '@/domain/status-label';
import { AppError } from '@/lib/errors';
import { detail } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { Pesan, StatusPill } from '@/ui/kit';
import { LampiranPopup } from '@/ui/LampiranPopup';
import { RiwayatTimeline } from '@/ui/RiwayatTimeline';
import { wajibSesi } from '../../_lib/sesi';

export const dynamic = 'force-dynamic';
/** Hanya ID dari URL (tak menyentuh data -> tak membocorkan apa pun ke tab/riwayat browser). */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { return { title: decodeURIComponent((await params).id).slice(0, 20) }; }

/** Detail dokumen (M7): pemilik, Manager berwenang, atau Finance+ (I13). Selain itu 404. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await wajibSesi();
  const { id } = await params;
  let d;
  try { d = await detail(authDeps(), s, decodeURIComponent(id)); }
  catch (e) { if (e instanceof AppError && e.code === 'NOT_FOUND') notFound(); throw e; }
  // Susunan mengikuti mockup: info transaksi (grid) di kiri, "Pajak & nominal" di kanan; vendor, P.O, dan nominal akhir ada di kepala kartu.
  const info: [string, string][] = [
    ['Tanggal', d.tanggal], ['Tgl invoice', d.dateInvoice], ['Jatuh tempo', d.dueDate],
    ['Company', d.company], ['Brand / Dept', `${d.brand} / ${d.departement}`], ['PIC', d.pic],
    ['No. invoice', d.noInvoice], ['Tipe', d.tipe], ['Jenis pembayaran', d.jenisPembayaran],
    ['NPWP vendor', d.npwp], ['Rekening', d.bank || d.noRekening ? `${d.bank} · ${samarkanRekening(d.noRekening)}` : ''],
  ];
  const pajak: [string, string][] = [
    ['Nominal invoice', rupiah(d.invoiceAmount)], ['Diskon', rupiah(d.diskon)], ['Biaya lain', rupiah(d.biayaLainnya)], ['DPP', rupiah(d.dpp)],
    [`PPN (${d.statusPPN})`, rupiah(d.ppnAmount)], ['PPh', d.pphAmount > 0 ? `${d.jenisPPh} — ${rupiah(d.pphAmount)}` : '—'],
  ];
  const kini = d.alur.find((a) => a.state === 'sekarang');
  const posisi = kini ? d.alur.indexOf(kini) + 1 : d.alur.filter((a) => a.state === 'selesai').length;
  return (
    <>
      <AppNav nama={s.nama} bisaAjukan={can(s.roles, 'pengajuan.write')} bisaSetujui={can(s.roles, 'approve.manager')} aktif="pengajuan" />
      <main className="wrap pt">
        <a className="link" href={d.milikSaya ? '/pengajuan' : '/'}>← {d.milikSaya ? 'Pengajuan saya' : 'Beranda'}</a>
        <div className="toolbar"><h1 className="page-h">{d.id}</h1><StatusPill status={d.status} /></div>
        {d.perluCFO && <p><span className="badge-cfo">Butuh TTD CFO</span></p>}
        {d.notesFinance && <Pesan jenis="warn"><b>Catatan:</b> {catatanTampil(d.notesFinance)}</Pesan>}

        <div className="alur-ringkas">
          <progress value={posisi} max={d.alur.length} aria-label="Posisi di alur persetujuan" />
          <p>{kini ? <>Tahap <b>{posisi}</b> dari {d.alur.length} · <b>{kini.label}</b> ({kini.pj})</> : <>Alur selesai · {posisi} dari {d.alur.length} tahap</>}</p>
        </div>
        <ol className="alur" aria-label="Posisi dokumen di alur persetujuan">
          {d.alur.map((a) => (
            <li key={a.status} className={a.state} {...(a.state === 'sekarang' ? { 'aria-current': 'step' as const } : {})}>
              <span className="alur-n">{a.label}</span><span className="alur-pj">{a.pj}</span>
            </li>
          ))}
        </ol>
        {kini && d.umurHari !== null && <p className="muted">Di tahap ini {d.umurHari === 0 ? 'sejak hari ini' : `${d.umurHari} hari`}.</p>}

        <section className="det" aria-label="Rincian pengajuan">
          <div className="det-head">
            <div className="det-vendor">
              <span className="det-l">Vendor</span>
              <h2 className="det-nama">{d.vendorNama || '—'}</h2>
              <p className="det-sub">{d.poNumber && d.poNumber !== '-' ? `P.O · ${d.poNumber}` : `Pengajuan ${d.tipe || '—'}`}</p>
            </div>
            <div className="det-nominal">
              <span className="det-l">Nominal akhir</span>
              <div className="det-angka num">{rupiah(d.nominal)}</div>
            </div>
          </div>
          <div className="det-body">
            <div className="det-info">
              <h3 className="det-h">Info transaksi</h3>
              <dl className="det-grid">{info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
            </div>
            <aside className="det-pajak" aria-label="Pajak dan nominal">
              <h3 className="det-h">Pajak &amp; nominal</h3>
              <dl className="det-pj">{pajak.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}</dl>
            </aside>
          </div>
          <div className="det-perlu">
            <span className="det-l">Keperluan</span>
            <strong>{d.description || '—'}</strong>
            {d.notesUser && <p className="muted">{d.notesUser}</p>}
          </div>
        </section>
        {d.coa && <div className="kartu"><span className="kartu-h">Jurnal COA</span><p>{d.coa.kategori} › {d.coa.head} › {d.coa.sub}</p></div>}

        <RiwayatTimeline timeline={d.timeline} sekarang={kini ? { label: labelStatus(d.status).label, pj: kini.pj } : null} />

        <div className="cta-row">
          {d.editable && d.milikSaya && <a className="btn btn-primary" href={`/pengajuan/${encodeURIComponent(d.id)}/edit`}>{d.status === 'Revision Needed' ? 'Revisi' : 'Lanjutkan draft'}</a>}
          <a className="btn btn-secondary" href={`/pengajuan/${encodeURIComponent(d.id)}/voucher`}>Voucher</a>
          {d.punyaLampiran && <LampiranPopup id={d.id} />}
        </div>
      </main>
    </>
  );
}
