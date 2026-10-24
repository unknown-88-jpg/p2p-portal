'use client';
import { useEffect, useRef, useState } from 'react';
import { ALASAN_MAX, CATATAN_MAX, TEMPLATE_ALASAN } from '@/domain/approval';
import { alasanValid, catatanValid, pertahankanKunci, perluMuatUlang } from '@/domain/approval-ui';
import { angka, formatRibuan, parseRupiah, pilihKunci, rupiah, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, hasilDipulihkan, isApiError, PESAN_DIPULIHKAN } from './api';
import { IkonKlip, IkonPerhatian, IkonSelesai } from './icons';
import { Chips, Dialog, Field, Pemuat, Pesan, StatusPill, UangInput } from './kit';

export interface DokPajak {
  id: string; vendorNama: string; etag: string; invoiceAmount: number; diskon: number; biayaLainnya: number; statusPPN: string; jenisPPh: string;
  nominal: number; punyaNPWP: boolean; ajuanSendiri: boolean;
  status: string; tanggal: string; pic: string; brand: string; departement: string; tipe: string; description: string; noInvoice: string; dueDate: string; punyaLampiran: boolean;
}
interface Hitung { dpp: number; ppnAmount: number; pphAmount: number; pphRate: number; finalAmount: number }
type PPN = 'Include PPN' | 'Exclude PPN' | 'Non PPN';
const CFO_MIN = 5_000_000;
/** Ambang peringatan diskon besar (tampilan saja; tidak memblokir). */
const DISKON_BESAR = 0.2;
const teks = (n: number): string => (n > 0 ? formatRibuan(n) : '');
const baru = (): string => crypto.randomUUID();
const PENJELASAN_PPN: Record<PPN, string> = {
  'Non PPN': 'Non PPN: transaksi ini tidak dikenakan PPN.',
  'Include PPN': 'Include: nilai invoice sudah termasuk PPN (DPP dihitung mundur).',
  'Exclude PPN': 'Exclude: PPN ditambahkan di atas nilai invoice.',
};
const persen = (a: number, b: number): string => `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

/** Pratinjau lampiran di kolom kiri: gambar dimuat sebagai blob lewat proxy ber-otorisasi; PDF tidak bisa disematkan (CSP) -> tab baru. */
function PratinjauLampiran({ id }: { id: string }) {
  const [k, setK] = useState<'muat' | 'gambar' | 'pdf' | 'gagal'>('muat');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let batal = false, u: string | null = null;
    fetch(`/api/pengajuan/${encodeURIComponent(id)}/lampiran`, { credentials: 'same-origin' }).then(async (r) => {
      if (batal) return;
      const t = r.headers.get('content-type') ?? '';
      if (!r.ok) { setK('gagal'); await r.body?.cancel(); return; }
      if (t.startsWith('image/')) { u = URL.createObjectURL(await r.blob()); if (!batal) { setSrc(u); setK('gambar'); } }
      else { await r.body?.cancel(); setK(t === 'application/pdf' ? 'pdf' : 'gagal'); }
    }).catch(() => { if (!batal) setK('gagal'); });
    return () => { batal = true; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return (
    <div className="rv-lamp-isi" role="region" aria-label="Pratinjau lampiran" tabIndex={0}>
      {k === 'muat' && <Pemuat teks="Memuat lampiran…" />}
      {k === 'gambar' && src && <img src={src} alt={`Lampiran ${id}`} />}
      {k === 'pdf' && <p className="muted">Lampiran berupa PDF. Buka lewat <b>Tab baru</b> untuk mencocokkan angka.</p>}
      {k === 'gagal' && <p className="err-teks">Lampiran tidak dapat dimuat. Coba buka di tab baru.</p>}
    </div>
  );
}

/**
 * F2-B: ruang kerja verifikasi pajak (desain 2: header + info + lampiran | form | rincian & catatan + footer aksi).
 * Pratinjau memakai /api/calc/tax (tampilan); angka yang DISIMPAN dihitung ulang server dengan tarif PPh segar (I2).
 * Pengaju = pengguna ini -> Loloskan dikunci (I6).
 */
export function FormVerifikasiPajak({ dok, onSelesai, onKembali }: { dok: DokPajak; onSelesai: (pesan: { jenis: 'ok' | 'warn'; teks: string }, muatUlang: boolean) => void; onKembali: () => void }) {
  const [inv, setInv] = useState(teks(dok.invoiceAmount));
  const [diskon, setDiskon] = useState(teks(dok.diskon));
  const [biaya, setBiaya] = useState(teks(dok.biayaLainnya));
  const [ppn, setPpn] = useState<PPN>((['Include PPN', 'Exclude PPN', 'Non PPN'] as const).find((x) => x === dok.statusPPN) ?? 'Non PPN');
  const [pph, setPph] = useState(dok.jenisPPh && dok.jenisPPh !== '-' ? dok.jenisPPh : '-');
  const [notes, setNotes] = useState('');
  const [daftarPph, setDaftarPph] = useState<string[]>([]);
  const [hitung, setHitung] = useState<Hitung | null>(null);
  const [galatHitung, setGalatHitung] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | 'loloskan' | 'kembalikan'>(null);
  const [alasan, setAlasan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef<KunciIdem | null>(null);

  useEffect(() => {
    api<{ pph: { jenis: string }[] }>('/api/master/pph', { method: 'GET' }).then((r) => setDaftarPph(r.pph.map((p) => p.jenis))).catch(() => setDaftarPph([]));
  }, []);

  const angkaValid = [inv, diskon, biaya].every((v) => parseRupiah(v).ok) && angka(inv) > 0;
  useEffect(() => {
    if (!angkaValid) { setHitung(null); return; }
    const c = new AbortController();
    const t = setTimeout(() => {
      api<{ hasil: Hitung }>('/api/calc/tax', { body: { invAmount: angka(inv), diskon: angka(diskon), biayaLain: angka(biaya), statusPPN: ppn, jenisPPh: pph, npwpVendor: dok.punyaNPWP ? 'ada' : '' }, signal: c.signal })
        .then((r) => { setHitung(r.hasil); setGalatHitung(null); })
        .catch((e) => { if (!c.signal.aborted) { setHitung(null); setGalatHitung(errMessage(e)); } });
    }, 300);
    return () => { clearTimeout(t); c.abort(); };
  }, [inv, diskon, biaya, ppn, pph, angkaValid, dok.punyaNPWP]);

  const body = { etag: dok.etag, invAmount: angka(inv), diskon: angka(diskon), biayaLain: angka(biaya), statusPPN: ppn, jenisPPh: pph, ...(notes.trim() ? { notes: notes.trim() } : {}) };
  const kirim = async (jenis: 'loloskan' | 'kembalikan') => {
    if (sibuk) return;
    setSibuk(true); setGalat(null);
    const url = `/api/finance/${encodeURIComponent(dok.id)}/${jenis === 'loloskan' ? 'verifikasi-pajak' : 'kembalikan'}`;
    const isi = jenis === 'loloskan' ? body : { etag: dok.etag, alasan: alasan.trim() };
    kunci.current = pilihKunci(kunci.current, `${jenis}|${JSON.stringify(isi)}`, baru);
    try {
      const r = await api<{ hasil: { finalAmount?: number; perluCFO?: boolean } }>(url, { body: isi, headers: { 'idempotency-key': kunci.current.key } });
      if (hasilDipulihkan(r.hasil)) { kunci.current = null; setDlg(null); onSelesai({ jenis: 'warn', teks: PESAN_DIPULIHKAN }, true); return; }
      kunci.current = null; setDlg(null);
      onSelesai(jenis === 'loloskan'
        ? { jenis: 'ok', teks: `${dok.id} lolos verifikasi pajak. Nominal akhir ${rupiah(r.hasil.finalAmount ?? 0)}; berikutnya persetujuan Fin. Mgr${r.hasil.perluCFO ? ' + CFO' : ''}.` }
        : { jenis: 'ok', teks: `${dok.id} dikembalikan ke PIC untuk direvisi.` }, true);
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (!pertahankanKunci(x)) kunci.current = null;
      if (x && perluMuatUlang(x.code)) { setDlg(null); onSelesai({ jenis: 'warn', teks: `${dok.id}: ${errMessage(e)} Daftar sudah dimuat ulang.` }, true); return; }
      setGalat(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan tombol yang sama lagi - aman, tidak akan tercatat dua kali.');
    } finally { setSibuk(false); }
  };

  const nInv = angka(inv), nDiskon = angka(diskon), nBiaya = angka(biaya);
  const akhir = hitung?.finalAmount ?? dok.nominal;
  const berubah = hitung && hitung.finalAmount !== dok.nominal;
  const diskonBesar = nInv > 0 && nDiskon / nInv >= DISKON_BESAR;
  const perluCFO = !!hitung && hitung.finalAmount >= CFO_MIN;
  const lampiranUrl = `/api/pengajuan/${encodeURIComponent(dok.id)}/lampiran`;
  const ringkas = <div className="dlg-ringkas"><span className="num">{dok.id} · {dok.vendorNama || '—'}</span><strong className="num">{rupiah(akhir)}</strong></div>;
  const Info = ({ l, v }: { l: string; v: string }) => <div><dt>{l}</dt><dd>{v || '—'}</dd></div>;

  return (
    <div className="rv-wadah">
      <nav className="rv-jejak" aria-label="Jejak"><button type="button" className="link" onClick={onKembali}>← Antrean verifikasi pajak</button><span aria-hidden="true">/</span><span className="num">{dok.id}</span></nav>
      <article className="rv">
        <header className="rv-head">
          <div className="rv-id">
            <StatusPill status={dok.status} />
            <h2 className="rv-vendor">{dok.vendorNama || '—'}</h2>
            <p className="muted num">{dok.id} · {dok.tanggal}</p>
          </div>
          <div className="rv-peringatan" aria-live="polite">
            {dok.ajuanSendiri && <div className="rv-warn"><IkonPerhatian /><div><b>Ini ajuan Anda sendiri.</b><span>Verifikasi pajaknya harus dilakukan rekan Finance lain (pengaju ≠ verifikator).</span></div></div>}
            {diskonBesar && <div className="rv-warn"><IkonPerhatian /><div><b>Diskon besar: {persen(nDiskon, nInv)} dari nilai invoice</b><span>Pastikan angka sudah sesuai lampiran sebelum meloloskan verifikasi.</span></div></div>}
            {berubah && <div className="rv-warn"><IkonPerhatian /><div><b>Nominal akhir berubah</b><span>Dari {rupiah(dok.nominal)} menjadi {rupiah(hitung!.finalAmount)}. Perubahan tercatat di audit.</span></div></div>}
          </div>
          <div className="rv-total">
            <span className="muted">Nominal akhir</span>
            <strong className="num">{rupiah(akhir)}</strong>
            <span className="muted cap num">Dari nilai invoice {rupiah(nInv)}</span>
          </div>
        </header>

        <dl className="rv-info">
          <Info l="Diajukan oleh" v={dok.pic} /><Info l="Brand / Departemen" v={[dok.brand, dok.departement].filter(Boolean).join(' / ')} /><Info l="Tipe" v={dok.tipe} />
          <Info l="Keperluan" v={dok.description} /><Info l="No. Invoice" v={dok.noInvoice} /><Info l="Jatuh tempo" v={dok.dueDate} />
          <a className="link rv-detail" href={`/pengajuan/${encodeURIComponent(dok.id)}`}>Detail lengkap & riwayat →</a>
        </dl>

        <div className="rv-body">
          <section className="rv-kol rv-lamp" aria-labelledby={`rv-l-${dok.id}`}>
            <div className="rv-kol-h"><h3 className="ds-h" id={`rv-l-${dok.id}`}><IkonKlip /> Lampiran invoice</h3>
              {dok.punyaLampiran && <a className="btn btn-secondary btn-sm" href={lampiranUrl} target="_blank" rel="noopener noreferrer">Tab baru</a>}</div>
            {dok.punyaLampiran ? <PratinjauLampiran id={dok.id} /> : <p className="muted">Tidak ada lampiran.</p>}
          </section>

          <section className="rv-kol" aria-labelledby={`rv-f-${dok.id}`}>
            <h3 className="ds-h" id={`rv-f-${dok.id}`}>Verifikasi pajak</h3>
            <Field label="Nilai invoice (gross)" id={`vp-inv-${dok.id}`}>{(p) => <UangInput fp={p} nilai={inv} onUbah={setInv} />}</Field>
            <div className="grid2">
              <Field label="Diskon" id={`vp-dis-${dok.id}`} opsional petunjuk={nDiskon > 0 && nInv > 0 ? `${persen(nDiskon, nInv)} dari nilai invoice` : undefined}>{(p) => <UangInput fp={p} nilai={diskon} onUbah={setDiskon} />}</Field>
              <Field label="Biaya lain" id={`vp-bl-${dok.id}`} opsional>{(p) => <UangInput fp={p} nilai={biaya} onUbah={setBiaya} />}</Field>
            </div>
            <Chips label="Status PPN" kecil nilai={ppn} onPilih={setPpn} pilihan={[{ nilai: 'Non PPN', teks: 'Non PPN' }, { nilai: 'Include PPN', teks: 'Include' }, { nilai: 'Exclude PPN', teks: 'Exclude' }]} />
            <p className="muted cap rv-ppn">{PENJELASAN_PPN[ppn]}</p>
            <Field label="Jenis PPh" id={`vp-pph-${dok.id}`}>
              {(p) => <select {...p} value={pph} onChange={(e) => setPph(e.target.value)}>
                <option value="-">Tanpa PPh</option>
                {[...new Set([...(pph !== '-' ? [pph] : []), ...daftarPph])].map((j) => <option key={j} value={j}>{j}</option>)}
              </select>}
            </Field>
            <p className="rv-npwp">{dok.punyaNPWP
              ? <><span className="pill-st hijau-muda"><IkonSelesai />NPWP ada</span><span className="muted cap">Vendor punya NPWP.</span></>
              : <><span className="pill-st kuning">Tanpa NPWP</span><span className="muted cap">Tarif PPh non-NPWP dipakai.</span></>}</p>
          </section>

          <section className="rv-kol" aria-labelledby={`rv-r-${dok.id}`}>
            <h3 className="ds-h" id={`rv-r-${dok.id}`}>Rincian & catatan</h3>
            <div className="rv-rincian" aria-live="polite">
              <b>Rincian perhitungan</b>
              <dl>
                <div><dt>Nilai invoice (gross)</dt><dd className="num">{rupiah(nInv)}</dd></div>
                <div><dt>Diskon</dt><dd className="num">{nDiskon > 0 ? `− ${rupiah(nDiskon)}` : rupiah(0)}</dd></div>
                <div><dt>Biaya lain</dt><dd className="num">{rupiah(nBiaya)}</dd></div>
                <div className="pisah"><dt>DPP</dt><dd className="num">{hitung ? rupiah(hitung.dpp) : '—'}</dd></div>
                <div><dt>PPN</dt><dd className="num">{hitung ? rupiah(hitung.ppnAmount) : '—'}</dd></div>
                <div><dt>PPh{hitung && hitung.pphAmount > 0 ? ` ${pph} (${(hitung.pphRate * 100).toLocaleString('id-ID')}%)` : ''}</dt><dd className="num">{hitung ? (hitung.pphAmount > 0 ? `− ${rupiah(hitung.pphAmount)}` : rupiah(0)) : '—'}</dd></div>
                <div className="total"><dt>Nominal akhir</dt><dd className="num">{rupiah(akhir)}</dd></div>
              </dl>
            </div>
            {perluCFO && <p className="cap"><span className="badge-cfo">Butuh persetujuan CFO</span></p>}
            {galatHitung && <Pesan jenis="err">{galatHitung}</Pesan>}
            <Field label="Catatan" id={`vp-cat-${dok.id}`} opsional>{(p) => <textarea {...p} rows={6} maxLength={CATATAN_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          </section>
        </div>

        <footer className="rv-foot">
          <div><span className="muted">Nominal akhir yang akan diteruskan</span><strong className="num">{rupiah(akhir)}</strong></div>
          <div className="rv-aksi">
            {galat && !dlg && <Pesan jenis="err">{galat}</Pesan>}
            <span className="muted cap">Mengembalikan ke PIC wajib disertai alasan.</span>
            <div className="rv-tombol">
              <button type="button" className="btn btn-outline-danger" disabled={sibuk} onClick={() => { setGalat(null); setDlg('kembalikan'); }}>← Kembalikan ke PIC</button>
              <button type="button" className="btn btn-primary" disabled={sibuk || dok.ajuanSendiri || !hitung || !catatanValid(notes)} onClick={() => { setGalat(null); setDlg('loloskan'); }}><IkonSelesai />Loloskan verifikasi</button>
            </div>
          </div>
        </footer>
      </article>

      <Dialog buka={dlg === 'loloskan'} onTutup={() => { if (!sibuk) setDlg(null); }} judul="Loloskan verifikasi pajak?">
        <form onSubmit={(e) => { e.preventDefault(); void kirim('loloskan'); }}>
          {ringkas}
          <p className="muted">{ppn} · {pph === '-' ? 'tanpa PPh' : pph}. Server menghitung ulang angka akhir dengan tarif PPh terbaru. Dokumen lanjut ke persetujuan Fin. Mgr{perluCFO ? ' + CFO' : ''}.</p>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => setDlg(null)} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Memproses…' : 'Loloskan'}</button>
          </div>
        </form>
      </Dialog>
      <Dialog buka={dlg === 'kembalikan'} onTutup={() => { if (!sibuk) setDlg(null); }} judul="Kembalikan ke PIC">
        <form onSubmit={(e) => { e.preventDefault(); void kirim('kembalikan'); }}>
          {ringkas}
          <p className="muted">Dokumen kembali ke status perlu revisi. Alasan akan dibaca PIC.</p>
          <div className="chips tombol-baris" role="group" aria-label="Template alasan">
            {TEMPLATE_ALASAN.map((t) => <button type="button" key={t} className="chip" onClick={() => setAlasan(t)}>{t}</button>)}
          </div>
          <div className="f"><label htmlFor={`vp-alasan-${dok.id}`}>Alasan</label>
            <textarea id={`vp-alasan-${dok.id}`} maxLength={ALASAN_MAX} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => setDlg(null)} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-danger" disabled={sibuk || !alasanValid(alasan)}>{sibuk ? 'Memproses…' : 'Kembalikan'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
