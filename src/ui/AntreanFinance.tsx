'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KunciTahap, RingkasTahap } from '@/domain/finance';
import { rupiah } from '@/domain/pengajuan-form';
import { api, errMessage } from './api';
import { Pesan, Skeleton, StatusPill } from './kit';
import { IkonKlip } from './icons';
import { LampiranPopup } from './LampiranPopup';
import { FormVerifikasiPajak } from './FormVerifikasiPajak';
import { FormPersetujuanFinance, type Peran } from './FormPersetujuanFinance';
import { FormJurnal } from './FormJurnal';

interface Item {
  id: string; tahap: KunciTahap; status: string; tanggal: string; brand: string; departement: string; tipe: string; pic: string;
  vendorNama: string; noInvoice: string; poNumber: string; description: string; dueDate: string; jatuhTempoLewat: boolean;
  statusPPN: string; dpp: number; ppnAmount: number; jenisPPh: string; pphAmount: number; nominal: number; totalPaid: number; sisa: number;
  perluCFO: boolean; punyaLampiran: boolean; umurHari: number | null; ajuanSendiri: boolean;
  etag: string; invoiceAmount: number; diskon: number; biayaLainnya: number; punyaNPWP: boolean; jenisPembayaran: string;
  persetujuan?: { finMgr: string | null; cfo: string | null; finMgrSaya: boolean };
}
interface Data { tahap: RingkasTahap[]; items: Item[]; basi: boolean; peran: Peran }
type Urut = 'umur' | 'jatuh-tempo' | 'nominal';

