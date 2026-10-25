'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { amankanSel, keCsv } from '@/domain/odoo';
import { api, errMessage } from './api';
import { Chips, Field, Pesan, Skeleton } from './kit';
import { unduhTeks } from './unduh';

type Tab = 'aging' | 'rekap' | 'bayar' | 'audit';
type Dimensi = 'brand' | 'dept' | 'coa' | 'vendor';
interface Aging {
  hariIni: string; basi: boolean; totalSisa: number;
  baris: { id: string; vendor: string; brand: string; dept: string; status: string; dueDate: string; hariLewat: number | null; bucket: string; total: number; dibayar: number; sisa: number }[];
  perBucket: { bucket: string; jumlah: number; sisa: number }[];
  perVendor: { vendor: string; jumlah: number; sisa: number; terlama: number | null }[];
}
interface Rekap { basi: boolean; baris: { kunci: string; jumlah: number; total: number; dibayar: number; sisa: number }[]; total: { jumlah: number; total: number; dibayar: number; sisa: number } }
interface Bayar { basi: boolean; total: number; baris: { logId: string; tgl: string; idTrx: string; vendor: string; brand: string; nominal: number; sumber: string; ref: string; oleh: string }[] }
interface Audit { basi: boolean; cocok: number; baris: { logId: string; waktu: string; idTrx: string; aktor: string; aksi: string; field: string; lama: string; baru: string; catatan: string }[] }

const rp = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const csv = (header: string[], rows: (string | number)[][]): string => keCsv([header, ...rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : amankanSel(c))))]);
const DIMENSI: { nilai: Dimensi; teks: string }[] = [{ nilai: 'brand', teks: 'Brand' }, { nilai: 'dept', teks: 'Departemen' }, { nilai: 'coa', teks: 'COA' }, { nilai: 'vendor', teks: 'Vendor' }];
const qs = (o: Record<string, string>): string => new URLSearchParams(Object.entries(o).filter(([, v]) => v.trim() !== '')).toString();
const Basi = ({ basi }: { basi: boolean }) => (basi ? <Pesan jenis="warn">Sheets sedang sibuk — data dari salinan beberapa menit lalu.</Pesan> : null);

