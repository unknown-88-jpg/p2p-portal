'use client';
import { useEffect, useRef, useState } from 'react';
import { ALASAN_MAX, CATATAN_MAX, TEMPLATE_ALASAN } from '@/domain/approval';
import { alasanValid, catatanValid, pertahankanKunci, perluMuatUlang } from '@/domain/approval-ui';
import { angka, formatRibuan, parseRupiah, pilihKunci, rupiah, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, hasilDipulihkan, isApiError, PESAN_DIPULIHKAN } from './api';
import { Chips, Dialog, Field, Pesan, UangInput } from './kit';

export interface DokPajak {
  id: string; vendorNama: string; etag: string; invoiceAmount: number; diskon: number; biayaLainnya: number; statusPPN: string; jenisPPh: string;
  nominal: number; punyaNPWP: boolean; ajuanSendiri: boolean;
}
interface Hitung { dpp: number; ppnAmount: number; pphAmount: number; pphRate: number; finalAmount: number }
type PPN = 'Include PPN' | 'Exclude PPN' | 'Non PPN';
const CFO_MIN = 5_000_000;
const teks = (n: number): string => (n > 0 ? formatRibuan(n) : '');
const baru = (): string => crypto.randomUUID();

/**
 * F2-B: form verifikasi pajak di panel antrean Finance. Pratinjau memakai /api/calc/tax (tarif cache, hanya tampilan);
 * angka yang DISIMPAN dihitung ulang server dengan tarif PPh segar (I2). Pengaju = pengguna ini -> tombol Loloskan dikunci (I6).
 */
export function FormVerifikasiPajak({ dok, onSelesai }: { dok: DokPajak; onSelesai: (pesan: { jenis: 'ok' | 'warn'; teks: string }, muatUlang: boolean) => void }) {
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

  const berubah = hitung && hitung.finalAmount !== dok.nominal;
  const ringkas = <div className="dlg-ringkas"><span className="num">{dok.id} · {dok.vendorNama || '—'}</span><strong className="num">{rupiah(hitung?.finalAmount ?? dok.nominal)}</strong></div>;
  return (
    <div className="vp">
      <h3 className="ds-h">Verifikasi pajak</h3>
      {dok.ajuanSendiri && <Pesan jenis="warn">Ini ajuan Anda sendiri. Verifikasi pajaknya harus dilakukan rekan Finance lain (pengaju ≠ verifikator).</Pesan>}
      <Field label="Nilai invoice (gross)" id={`vp-inv-${dok.id}`}>{(p) => <UangInput fp={p} nilai={inv} onUbah={setInv} />}</Field>
      <div className="grid2">
        <Field label="Diskon" id={`vp-dis-${dok.id}`} opsional>{(p) => <UangInput fp={p} nilai={diskon} onUbah={setDiskon} />}</Field>
        <Field label="Biaya lain" id={`vp-bl-${dok.id}`} opsional>{(p) => <UangInput fp={p} nilai={biaya} onUbah={setBiaya} />}</Field>
      </div>
      <Chips label="Status PPN" kecil nilai={ppn} onPilih={setPpn} pilihan={[{ nilai: 'Non PPN', teks: 'Non PPN' }, { nilai: 'Include PPN', teks: 'Include' }, { nilai: 'Exclude PPN', teks: 'Exclude' }]} />
      <Field label="Jenis PPh" id={`vp-pph-${dok.id}`} petunjuk={dok.punyaNPWP ? 'Vendor punya NPWP.' : 'Vendor tanpa NPWP: tarif PPh non-NPWP.'}>
        {(p) => <select {...p} value={pph} onChange={(e) => setPph(e.target.value)}>
          <option value="-">Tanpa PPh</option>
          {[...new Set([...(pph !== '-' ? [pph] : []), ...daftarPph])].map((j) => <option key={j} value={j}>{j}</option>)}
        </select>}
      </Field>
      {hitung && (
        <dl className="ip-rincian" aria-live="polite">
          <div><dt>DPP</dt><dd className="num">{rupiah(hitung.dpp)}</dd></div>
          <div><dt>PPN</dt><dd className="num">{rupiah(hitung.ppnAmount)}</dd></div>
          {hitung.pphAmount > 0 && <div><dt>{pph} ({(hitung.pphRate * 100).toLocaleString('id-ID')}%)</dt><dd className="num">- {rupiah(hitung.pphAmount)}</dd></div>}
          <div className="ip-total"><dt>Nominal akhir</dt><dd className="num">{rupiah(hitung.finalAmount)}</dd></div>
        </dl>
      )}
      {galatHitung && <Pesan jenis="err">{galatHitung}</Pesan>}
      {berubah && <Pesan jenis="warn">Nominal akhir berubah dari {rupiah(dok.nominal)} menjadi {rupiah(hitung!.finalAmount)}. Perubahan tercatat di audit.</Pesan>}
      {hitung && hitung.finalAmount >= CFO_MIN && <p className="cap"><span className="badge-cfo">Butuh persetujuan CFO</span></p>}
      <Field label="Catatan" id={`vp-cat-${dok.id}`} opsional>{(p) => <textarea {...p} maxLength={CATATAN_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {galat && !dlg && <Pesan jenis="err">{galat}</Pesan>}
      <div className="ip-aksi">
        <button type="button" className="btn btn-primary" disabled={sibuk || dok.ajuanSendiri || !hitung || !catatanValid(notes)} onClick={() => { setGalat(null); setDlg('loloskan'); }}>Loloskan verifikasi</button>
        <button type="button" className="btn btn-secondary" disabled={sibuk} onClick={() => { setGalat(null); setDlg('kembalikan'); }}>Kembalikan ke PIC</button>
      </div>

      <Dialog buka={dlg === 'loloskan'} onTutup={() => { if (!sibuk) setDlg(null); }} judul="Loloskan verifikasi pajak?">
        <form onSubmit={(e) => { e.preventDefault(); void kirim('loloskan'); }}>
          {ringkas}
          <p className="muted">{ppn} · {pph === '-' ? 'tanpa PPh' : pph}. Server menghitung ulang angka akhir dengan tarif PPh terbaru. Dokumen lanjut ke persetujuan Fin. Mgr{hitung && hitung.finalAmount >= CFO_MIN ? ' + CFO' : ''}.</p>
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
