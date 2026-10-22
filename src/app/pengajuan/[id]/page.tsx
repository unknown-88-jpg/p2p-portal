import { catatanTampil } from '@/domain/approval';
import { can } from '@/domain/capabilities';
import { notFound } from 'next/navigation';
import { rupiah } from '@/domain/pengajuan-form';
import { AppError } from '@/lib/errors';
import { detail } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { StatusPill } from '@/ui/kit';
import { LampiranPopup } from '@/ui/LampiranPopup';
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
  const baris: [string, string][] = [
    ['Tanggal', d.tanggal], ['Company', d.company], ['Brand / Dept', `${d.brand} / ${d.departement}`], ['Tipe', d.tipe], ['PIC', d.pic],
    ['P.O', d.poNumber], ['Vendor', d.vendorNama], ['NPWP vendor', d.npwp], ['Rekening', d.bank || d.namaRekening ? `${d.bank} · ${d.noRekening}` : ''], ['No. invoice', d.noInvoice],
    ['Tgl invoice', d.dateInvoice], ['Jatuh tempo', d.dueDate], ['Jenis pembayaran', d.jenisPembayaran],
  ];
  const pajak: [string, string][] = [
    ['Nominal invoice', rupiah(d.invoiceAmount)], ['Diskon', rupiah(d.diskon)], ['Biaya lain', rupiah(d.biayaLainnya)], ['DPP', rupiah(d.dpp)],
    [`PPN (${d.statusPPN})`, rupiah(d.ppnAmount)], ['PPh', d.pphAmount > 0 ? `${d.jenisPPh} — ${rupiah(d.pphAmount)}` : '—'], ['Nominal akhir', rupiah(d.nominal)],
  ];
  const kini = d.alur.find((a) => a.state === 'sekarang');
  return (
    <>
      <AppNav nama={s.nama} bisaAjukan={can(s.roles, 'pengajuan.write')} bisaSetujui={can(s.roles, 'approve.manager')} aktif="pengajuan" />
      <main className="wrap pt">
        <a className="link" href={d.milikSaya ? '/pengajuan' : '/'}>← {d.milikSaya ? 'Pengajuan saya' : 'Beranda'}</a>
        <div className="toolbar"><h1 className="page-h">{d.id}</h1><StatusPill status={d.status} /></div>
        {d.perluCFO && <p><span className="badge-cfo">Butuh TTD CFO</span></p>}
        {d.notesFinance && <div className="msg warn" role="status"><b>Catatan:</b> {catatanTampil(d.notesFinance)}</div>}

        <ol className="alur" aria-label="Posisi dokumen di alur persetujuan">
          {d.alur.map((a) => (
            <li key={a.status} className={a.state} {...(a.state === 'sekarang' ? { 'aria-current': 'step' as const } : {})}>
              <span className="alur-n">{a.label}</span><span className="alur-pj">{a.pj}</span>
            </li>
          ))}
        </ol>
        {kini && d.umurHari !== null && <p className="muted">Di tahap ini {d.umurHari === 0 ? 'sejak hari ini' : `${d.umurHari} hari`}.</p>}

        <div className="kartu"><dl className="kv">{baris.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl></div>
        <div className="kartu"><span className="kartu-h">Pajak &amp; nominal</span><dl className="kv">{pajak.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
        <div className="kartu"><span className="kartu-h">Keperluan</span><p>{d.description}</p>{d.notesUser && <p className="muted">{d.notesUser}</p>}</div>
        {d.coa && <div className="kartu"><span className="kartu-h">Jurnal COA</span><p>{d.coa.kategori} › {d.coa.head} › {d.coa.sub}</p></div>}

        <div className="kartu">
          <span className="kartu-h">Riwayat</span>
          {d.timeline.length === 0 ? <p className="muted">Belum ada riwayat.</p> : (
            <ol className="tl">{d.timeline.map((t, i) => (
              <li key={i} className={t.jenis}><div className="tl-j">{t.judul}</div><div className="tl-m">{t.waktu} · {t.oleh}{t.metode ? ` · ${t.metode}` : ''}</div>{t.catatan && <div className="tl-c">{t.catatan}</div>}</li>
            ))}</ol>
          )}
        </div>

        <div className="cta-row">
          {d.editable && d.milikSaya && <a className="btn btn-primary" href={`/pengajuan/${encodeURIComponent(d.id)}/edit`}>{d.status === 'Revision Needed' ? 'Revisi' : 'Lanjutkan draft'}</a>}
          <a className="btn btn-secondary" href={`/pengajuan/${encodeURIComponent(d.id)}/voucher`}>Voucher</a>
          {d.punyaLampiran && <LampiranPopup id={d.id} />}
        </div>
      </main>
    </>
  );
}
