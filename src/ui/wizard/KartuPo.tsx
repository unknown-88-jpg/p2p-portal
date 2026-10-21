import { formatRibuan, gaugePlafon, rupiah } from '@/domain/pengajuan-form';
import { StatusPill } from '../kit';
import type { DataPo } from './tipe';

/** Kartu P.O + gauge plafon (design 7.4.C langkah 1). `nominalIni` > 0 menambahkan dokumen yang sedang dibuat ke gauge. */
export function KartuPo({ po, nominalIni = 0, judul = 'Data P.O' }: { po: DataPo; nominalIni?: number; judul?: string }) {
  const g = gaugePlafon(po.billing.totalDiajukan, po.plafonSJ, nominalIni);
  const diterimaPenuh = po.qtyPO > 0 && po.qtySJ >= po.qtyPO;
  return (
    <div className="kartu" aria-label={judul}>
      <div className="kartu-h">{judul}</div>
      <dl className="kv">
        <div><dt>No. P.O</dt><dd>{po.poNumber}</dd></div>
        <div><dt>Vendor</dt><dd>{po.vendor.nama} <span className="muted">({po.vendor.kode})</span></dd></div>
        {po.description && <div><dt>Keterangan</dt><dd>{po.description}</dd></div>}
        <div><dt>Grand total P.O</dt><dd className="num">{rupiah(po.grandTotalPO)}</dd></div>
        {po.qtyPO > 0
          ? <div><dt>Barang diterima gudang</dt><dd className="num">{formatRibuan(po.qtySJ)} dari {formatRibuan(po.qtyPO)}{diterimaPenuh ? ' · lengkap' : ''}</dd></div>
          : <div><dt>Jenis</dt><dd>Jasa / tanpa qty</dd></div>}
      </dl>

      <div className="gauge-blok">
        <div className="cap-strong" id="gauge-l">Plafon yang boleh ditagih</div>
        <div className="angka-besar num">{rupiah(po.plafonSJ)}</div>
        <progress className={g.nada === 'lewat' ? 'lewat' : g.nada === 'rawan' ? 'rawan' : undefined} value={g.bagianTermasukIni} max={1} aria-labelledby="gauge-l" aria-valuetext={`${Math.round(g.bagianTermasukIni * 100)} persen terpakai`} />
        <div className="sisa-baris"><span>Sudah diajukan {rupiah(po.billing.totalDiajukan)}</span><span>Sisa {rupiah(Math.max(0, po.plafonSJ - po.billing.totalDiajukan))}</span></div>
        {nominalIni > 0 && (
          <div className="sisa-baris"><span>Pengajuan ini {rupiah(nominalIni)}</span><span className={g.nada === 'lewat' ? 'err-teks' : undefined}>{g.sisaSetelahIni < 0 ? `Lewat ${rupiah(-g.sisaSetelahIni)}` : `Sisa setelahnya ${rupiah(g.sisaSetelahIni)}`}</span></div>
        )}
        {!diterimaPenuh && po.qtyPO > 0 && <p className="hint">Barang belum lengkap diterima: porsi 10% terakhir (retensi) baru bisa ditagih setelah Surat Jalan lengkap.</p>}
      </div>

      {po.billing.dokumen.length > 0 && (
        <details className="lain">
          <summary className="cap-strong">{po.billing.dokumen.length} dokumen lain memakai P.O ini</summary>
          {po.billing.dokumen.map((d) => (
            <div className="doc-mini" key={d.idTrx}>
              <span><span className="num">{d.idTrx}</span> · {d.noInvoice} · {d.jenis}</span>
              <span className="num">{rupiah(d.amount)} <StatusPill status={d.status} /></span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