/** F3-D: laporan AP (aging, rekap periode, log pembayaran) + viewer Audit_Log. Semua baca-saja; CSV di-escape terhadap formula. */
export function HalamanLaporan({ bisaAudit, hariIni, awalBulan }: { bisaAudit: boolean; hariIni: string; awalBulan: string }) {
  const [tab, setTab] = useState<Tab>('aging');
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(hariIni);
  const [dimensi, setDimensi] = useState<Dimensi>('brand');
  const [aging, setAging] = useState<Aging | null>(null);
  const [rekap, setRekap] = useState<Rekap | null>(null);
  const [bayar, setBayar] = useState<Bayar | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [fa, setFa] = useState({ id: '', aktor: '', aksi: '', dari: '', sampai: '' });

  const [dimRekap, setDimRekap] = useState<Dimensi>('brand'); // dimensi data rekap yang sedang tampil
  const urutRekap = useRef(0); // abaikan respons rekap yang kalah cepat (ganti kelompok berturut-turut)
  const muat = useCallback(async (t: Tab, dim: Dimensi = dimensi) => {
    setSibuk(true); setGalat(null);
    try {
      if (t === 'aging') setAging(await api<Aging>('/api/laporan/aging', { method: 'GET' }));
      if (t === 'rekap') {
        const ke = ++urutRekap.current;
        const r = await api<Rekap>(`/api/laporan/rekap?${qs({ dari, sampai, dimensi: dim })}`, { method: 'GET' });
        if (ke === urutRekap.current) { setRekap(r); setDimRekap(dim); }
      }
      if (t === 'bayar') setBayar(await api<Bayar>(`/api/laporan/pembayaran?${qs({ dari, sampai })}`, { method: 'GET' }));
      if (t === 'audit') setAudit(await api<Audit>(`/api/audit?${qs(fa)}`, { method: 'GET' }));
    } catch (e) { setGalat(errMessage(e)); }
    finally { setSibuk(false); }
  }, [dari, sampai, dimensi, fa]);
  useEffect(() => { if (tab === 'aging' && !aging) void muat('aging'); }, [tab, aging, muat]);

  const tabs = useMemo(() => [
    { nilai: 'aging' as const, teks: 'Aging AP' }, { nilai: 'rekap' as const, teks: 'Per periode' }, { nilai: 'bayar' as const, teks: 'Log pembayaran' },
    ...(bisaAudit ? [{ nilai: 'audit' as const, teks: 'Audit log' }] : []),
  ], [bisaAudit]);
  const rentang = (
    <>
      <Field label="Dari" id="l-dari">{(p) => <input {...p} type="date" value={dari} onChange={(e) => setDari(e.target.value)} />}</Field>
      <Field label="Sampai" id="l-sampai">{(p) => <input {...p} type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />}</Field>
    </>
  );

  return (
    <>
      <div className="toolbar"><h1 className="page-h">Laporan</h1></div>
      <Chips label="Laporan" labelTersembunyi kecil segmen nilai={tab} onPilih={(t) => { setTab(t); setGalat(null); }} pilihan={tabs} />
      {galat && <Pesan jenis="err">{galat}</Pesan>}

      {tab === 'aging' && (
        <section className="kartu">
          <div className="toolbar-sub"><h2 className="kartu-t">Aging hutang usaha</h2>
            <span className="aksi-sel">
              <button type="button" className="btn btn-secondary btn-sm" disabled={sibuk} onClick={() => void muat('aging')}>Muat ulang</button>
              {aging && <button type="button" className="btn btn-secondary btn-sm" onClick={() => unduhTeks(`aging-ap-${aging.hariIni}.csv`, csv(['ID', 'Vendor', 'Brand', 'Dept', 'Status', 'Jatuh tempo', 'Hari lewat', 'Kelompok', 'Nominal', 'Dibayar', 'Sisa'], aging.baris.map((b) => [b.id, b.vendor, b.brand, b.dept, b.status, b.dueDate, b.hariLewat ?? '', b.bucket, b.total, b.dibayar, b.sisa])))}>Unduh CSV</button>}
            </span></div>
          <p className="muted cap">Dokumen yang sudah disetujui Manager dan belum lunas. Sisa = nominal akhir − pembayaran di Trx_Payment_Log. Umur dihitung dari jatuh tempo (WIB).</p>
          {!aging ? <Skeleton baris={4} /> : (
            <>
              <Basi basi={aging.basi} />
              <dl className="lap-ringkas">
                <div><dt>Total sisa</dt><dd className="num">{rp(aging.totalSisa)}</dd></div>
                {aging.perBucket.filter((b) => b.jumlah > 0).map((b) => <div key={b.bucket}><dt>{b.bucket} · {b.jumlah} dok</dt><dd className="num">{rp(b.sisa)}</dd></div>)}
              </dl>
              <h3 className="ds-h">Outstanding per vendor</h3>
              <div className="tabel-gulir"><table className="tabel">
                <thead><tr><th>Vendor</th><th className="num">Dokumen</th><th className="num">Lewat terlama</th><th className="num">Sisa</th></tr></thead>
                <tbody>{aging.perVendor.map((v) => <tr key={v.vendor}><td>{v.vendor}</td><td className="num">{v.jumlah}</td><td className="num">{v.terlama !== null && v.terlama > 0 ? `${v.terlama} hari` : '—'}</td><td className="num">{rp(v.sisa)}</td></tr>)}</tbody>
              </table></div>
              <h3 className="ds-h">Rincian dokumen</h3>
              <div className="tabel-gulir"><table className="tabel">
                <thead><tr><th>ID</th><th>Vendor</th><th>Jatuh tempo</th><th>Kelompok</th><th className="num">Sisa</th></tr></thead>
                <tbody>{aging.baris.map((b) => <tr key={b.id}><td className="kode"><a href={`/pengajuan/${encodeURIComponent(b.id)}`}>{b.id}</a></td><td>{b.vendor}<div className="muted cap">{b.brand} / {b.dept} · {b.status}</div></td><td className="kode">{b.dueDate || '—'}</td><td>{b.bucket}{b.hariLewat !== null && b.hariLewat > 0 ? ` (${b.hariLewat} hr)` : ''}</td><td className="num">{rp(b.sisa)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </section>
      )}

      {tab === 'rekap' && (
        <section className="kartu">
          <h2 className="kartu-t">Rekap per periode</h2>
          <div className="lap-filter">{rentang}<button type="button" className="btn btn-primary btn-sm" disabled={sibuk} onClick={() => void muat('rekap')}>{sibuk ? 'Memuat…' : 'Tampilkan'}</button></div>
          <Chips label="Kelompokkan per" kecil segmen nilai={dimensi} onPilih={(d) => { setDimensi(d); void muat('rekap', d); }} pilihan={DIMENSI} />
          <p className="muted cap">Dokumen yang sudah diajukan (bukan draft/ditolak), difilter tanggal invoice (kosong → tanggal submit) — sama dengan export Odoo.</p>
          {rekap && (
            <>
              <Basi basi={rekap.basi} />
              <div className="toolbar-sub"><span /><button type="button" className="btn btn-secondary btn-sm" onClick={() => unduhTeks(`rekap-${dimRekap}-${dari}-${sampai}.csv`, csv([DIMENSI.find((x) => x.nilai === dimRekap)!.teks, 'Dokumen', 'Nominal', 'Dibayar', 'Sisa'], [...rekap.baris.map((b) => [b.kunci, b.jumlah, b.total, b.dibayar, b.sisa]), ['Total', rekap.total.jumlah, rekap.total.total, rekap.total.dibayar, rekap.total.sisa]]))}>Unduh CSV</button></div>
              <div className="tabel-gulir"><table className="tabel">
                <thead><tr><th>{DIMENSI.find((x) => x.nilai === dimRekap)!.teks}</th><th className="num">Dokumen</th><th className="num">Nominal</th><th className="num">Dibayar</th><th className="num">Sisa</th></tr></thead>
                <tbody>{rekap.baris.map((b) => <tr key={b.kunci}><td>{b.kunci}</td><td className="num">{b.jumlah}</td><td className="num">{rp(b.total)}</td><td className="num">{rp(b.dibayar)}</td><td className="num">{rp(b.sisa)}</td></tr>)}</tbody>
                <tfoot><tr><td>Total</td><td className="num">{rekap.total.jumlah}</td><td className="num">{rp(rekap.total.total)}</td><td className="num">{rp(rekap.total.dibayar)}</td><td className="num">{rp(rekap.total.sisa)}</td></tr></tfoot>
              </table></div>
            </>
          )}
        </section>
      )}

      {tab === 'bayar' && (
        <section className="kartu">
          <h2 className="kartu-t">Log pembayaran</h2>
          <div className="lap-filter">{rentang}<button type="button" className="btn btn-primary btn-sm" disabled={sibuk} onClick={() => void muat('bayar')}>{sibuk ? 'Memuat…' : 'Tampilkan'}</button></div>
          {bayar && (
            <>
              <Basi basi={bayar.basi} />
              <div className="toolbar-sub"><span className="muted cap">{bayar.baris.length} transfer · {rp(bayar.total)}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => unduhTeks(`pembayaran-${dari}-${sampai}.csv`, csv(['Log ID', 'Tanggal', 'ID Trx', 'Vendor', 'Brand', 'Nominal', 'Rekening sumber', 'Ref', 'Oleh'], bayar.baris.map((b) => [b.logId, b.tgl, b.idTrx, b.vendor, b.brand, b.nominal, b.sumber, b.ref, b.oleh])))}>Unduh CSV</button></div>
              <div className="tabel-gulir"><table className="tabel">
                <thead><tr><th>Tanggal</th><th>Dokumen</th><th>Rekening sumber</th><th className="num">Nominal</th></tr></thead>
                <tbody>{bayar.baris.map((b) => <tr key={b.logId}><td className="kode">{b.tgl}</td><td><a href={`/pengajuan/${encodeURIComponent(b.idTrx)}`}>{b.idTrx}</a><div className="muted cap">{b.vendor}{b.ref ? ` · ref ${b.ref}` : ''}</div></td><td>{b.sumber || '—'}</td><td className="num">{rp(b.nominal)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </section>
      )}

      {tab === 'audit' && bisaAudit && (
        <section className="kartu">
          <h2 className="kartu-t">Audit log (baca saja)</h2>
          <form className="lap-filter" onSubmit={(e) => { e.preventDefault(); void muat('audit'); }}>
            <Field label="ID dokumen" id="a-id">{(p) => <input {...p} value={fa.id} maxLength={40} onChange={(e) => setFa({ ...fa, id: e.target.value })} />}</Field>
            <Field label="Aktor (email)" id="a-aktor">{(p) => <input {...p} value={fa.aktor} maxLength={160} onChange={(e) => setFa({ ...fa, aktor: e.target.value })} />}</Field>
            <Field label="Aksi" id="a-aksi">{(p) => <input {...p} value={fa.aksi} maxLength={60} placeholder="mis. PAYMENT" onChange={(e) => setFa({ ...fa, aksi: e.target.value })} />}</Field>
            <Field label="Dari" id="a-dari">{(p) => <input {...p} type="date" value={fa.dari} onChange={(e) => setFa({ ...fa, dari: e.target.value })} />}</Field>
            <Field label="Sampai" id="a-sampai">{(p) => <input {...p} type="date" value={fa.sampai} onChange={(e) => setFa({ ...fa, sampai: e.target.value })} />}</Field>
            <button type="submit" className="btn btn-primary btn-sm" disabled={sibuk}>{sibuk ? 'Mencari…' : 'Cari'}</button>
          </form>
          {audit && (
            <>
              <Basi basi={audit.basi} />
              <p className="muted cap">{audit.cocok} baris cocok{audit.cocok > audit.baris.length ? ` — ditampilkan ${audit.baris.length} terbaru; persempit filter` : ''}.</p>
              <div className="tabel-gulir"><table className="tabel">
                <thead><tr><th>Waktu</th><th>Aksi</th><th>Dokumen</th><th>Aktor</th><th>Perubahan</th></tr></thead>
                <tbody>{audit.baris.map((b) => <tr key={b.logId}><td className="kode">{b.waktu}</td><td>{b.aksi}<div className="muted cap">{b.field}</div></td><td className="kode">{b.idTrx}</td><td>{b.aktor}</td><td className="cap">{b.lama || b.baru ? <>{b.lama && <span className="muted">{b.lama} → </span>}{b.baru}</> : null}{b.catatan && <div className="muted">{b.catatan}</div>}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </section>
      )}
    </>
  );
}
