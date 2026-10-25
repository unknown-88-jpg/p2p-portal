import { notFound } from 'next/navigation';
import { rupiah } from '@/domain/pengajuan-form';
import { AppError } from '@/lib/errors';
import { voucher } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { AppNav } from '@/ui/AppNav';
import { VoucherAksi } from '@/ui/VoucherAksi';
import { wajibSesi } from '../../../_lib/sesi';
import { propsNav } from '../../../_lib/nav';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { return { title: `Voucher ${decodeURIComponent((await params).id).slice(0, 20)}` }; }

const isi = (v: string | null | undefined): string => (v && v.trim() ? v : '-');
const Meta = ({ l, children, kelas }: { l: string; children: React.ReactNode; kelas?: string }) => (
  <div className={`pv-meta${kelas ? ` ${kelas}` : ''}`}><div className="pv-l">{l}</div><div className="pv-v">{children}</div></div>
);

/** Voucher cetak A4 — tata letak mengikuti template Print_Form.html (2026-10-25). I13: pemilik, Manager berwenang, Finance+. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await wajibSesi();
  const { id } = await params;
  let v;
  try { v = await voucher(authDeps(), s, decodeURIComponent(id)); }
  catch (e) { if (e instanceof AppError && e.code === 'NOT_FOUND') notFound(); throw e; }
  const rincian: [string, string, string?][] = [
    ['Nilai invoice', rupiah(v.invoiceAmount)],
    ['Diskon', rupiah(v.diskon), 'merah'],
    ['Biaya lain', rupiah(v.biayaLainnya)],
    [`PPN (${isi(v.statusPPN)})`, rupiah(v.ppnAmount)],
    [`Potongan PPh (${v.jenisPPh && v.jenisPPh !== '-' ? v.jenisPPh : '-'})`, rupiah(v.pphAmount), 'merah'],
  ];
  return (
    <>
      <AppNav nama={s.nama} {...await propsNav(s)} aktif="pengajuan" />
    <main className="vc-wrap">
      <h1 className="page-h no-print">Voucher {v.id}</h1>
      <VoucherAksi id={v.id} punyaLampiran={v.punyaLampiran}>
      <section className="vc pv">
        <header className="pv-kepala">
          <div><div className="pv-co">{isi(v.company)}</div><span className="pv-brand">{isi(v.brand)}</span></div>
          <div className="pv-judul-r">
            <div className="pv-judul">Payment Voucher</div>
            <div className="pv-kecil">ID <b className="pv-id">{v.id}</b></div>
            <div className="pv-kecil">Diajukan {isi(v.tanggal)}</div>
          </div>
        </header>

        <div className="pv-baris3">
          <Meta l="Departemen">{isi(v.departement)}</Meta>
          <Meta l="PIC pengaju">{isi(v.pic)}</Meta>
          <Meta l="Tipe & jenis bayar">{isi(v.tipe)} · {isi(v.jenisPembayaran)}</Meta>
          <Meta l="Event / project" kelas="pv-penuh">{isi(v.eventProject)}</Meta>
        </div>

        <div className="pv-kotak">
          <div className="pv-l pv-kotak-h">Vendor &amp; tagihan</div>
          <div className="pv-baris2">
            <Meta l="Penerima">{isi(v.vendorNama)}<div className="pv-sub">NPWP {isi(v.npwp)}</div></Meta>
            <Meta l="Tujuan transfer"><span className="pv-bank">{isi(v.bank)}</span>
              <div className="pv-rek"><span className="num">{isi(v.noRekening)}</span> <span className="pv-an">a.n.</span> {isi(v.namaRekening)}</div></Meta>
          </div>
          <div className="pv-baris4">
            <Meta l="Nomor P.O">{isi(v.poNumber)}</Meta>
            <Meta l="Nomor invoice">{isi(v.noInvoice)}</Meta>
            <Meta l="Tanggal invoice">{isi(v.dateInvoice)}</Meta>
            <Meta l="Jatuh tempo" kelas="pv-merah">{isi(v.dueDate)}</Meta>
          </div>
        </div>

        <div className="pv-l pv-seksi">Rincian pembayaran</div>
        <table className="pv-rincian">
          <thead><tr><th scope="col">Deskripsi</th><th scope="col" className="kanan">Komponen</th><th scope="col" className="kanan">Nominal (IDR)</th></tr></thead>
          <tbody>
            {rincian.map(([k, n, nada], i) => (
              <tr key={k}>
                {i === 0 && (
                  <td rowSpan={rincian.length + 1} className="pv-desk">
                    <div className="pv-desk-t">{isi(v.description)}</div>
                    <div className="pv-catatan"><b>Catatan PIC:</b><br />{isi(v.notesUser)}</div>
                  </td>
                )}
                <td className="kanan pv-komp">{k}</td><td className={`kanan num pv-nom${nada ? ` ${nada}` : ''}`}>{n}</td>
              </tr>
            ))}
            <tr className="pv-total"><td className="kanan">Total netto dibayarkan</td><td className="kanan num">{rupiah(v.nominal)}</td></tr>
          </tbody>
        </table>

        {v.coa && (
          <div className="pv-coa">
            <div className="pv-coa-h"><span className="pv-badge-jurnal">Terjurnal oleh Finance</span></div>
            <div className="pv-coa-akun">Akun: <u>{v.coa.sub}</u></div>
            <div className="pv-sub">Kategori {isi(v.coa.kategori)} · Group {isi(v.coa.head)}</div>
          </div>
        )}

        {v.pembayaran.length > 0 && (
          <>
            <div className="pv-l pv-seksi">Riwayat pembayaran</div>
            <table className="pv-rincian pv-bayar">
              <thead><tr><th scope="col">Tanggal</th><th scope="col">Rekening sumber</th><th scope="col">Ref</th><th scope="col" className="kanan">Nominal</th></tr></thead>
              <tbody>{v.pembayaran.map((p, i) => <tr key={i}><td>{p.tgl}</td><td>{isi(p.sumber)}</td><td>{isi(p.ref)}</td><td className="kanan num">{rupiah(p.nominal)}</td></tr>)}</tbody>
            </table>
          </>
        )}

        <div className="pv-ttd-wrap">
          {v.ttd.length === 0 ? <div className="pv-ttd-kosong">Struktur tanda tangan untuk brand/divisi ini belum diatur di Master_User_TTD.</div> : (
            <div className="pv-ttd">
              {v.ttd.map((t) => (
                <div key={t.level} className="pv-sig">
                  <div><div className="pv-role">{t.role}</div><div className="pv-tgl">Tanggal: ....................</div></div>
                  <div className="pv-area">
                    {t.isSigned
                      ? <div className={`pv-stempel${t.method === 'WET' ? ' basah' : ''}`}><div className="pv-stempel-t">{t.method === 'WET' ? 'TTD basah terverifikasi' : 'Disetujui secara digital'}</div><div className="pv-stempel-s">{t.method === 'WET' ? '' : 'E-Signed · '}{t.signedAt}</div></div>
                      : <span className="pv-tunggu">{t.label}</span>}
                  </div>
                  <div><div className="pv-nama" title={t.nama}>{t.nama}</div><div className="pv-jab" title={t.jabatan}>{t.jabatan}</div></div>
                </div>
              ))}
            </div>
          )}
          <p className="pv-cfo">{v.perluCFO ? `Nominal ≥ ${rupiah(v.ambangCFO)} — persetujuan CFO wajib sebelum pembayaran dapat dicairkan.` : `Nominal di bawah ${rupiah(v.ambangCFO)} — persetujuan CFO tidak diperlukan.`}</p>
        </div>
        <footer className="pv-f">Dicetak {v.dicetak} WIB</footer>
      </section>
      </VoucherAksi>
    </main>
    </>
  );
}
