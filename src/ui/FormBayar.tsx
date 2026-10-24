'use client';
import { useEffect, useRef, useState } from 'react';
import { pertahankanKunci } from '@/domain/approval-ui';
import { BAYAR_MAKS } from '@/domain/finance';
import { angka, formatRibuan, parseRupiah, pilihKunci, rupiah, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, isApiError } from './api';
import { Dialog, Field, Pesan, UangInput } from './kit';
import { IkonMata, IkonMataCoret } from './icons';

export interface DokBayar { id: string; vendorNama: string; etag: string; sisa: number; blokirBayar?: string | null | undefined; tugasRangkap?: string[] | undefined }
type Dlg = null | 'konfirmasi' | 'stepup' | 'duplikat';
const baru = (): string => crypto.randomUUID();
const hariIniWib = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

/**
 * F2-E: bayar satu dokumen atau beberapa yang dicentang. Nominal per dokumen (default = sisa), tanggal, rekening sumber (kas dari Master_COA), ref.
 * Pratinjau total + efek status sebelum konfirmasi; password (step-up) wajib; pembayaran kembar butuh konfirmasi eksplisit.
 * Angka sisa di sini hanya tampilan: server menghitung dari Trx_Payment_Log (I5).
 */
export function FormBayar({ target, onSelesai }: { target: readonly DokBayar[]; onSelesai: (pesan: { jenis: 'ok' | 'warn'; teks: string }, muatUlang: boolean) => void }) {
  const siap = target.filter((t) => !t.blokirBayar);
  const diblok = target.filter((t) => t.blokirBayar);
  const [kas, setKas] = useState<{ akun: string; grup: string }[] | null>(null);
  const [galatKas, setGalatKas] = useState<string | null>(null);
  // Nominal yang belum diubah = sisa tagihan (dokumen yang baru dicentang ikut terisi tanpa mereset isian lain).
  const [ubahan, setNominal] = useState<Record<string, string>>({});
  const nominal: Record<string, string> = Object.fromEntries(target.map((t) => [t.id, ubahan[t.id] ?? formatRibuan(t.sisa)]));
  const [tgl, setTgl] = useState(hariIniWib());
  const [rek, setRek] = useState('');
  const [ref, setRef] = useState('');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [pw, setPw] = useState('');
  const [lihatPw, setLihatPw] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef<KunciIdem | null>(null);

  useEffect(() => { api<{ kas: { akun: string; grup: string }[] }>('/api/master/kas', { method: 'GET' }).then((r) => setKas(r.kas)).catch((e) => setGalatKas(errMessage(e))); }, []);

  const n = (id: string): number => angka(nominal[id] ?? '');
  const salahNominal = siap.filter((t) => !parseRupiah(nominal[t.id] ?? '').ok || n(t.id) <= 0 || n(t.id) > t.sisa + 1000);
  const total = siap.reduce((a, t) => a + n(t.id), 0);
  const rangkap = [...new Set(siap.flatMap((t) => t.tugasRangkap ?? []))];
  const valid = siap.length > 0 && siap.length <= BAYAR_MAKS && !salahNominal.length && !!rek && /^\d{4}-\d{2}-\d{2}$/.test(tgl) && tgl <= hariIniWib();

  const kirim = async (lanjut = false, konfirmasiDuplikat = false) => {
    if (!valid || (sibuk && !lanjut)) return;
    setSibuk(true); setGalat(null);
    const body = { items: siap.map((t) => ({ id: t.id, etag: t.etag, nominal: n(t.id) })), tglBayar: tgl, sumberRekening: rek, ...(ref.trim() ? { refNo: ref.trim() } : {}), ...(konfirmasiDuplikat ? { konfirmasiDuplikat: true } : {}) };
    kunci.current = pilihKunci(kunci.current, JSON.stringify(body), baru);
    try {
      const r = await api<{ hasil: { berhasil: { id: string; lunas: boolean }[]; gagal: { id: string; alasan: string }[]; total: number } }>('/api/finance/bayar', { body, headers: { 'idempotency-key': kunci.current.key } });
      kunci.current = null; setDlg(null);
      const { berhasil, gagal } = r.hasil;
      const lunas = berhasil.filter((b) => b.lunas).length;
      onSelesai({ jenis: gagal.length ? 'warn' : 'ok', teks: `${berhasil.length} pembayaran tercatat (${rupiah(r.hasil.total)}; ${lunas} lunas, ${berhasil.length - lunas} sebagian).${gagal.length ? ` Gagal: ${gagal.map((g) => `${g.id} (${g.alasan})`).join('; ')}` : ''}` }, true);
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x?.code === 'FORBIDDEN' && x.fields?.stepUp === 'required') { setDlg('stepup'); return; }
      if (x?.code === 'CONFLICT' && x.fields?.duplikat === 'konfirmasi') { kunci.current = null; setDlg('duplikat'); setGalat(errMessage(e)); return; }
      if (!pertahankanKunci(x)) kunci.current = null;
      setGalat(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan "Bayar" lagi - aman, tidak akan tercatat dua kali.');
    } finally { setSibuk(false); }
  };
  const konfirmasiPw = async () => {
    if (!pw || sibuk) return;
    setSibuk(true); setGalat(null);
    try { await api('/api/auth/step-up', { body: { password: pw } }); setPw(''); setSibuk(false); await kirim(true); return; }
    catch (e) { setGalat(errMessage(e)); }
    setSibuk(false);
  };
  const tutup = () => { if (!sibuk) { setDlg(null); setGalat(null); setPw(''); } };

  if (galatKas) return <div className="vp"><Pesan jenis="err">Daftar rekening kas belum bisa dimuat: {galatKas}</Pesan></div>;
  return (
    <div className="vp">
      <h3 className="ds-h">Pembayaran</h3>
      {target.length > 1 && <p className="muted cap">{target.length} dokumen dicentang. Tanggal, rekening, dan ref berlaku untuk semua; nominal per dokumen.</p>}
      {diblok.length > 0 && <Pesan jenis="warn">{diblok.map((t) => `${t.id}: ${t.blokirBayar}`).join(' · ')}{siap.length ? ' Dokumen ini dilewati.' : ''}</Pesan>}
      {rangkap.length > 0 && <Pesan jenis="warn">Anda juga {rangkap.join(' / ')} untuk dokumen ini. Pembayaran tetap bisa dilakukan, tetapi diberi penanda di audit (pemisahan tugas).</Pesan>}
      {target.length > BAYAR_MAKS && <Pesan jenis="warn">Maksimal {BAYAR_MAKS} dokumen sekali bayar.</Pesan>}
      {siap.map((t) => (
        <Field key={t.id} label={siap.length > 1 ? `${t.id} · ${t.vendorNama || '—'}` : 'Nominal dibayar'} id={`by-n-${t.id}`}
          galat={salahNominal.includes(t) ? (n(t.id) > t.sisa + 1000 ? `Melebihi sisa ${rupiah(t.sisa)}.` : 'Nominal tidak valid.') : undefined}
          petunjuk={`Sisa tagihan ${rupiah(t.sisa)}${n(t.id) > 0 && n(t.id) < t.sisa - 1000 ? ' · cicilan (Dibayar Sebagian)' : ' · lunas'}`}>
          {(p) => <UangInput fp={p} nilai={nominal[t.id] ?? ''} onUbah={(v) => setNominal((x) => ({ ...x, [t.id]: v }))} />}
        </Field>
      ))}
      {siap.length > 0 && (
        <>
          <div className="grid2">
            <Field label="Tanggal transfer" id="by-tgl">{(p) => <input {...p} type="date" value={tgl} max={hariIniWib()} onChange={(e) => setTgl(e.target.value)} />}</Field>
            <Field label="No. ref" id="by-ref" opsional>{(p) => <input {...p} value={ref} maxLength={60} autoComplete="off" onChange={(e) => setRef(e.target.value)} />}</Field>
          </div>
          <Field label="Rekening sumber (kas)" id="by-rek">
            {(p) => <select {...p} value={rek} disabled={!kas} onChange={(e) => setRek(e.target.value)}>
              <option value="">{kas ? (kas.length ? 'Pilih rekening…' : 'Tidak ada akun kas di Master_COA') : 'Memuat…'}</option>
              {(kas ?? []).map((k) => <option key={k.akun} value={k.akun}>{k.grup ? `${k.grup} · ${k.akun}` : k.akun}</option>)}
            </select>}
          </Field>
          <dl className="ip-rincian"><div className="ip-total"><dt>Total dibayar{siap.length > 1 ? ` (${siap.length} dokumen)` : ''}</dt><dd className="num">{rupiah(total)}</dd></div></dl>
          {galat && !dlg && <Pesan jenis="err">{galat}</Pesan>}
          <div className="ip-aksi">
            <button type="button" className="btn btn-primary" disabled={sibuk || !valid} onClick={() => { setGalat(null); setDlg('konfirmasi'); }}>Bayar {rupiah(total)}</button>
          </div>
        </>
      )}

      <Dialog buka={dlg === 'konfirmasi'} onTutup={tutup} judul="Konfirmasi pembayaran" langkah="Langkah 1 dari 2" lebar>
        <form onSubmit={(e) => { e.preventDefault(); void kirim(); }}>
          <table className="tbl by-ringkas"><thead><tr><th scope="col">Dokumen</th><th scope="col" className="num">Nominal</th><th scope="col">Hasil</th></tr></thead>
            <tbody>{siap.map((t) => <tr key={t.id}><td>{t.id}<span className="tbl-sub">{t.vendorNama || '—'}</span></td><td className="num">{rupiah(n(t.id))}</td><td>{n(t.id) >= t.sisa - 1000 ? 'Lunas' : `Sebagian, sisa ${rupiah(t.sisa - n(t.id))}`}</td></tr>)}</tbody>
          </table>
          <p className="muted">Total <b className="num">{rupiah(total)}</b> dari <b>{rek}</b>, tanggal {tgl}{ref.trim() ? `, ref ${ref.trim()}` : ''}. Pembayaran tidak bisa dibatalkan dari portal.</p>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={tutup} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Memproses…' : 'Lanjut'}</button>
          </div>
        </form>
      </Dialog>
      <Dialog buka={dlg === 'stepup'} onTutup={tutup} judul="Konfirmasi password" langkah="Langkah 2 dari 2">
        <form onSubmit={(e) => { e.preventDefault(); void konfirmasiPw(); }}>
          <div className="dlg-ringkas"><span>{siap.length} dokumen · {rek}</span><strong className="num">{rupiah(total)}</strong></div>
          <div className="f">
            <div className="dlg-lbl"><label htmlFor="by-pw">Password</label></div>
            <div className="pw-wrap">
              <input id="by-pw" type={lihatPw ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="pw-mata" aria-label={lihatPw ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={lihatPw} onClick={() => setLihatPw(!lihatPw)}>{lihatPw ? <IkonMataCoret /> : <IkonMata />}</button>
            </div>
            <div className="hint">Pembayaran memerlukan password. Setelah dikonfirmasi, tidak perlu diulang selama 5 menit.</div>
          </div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => { setDlg('konfirmasi'); setPw(''); setGalat(null); }} disabled={sibuk}>Kembali</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk || !pw}>{sibuk ? 'Memproses…' : `Bayar ${rupiah(total)}`}</button>
          </div>
        </form>
      </Dialog>
      <Dialog buka={dlg === 'duplikat'} onTutup={tutup} judul="Pembayaran kembar?">
        <form onSubmit={(e) => { e.preventDefault(); void kirim(false, true); }}>
          <Pesan jenis="warn">{galat}</Pesan>
          <p className="muted">Lanjutkan hanya bila ini memang transfer terpisah (bukan klik ulang).</p>
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={tutup} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-danger" disabled={sibuk}>{sibuk ? 'Memproses…' : 'Ya, catat lagi'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
