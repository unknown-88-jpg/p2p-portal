import { notFound } from 'next/navigation';
import { can } from '@/domain/capabilities';
import { rupiah } from '@/domain/pengajuan-form';
import { AppError } from '@/lib/errors';
import { voucher } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { VoucherAksi } from '@/ui/VoucherAksi';
import { wajibSesi } from '../../../_lib/sesi';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { return { title: `Voucher ${decodeURIComponent((await params).id).slice(0, 20)}` }; }

const Brs = ({ k, v }: { k: string; v: string }) => <tr><th scope="row">{k}</th><td>{v || '-'}</td></tr>;

/** Voucher cetak A4 (paritas Print_Form.html). I13: pemilik, Manager berwenang, Finance+. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await wajibSesi();
  const { id } = await params;
  let v;
  try { v = await voucher(authDeps(), s, decodeURIComponent(id)); }
  catch (e) { if (e instanceof AppError && e.code === 'NOT_FOUND') notFound(); throw e; }
  const pph = v.pphAmount > 0 ? `${v.jenisPPh} — ${rupiah(v.pphAmount)}` : '-';
  return (
    <>
      <AppNav nama={s.nama} bisaAjukan={can(s.roles, 'pengajuan.write')} bisaSetujui={can(s.roles, 'approve.manager')} aktif="pengajuan" />
    <main className="vc-wrap">
      <h1 className="page-h no-print">Voucher {v.id}</h1>
      <VoucherAksi id={v.id} punyaLampiran={v.punyaLampiran} />
      <section className="vc">
        <header className="vc-h">
          <div><div className="vc-co">{v.company || '-'}</div><div className="vc-sub">Payment Voucher</div></div>
          <div className="vc-id"><b>{v.id}</b><div>{v.tanggal}</div><div>{v.status}</div></div>
        </header>
        <div className="vc-grid">
          <table className="vc-t"><tbody>
            <Brs k="Brand / Dept" v={`${v.brand} / ${v.departement}`} /><Brs k="Tipe" v={v.tipe} /><Brs k="PIC" v={v.pic} />
            <Brs k="Keperluan" v={v.description} /><Brs k="Event / Project" v={v.eventProject} /><Brs k="P.O" v={v.poNumber} /><Brs k="Catatan" v={v.notesUser} />
          </tbody></table>
          <table className="vc-t"><tbody>
            <Brs k="Vendor" v={v.vendorNama} /><Brs k="NPWP" v={v.npwp} /><Brs k="Bank" v={v.bank} /><Brs k="Atas nama" v={v.namaRekening} /><Brs k="No. rekening" v={v.noRekening} />
            <Brs k="No. invoice" v={v.noInvoice} /><Brs k="Tgl invoice" v={v.dateInvoice} /><Brs k="Jatuh tempo" v={v.dueDate} /><Brs k="Pembayaran" v={v.jenisPembayaran} />
          </tbody></table>
        </div>
        <table className="vc-t vc-uang"><tbody>
          <Brs k="Nominal invoice" v={rupiah(v.invoiceAmount)} />
          {v.diskon > 0 && <Brs k="Diskon" v={`- ${rupiah(v.diskon)}`} />}
          {v.biayaLainnya > 0 && <Brs k="Biaya lain" v={rupiah(v.biayaLainnya)} />}
          <Brs k="DPP" v={rupiah(v.dpp)} /><Brs k={`PPN (${v.statusPPN})`} v={rupiah(v.ppnAmount)} /><Brs k="PPh" v={pph} />
          <tr className="vc-total"><th scope="row">Total dibayar</th><td>{rupiah(v.nominal)}</td></tr>
        </tbody></table>
        {v.coa && <div className="vc-box"><b>Jurnal COA</b> — {v.coa.kategori} › {v.coa.head} › {v.coa.sub}</div>}
        {v.pembayaran.length > 0 && (
          <table className="vc-t vc-bayar"><thead><tr><th>Tgl bayar</th><th>Nominal</th><th>Sumber</th><th>Ref</th></tr></thead>
            <tbody>{v.pembayaran.map((p, i) => <tr key={i}><td>{p.tgl}</td><td>{rupiah(p.nominal)}</td><td>{p.sumber || '-'}</td><td>{p.ref || '-'}</td></tr>)}</tbody></table>
        )}
        <p className="vc-cfo">{v.perluCFO ? `Nominal ≥ ${rupiah(v.ambangCFO)} — tanda tangan basah CFO wajib sebelum dibayar.` : `Nominal di bawah ${rupiah(v.ambangCFO)} — tanda tangan CFO tidak diperlukan.`}</p>
        <div className="vc-ttd">
          {v.ttd.map((t) => (
            <div key={t.level} className="vc-kotak">
              <div className="vc-role">{t.role}</div><div className="vc-tgl">Tanggal: ....................</div>
              <div className={`vc-sign${t.isSigned ? ' ok' : ''}`}>{t.isSigned ? (t.method === 'WET' ? '✔' : '✔ E-Signed') : ''}<span>{t.label}{t.signedAt ? ` · ${t.signedAt}` : ''}</span></div>
              <div className="vc-nm">{t.nama}</div><div className="vc-jb">{t.jabatan}</div>
            </div>
          ))}
        </div>
        <footer className="vc-f">Dicetak {v.dicetak} WIB</footer>
      </section>
    </main>
    </>
  );
}