const Info = ({ l, v }: { l: string; v: string }) => (v ? <div><dt>{l}</dt><dd>{v}</dd></div> : null);
const umurTeks = (h: number | null): string => (h === null ? '' : h === 0 ? 'hari ini' : `${h} hari`);
const angka = (i: Item): number => (i.tahap === 'bayar' ? i.sisa : i.nominal);
const URUT: Record<Urut, (a: Item, b: Item) => number> = {
  umur: (a, b) => (b.umurHari ?? -1) - (a.umurHari ?? -1),
  'jatuh-tempo': (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
  nominal: (a, b) => angka(b) - angka(a),
};
/** Langkah aksi tiap tahap dibangun bertahap (F2-B..F2-E); sampai itu panel menampilkan informasi saja. */
const AKSI_MENYUSUL: Record<KunciTahap, string> = {
  pajak: 'Verifikasi pajak', persetujuan: 'Persetujuan Fin. Mgr / CFO (e-approve)',
  jurnal: 'Jurnal COA', bayar: 'Pembayaran',
};

export function AntreanFinance({ tahapAwal }: { tahapAwal?: KunciTahap | undefined }) {
  const [data, setData] = useState<Data | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [tahap, setTahap] = useState<KunciTahap>(tahapAwal ?? 'pajak');
  const [q, setQ] = useState('');
  const [urut, setUrut] = useState<Urut>('umur');
  const [sel, setSel] = useState<string | null>(null);
  const [detailHP, setDetailHP] = useState(false);
  const [info, setInfo] = useState<{ jenis: 'ok' | 'warn'; teks: string } | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());

  const muat = useCallback(async () => {
    try { setData(await api<Data>('/api/finance/queues', { method: 'GET' })); setGalat(null); }
    catch (e) { setGalat(errMessage(e)); }
  }, []);
  useEffect(() => { void muat(); }, [muat]);

  const pilihTahap = (t: KunciTahap) => {
    setTahap(t); setSel(null); setDetailHP(false); setPilih(new Set());
    try { window.history.replaceState(null, '', `/finance?tahap=${t}`); } catch { /* abaikan */ }
  };
  const tampil = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    return data.items.filter((i) => i.tahap === tahap && (!t || [i.id, i.vendorNama, i.noInvoice, i.poNumber, i.pic, i.brand, i.departement].some((s) => s.toLowerCase().includes(t))))
      .sort(URUT[urut]);
  }, [data, tahap, q, urut]);

  const kepala = <div className="inbox-top"><h1 className="page-h">Antrean Finance</h1></div>;
  if (galat && !data) return <>{kepala}<Pesan jenis="err">{galat} <button type="button" className="link" onClick={() => void muat()}>Coba lagi</button></Pesan></>;
  if (!data) return <>{kepala}<Skeleton baris={4} /></>;

  const ring = data.tahap.find((t) => t.kunci === tahap)!;
  const selesai = (p: { jenis: 'ok' | 'warn'; teks: string }, ulang: boolean) => { setInfo(p); setSel(null); setDetailHP(false); setPilih(new Set()); if (ulang) void muat(); };
  const bisaPilih = tahap === 'jurnal' && ring.bisaAksi;
  const cur = tampil.find((i) => i.id === sel) ?? (!detailHP ? tampil[0] ?? null : null);

  return (
    <>
      {kepala}
      {info && <Pesan jenis={info.jenis}>{info.teks}</Pesan>}
      {data.basi && <Pesan jenis="warn">Data mungkin belum terbaru (Google Sheets sedang lambat). Angka di bawah dari salinan beberapa menit lalu. <button type="button" className="link" onClick={() => void muat()}>Muat ulang</button></Pesan>}
      <div className="fin-tahap" role="tablist" aria-label="Tahap Finance">
        {data.tahap.map((t) => (
          <button key={t.kunci} type="button" role="tab" aria-selected={t.kunci === tahap} className={`fin-tab${t.kunci === tahap ? ' aktif' : ''}`} onClick={() => pilihTahap(t.kunci)}>
            <span className="fin-tab-l">{t.label}</span>
            <span className="fin-tab-n num">{t.jumlah}</span>
            <span className="fin-tab-s num">{t.jumlah ? rupiah(t.total) : 'Kosong'}</span>
          </button>
        ))}
      </div>
      <p className="muted cap fin-ringkas">
        {ring.jumlah} dokumen · {ring.kunci === 'bayar' ? 'sisa tagihan' : 'total'} {rupiah(ring.total)}{ring.tertuaHari !== null ? ` · tertua ${umurTeks(ring.tertuaHari)}` : ''} · dikerjakan {ring.aktor}{ring.bisaAksi ? '' : ' (Anda hanya melihat)'}
      </p>

      {ring.jumlah === 0 ? (
        <div className="kosong" role="status"><h2>Tidak ada dokumen di tahap ini</h2><p className="muted">Dokumen akan muncul di sini setelah tahap sebelumnya selesai.</p></div>
      ) : (
        <>
        <div className="fin-alat">
          <div className="cari"><input type="search" aria-label="Cari di antrean" placeholder="Cari ID, vendor, invoice, PIC" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <label className="fin-urut"><span className="sr-only">Urutkan</span>
            <select value={urut} onChange={(e) => setUrut(e.target.value as Urut)}>
              <option value="umur">Terlama di tahap</option><option value="jatuh-tempo">Jatuh tempo terdekat</option><option value="nominal">Nominal terbesar</option>
            </select>
          </label>
        </div>
        <div className="inbox-wrap"><div className={`inbox${detailHP ? ' hp-detail' : ''}`}>
          <section className="inbox-list" aria-label={ring.label}>
            {tampil.length === 0 ? <p className="muted" role="status">Tidak ada yang cocok dengan kata kunci.</p> : (
              <ul className="ib-daftar">
                {tampil.map((i) => (
                  <li key={i.id} className={`inbox-row${cur?.id === i.id ? ' aktif' : ''}`}>
                    <button type="button" className="ib-kartu" aria-current={cur?.id === i.id ? 'true' : undefined} onClick={() => { setSel(i.id); setDetailHP(true); }}>
                      <span className="ib-top"><span className="ib-id num"><span>{i.id}</span> · <span>{umurTeks(i.umurHari) || i.tanggal}</span></span>
                        <span className="fin-badges">{i.persetujuan?.finMgr && !i.persetujuan.cfo && i.perluCFO && <span className="badge-tunggu">Menunggu CFO</span>}{i.ajuanSendiri && <span className="badge-saya">Ajuan Anda</span>}{i.perluCFO && <span className="badge-cfo">CFO</span>}</span></span>
                      <span className="ib-v">{i.vendorNama || '—'}</span>
                      <span className="ib-n num">{rupiah(angka(i))}</span>
                      <span className={`ib-jt${i.jatuhTempoLewat ? ' lewat' : ''}`}>{i.dueDate ? `${i.jatuhTempoLewat ? 'Lewat jatuh tempo' : 'Jatuh tempo'} ${i.dueDate}` : ' '}</span>
                    </button>
                    {bisaPilih && <label className="pilih-tap"><input type="checkbox" className="pilih-cb" aria-label={`Pilih ${i.id} untuk jurnal sekaligus`} checked={pilih.has(i.id)}
                      onChange={(e) => setPilih((p) => { const n = new Set(p); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} /></label>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {cur && (
            <>
              <section className="inbox-detail" aria-label="Detail dokumen">
                <button type="button" className="link kembali" onClick={() => { setSel(null); setDetailHP(false); }}>← Kembali ke daftar</button>
                <div className="ds-kepala">
                  <div className="ds-vendor">
                    <h2 className="ds-nama">{cur.vendorNama || '—'}</h2>
                    <p className="ds-sub num">{cur.id} · {cur.tanggal}</p>
                  </div>
                  {cur.punyaLampiran ? <LampiranPopup id={cur.id} label="Lihat lampiran invoice" kelas="btn btn-secondary btn-sm" ikon={<IkonKlip />} /> : <span className="muted cap">Tidak ada lampiran</span>}
                </div>
                {cur.ajuanSendiri && cur.tahap === 'pajak' && <Pesan jenis="warn">Ini ajuan Anda sendiri. Verifikasi pajaknya harus dilakukan rekan Finance lain.</Pesan>}
                <div className="ds">
                  <h3 className="ds-h">Pengaju</h3>
                  <dl className="ds-grid"><Info l="Diajukan oleh" v={cur.pic} /><Info l="Brand / Departemen" v={[cur.brand, cur.departement].filter(Boolean).join(' / ')} /><Info l="Tipe" v={cur.tipe} /></dl>
                </div>
                <div className="ds">
                  <h3 className="ds-h">Dokumen</h3>
                  <dl className="ds-grid">
                    <Info l="Keperluan" v={cur.description} /><Info l="No. Invoice" v={cur.noInvoice} />
                    <Info l="No. P.O" v={cur.poNumber !== '-' ? cur.poNumber : ''} /><Info l="Jatuh tempo" v={cur.dueDate} />
                  </dl>
                </div>
                <a className="link" href={`/pengajuan/${encodeURIComponent(cur.id)}`}>Buka detail lengkap & riwayat →</a>
              </section>

              <aside className="inbox-aksi" aria-label="Rincian">
                <div className="fin-st"><StatusPill status={cur.status} /></div>
                <span className="ds-l">{cur.tahap === 'bayar' ? 'Sisa tagihan' : 'Nominal akhir'}</span>
                <div className="ip-angka num">{rupiah(angka(cur))}</div>
                {!(cur.tahap === 'pajak' && ring.bisaAksi) && <dl className="ip-rincian">
                  {cur.dpp > 0 && <div><dt>DPP</dt><dd className="num">{rupiah(cur.dpp)}</dd></div>}
                  {cur.ppnAmount > 0 && <div><dt>PPN</dt><dd className="num">{rupiah(cur.ppnAmount)}</dd></div>}
                  {cur.pphAmount > 0 && <div><dt>PPh {cur.jenisPPh !== '-' ? cur.jenisPPh : ''}</dt><dd className="num">- {rupiah(cur.pphAmount)}</dd></div>}
                  {cur.totalPaid > 0 && <div><dt>Sudah dibayar</dt><dd className="num">{rupiah(cur.totalPaid)}</dd></div>}
                  <div className="ip-total"><dt>Nominal akhir</dt><dd className="num">{rupiah(cur.nominal)}</dd></div>
                </dl>}
                {cur.perluCFO && <p className="cap"><span className="badge-cfo">Butuh persetujuan CFO</span></p>}
                {cur.tahap === 'pajak' && ring.bisaAksi
                  ? <FormVerifikasiPajak key={`${cur.id}|${cur.etag}`} dok={cur} onSelesai={selesai} />
                  : cur.tahap === 'jurnal' && ring.bisaAksi
                  ? <FormJurnal key="jurnal" target={pilih.size ? data.items.filter((i) => pilih.has(i.id)) : [cur]} onSelesai={selesai} />
                  : cur.tahap === 'persetujuan' && (data.peran.finMgr || data.peran.cfo || data.peran.staff)
                  ? <FormPersetujuanFinance key={`${cur.id}|${cur.etag}`} dok={cur} peran={data.peran} onSelesai={selesai} />
                  : <p className="muted cap fin-menyusul">{ring.bisaAksi ? <>Aksi &ldquo;{AKSI_MENYUSUL[cur.tahap]}&rdquo; tersedia di pembaruan berikutnya.</> : <>Tahap ini dikerjakan {ring.aktor}. Anda hanya melihat.</>}</p>}
              </aside>
            </>
          )}
        </div></div>
        </>
      )}
    </>
  );
}
