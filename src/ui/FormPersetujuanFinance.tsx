'use client';
import { useRef, useState } from 'react';
import { ALASAN_MAX, CATATAN_MAX, TEMPLATE_ALASAN } from '@/domain/approval';
import { alasanValid, catatanValid, pertahankanKunci, perluMuatUlang } from '@/domain/approval-ui';
import { pilihKunci, rupiah, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, hasilDipulihkan, isApiError, PESAN_DIPULIHKAN } from './api';
import { Dialog, Pesan } from './kit';
import { IkonMata, IkonMataCoret, IkonSelesai } from './icons';
import { KirimWaFinance } from './KirimWaFinance';

export interface DokSetuju {
  id: string; vendorNama: string; etag: string; nominal: number; perluCFO: boolean; perluCOO: boolean; ajuanSendiri: boolean;
  persetujuan?: { finMgr: string | null; coo: string | null; cfo: string | null; finMgrSaya: boolean; cooSaya: boolean; wa?: { target: 'finmgr' | 'coo' | 'cfo'; terkirim: boolean } | null } | undefined;
}
export interface Peran { staff: boolean; finMgr: boolean; coo: boolean; cfo: boolean }
type Sebagai = 'finmgr' | 'coo' | 'cfo';
const LABEL_PERAN: Record<Sebagai, string> = { finmgr: 'Fin. Mgr', coo: 'COO', cfo: 'CFO' };
type Dlg = null | 'setuju' | 'stepup' | 'kembalikan';
const baru = (): string => crypto.randomUUID();

/** Tombol yang relevan untuk pengguna ini (penjaga sebenarnya di server: urutan Fin. Mgr -> COO [dokumen GA >= ambang] -> CFO, orang berbeda, CFO/COO hanya bila wajib). */
export function giliranSaya(dok: DokSetuju, peran: Peran): Sebagai | null {
  const p = dok.persetujuan ?? { finMgr: null, coo: null, cfo: null, finMgrSaya: false, cooSaya: false };
  if (peran.finMgr && !p.finMgr) return 'finmgr';
  if (peran.coo && dok.perluCOO && p.finMgr && !p.coo && !p.finMgrSaya) return 'coo';
  if (peran.cfo && dok.perluCFO && p.finMgr && (!dok.perluCOO || p.coo) && !p.cfo && !p.finMgrSaya && !p.cooSaya) return 'cfo';
  return null;
}

/**
 * F2-C (O4): e-approve Fin. Mgr / CFO di panel antrean. Dua langkah seperti persetujuan Manager: konfirmasi -> password (step-up, berlaku 5 menit).
 * Fin. Mgr / CFO juga bisa mengembalikan ke PIC dari tahap ini.
 */
/** Tombol Kirim WA tidak ditampilkan bila penerimanya adalah pengguna ini sendiri (gilirannya menyetujui target yang sama). */
export const tampilKirimWa = (giliran: Sebagai | null, target: 'finmgr' | 'coo' | 'cfo'): boolean => giliran !== target;

export function FormPersetujuanFinance({ dok, peran, onSelesai }: { dok: DokSetuju; peran: Peran; onSelesai: (pesan: { jenis: 'ok' | 'warn'; teks: string }, muatUlang: boolean) => void }) {
  const [dlg, setDlg] = useState<Dlg>(null);
  const [notes, setNotes] = useState('');
  const [alasan, setAlasan] = useState('');
  const [pw, setPw] = useState('');
  const [lihatPw, setLihatPw] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef<KunciIdem | null>(null);
  const p = dok.persetujuan ?? { finMgr: null, coo: null, cfo: null, finMgrSaya: false, cooSaya: false };
  const giliran = giliranSaya(dok, peran);
  const bisaKembalikan = peran.staff || peran.finMgr || peran.coo || peran.cfo;
  // Event 'close' <dialog> juga terpicu saat ditutup lewat KODE (mis. pindah dari langkah 1 ke dialog password);
  // hanya dialog yang masih AKTIF yang boleh mereset state, kalau tidak dialog password langsung ikut tertutup.
  const tutup = (k: Dlg) => () => { if (!sibuk && dlg === k) { setDlg(null); setGalat(null); setPw(''); setLihatPw(false); } };

  const gagal = (e: unknown, ulangMsg: string): void => {
    const x = isApiError(e) ? e : null;
    if (x?.code === 'FORBIDDEN' && x.fields?.stepUp === 'required') { setDlg('stepup'); setGalat(null); return; }
    if (!pertahankanKunci(x)) kunci.current = null;
    if (x && perluMuatUlang(x.code)) { setDlg(null); onSelesai({ jenis: 'warn', teks: `${dok.id}: ${errMessage(e)} Daftar sudah dimuat ulang.` }, true); return; }
    setGalat(x ? errMessage(e) : ulangMsg);
  };

  const setujui = async (lanjut = false) => {
    if (!giliran || (sibuk && !lanjut) || !catatanValid(notes)) return;
    setSibuk(true); setGalat(null);
    const isi = { etag: dok.etag, sebagai: giliran, ...(notes.trim() ? { notes: notes.trim() } : {}) };
    kunci.current = pilihKunci(kunci.current, `S|${JSON.stringify(isi)}`, baru);
    try {
      const r = await api<{ hasil: { menungguBerikut: 'coo' | 'cfo' | null } }>(`/api/finance/${encodeURIComponent(dok.id)}/setujui`, { body: isi, headers: { 'idempotency-key': kunci.current.key } });
      if (hasilDipulihkan(r.hasil)) { kunci.current = null; setDlg(null); onSelesai({ jenis: 'warn', teks: PESAN_DIPULIHKAN }, true); return; }
      kunci.current = null; setDlg(null); setNotes('');
      onSelesai({ jenis: 'ok', teks: `${dok.id} disetujui sebagai ${LABEL_PERAN[giliran]}. ${r.hasil.menungguBerikut ? `Berikutnya persetujuan ${LABEL_PERAN[r.hasil.menungguBerikut]}.` : 'Berikutnya Jurnal COA.'}` }, true);
    } catch (e) { gagal(e, 'Koneksi terputus, hasil belum pasti. Tekan "Setujui" lagi - aman, tidak akan tercatat dua kali.'); }
    finally { setSibuk(false); }
  };
  const konfirmasiPw = async () => {
    if (!pw || sibuk) return;
    setSibuk(true); setGalat(null);
    try { await api('/api/auth/step-up', { body: { password: pw } }); setPw(''); setSibuk(false); await setujui(true); return; }
    catch (e) { setGalat(errMessage(e)); }
    setSibuk(false);
  };
  const kembalikan = async () => {
    if (sibuk || !alasanValid(alasan)) return;
    setSibuk(true); setGalat(null);
    const isi = { etag: dok.etag, alasan: alasan.trim() };
    kunci.current = pilihKunci(kunci.current, `K|${JSON.stringify(isi)}`, baru);
    try {
      await api(`/api/finance/${encodeURIComponent(dok.id)}/kembalikan`, { body: isi, headers: { 'idempotency-key': kunci.current.key } });
      kunci.current = null; setDlg(null);
      onSelesai({ jenis: 'ok', teks: `${dok.id} dikembalikan ke PIC untuk direvisi.` }, true);
    } catch (e) { gagal(e, 'Koneksi terputus, hasil belum pasti. Tekan "Kembalikan" lagi - aman.'); }
    finally { setSibuk(false); }
  };

  const ringkas = <div className="dlg-ringkas"><span className="num">{dok.id} · {dok.vendorNama || '—'}</span><strong className="num">{rupiah(dok.nominal)}</strong></div>;
  const Baris = ({ l, nama, tunggu }: { l: string; nama: string | null; tunggu: string }) => (
    <li>{nama ? <span className="ip-ik ok" aria-hidden="true"><IkonSelesai /></span> : <span className="ip-ik warn" aria-hidden="true">…</span>}<span><b>{l}</b> · {nama ? `disetujui ${nama}` : tunggu}</span></li>
  );
  const peranLabel = giliran ? LABEL_PERAN[giliran] : 'CFO';
  return (
    <div className="vp">
      <h3 className="ds-h">Persetujuan Fin. Mgr{dok.perluCOO ? ' / COO' : ''} / CFO</h3>
      <ul className="ip-syarat">
        <Baris l="Fin. Mgr" nama={p.finMgr} tunggu="menunggu" />
        {dok.perluCOO && <Baris l="COO" nama={p.coo} tunggu={p.finMgr ? 'menunggu' : 'setelah Fin. Mgr'} />}
        {dok.perluCFO && <Baris l="CFO" nama={p.cfo} tunggu={dok.perluCOO && !p.coo ? 'setelah COO' : p.finMgr ? 'menunggu' : 'setelah Fin. Mgr'} />}
      </ul>
      {giliran && dok.ajuanSendiri && <Pesan jenis="warn">Ini ajuan Anda sendiri. Persetujuan tetap bisa diberikan, tetapi diberi penanda di audit.</Pesan>}
      {!giliran && (peran.finMgr || peran.coo || peran.cfo) && (
        <p className="muted cap">{p.finMgrSaya && (peran.coo || peran.cfo) ? 'Anda sudah menyetujui sebagai Fin. Mgr; persetujuan berikutnya harus oleh orang lain.' : p.cooSaya && peran.cfo ? 'Anda sudah menyetujui sebagai COO; persetujuan CFO harus oleh orang lain.' : peran.coo && dok.perluCOO && !p.finMgr ? 'Persetujuan COO dibuka setelah Fin. Mgr menyetujui.' : peran.cfo && dok.perluCFO && !p.finMgr ? 'Persetujuan CFO dibuka setelah Fin. Mgr menyetujui.' : peran.cfo && dok.perluCOO && !p.coo ? 'Persetujuan CFO dibuka setelah COO menyetujui.' : 'Tidak ada persetujuan yang menunggu Anda untuk dokumen ini.'}</p>
      )}
      {galat && !dlg && <Pesan jenis="err">{galat}</Pesan>}
      {dok.persetujuan?.wa && tampilKirimWa(giliran, dok.persetujuan.wa.target) && <KirimWaFinance key={`${dok.id}|${dok.persetujuan.wa.target}`} id={dok.id} wa={dok.persetujuan.wa} />}
      <div className="ip-aksi">
        {giliran && <button type="button" className="btn btn-primary" disabled={sibuk} onClick={() => { setGalat(null); setDlg('setuju'); }}>Setujui sebagai {peranLabel}</button>}
        {bisaKembalikan && <button type="button" className="btn btn-secondary" disabled={sibuk} onClick={() => { setGalat(null); setDlg('kembalikan'); }}>Kembalikan ke PIC</button>}
      </div>

      <Dialog buka={dlg === 'setuju'} onTutup={tutup('setuju')} judul={`Setujui sebagai ${peranLabel}?`} langkah="Langkah 1 dari 2">
        <form onSubmit={(e) => { e.preventDefault(); void setujui(); }}>
          {ringkas}
          <p className="muted">Persetujuan elektronik ini menggantikan tanda tangan basah dan tercatat atas nama Anda.{giliran === 'finmgr' && dok.perluCOO ? ' Setelah ini dokumen menunggu persetujuan COO, lalu CFO.' : (giliran === 'finmgr' || giliran === 'coo') && dok.perluCFO ? ' Setelah ini dokumen menunggu persetujuan CFO.' : ' Setelah ini dokumen lanjut ke Jurnal COA.'}</p>
          <div className="f"><label htmlFor={`fs-cat-${dok.id}`}>Catatan <span className="opt">(opsional)</span></label>
            <textarea id={`fs-cat-${dok.id}`} maxLength={CATATAN_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => { setDlg(null); setGalat(null); }} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk || !catatanValid(notes)}>{sibuk ? 'Memproses…' : 'Lanjut'}</button>
          </div>
        </form>
      </Dialog>
      <Dialog buka={dlg === 'stepup'} onTutup={tutup('stepup')} judul="Konfirmasi password" langkah="Langkah 2 dari 2">
        <form onSubmit={(e) => { e.preventDefault(); void konfirmasiPw(); }}>
          {ringkas}
          <div className="f">
            <div className="dlg-lbl"><label htmlFor={`fs-pw-${dok.id}`}>Password</label></div>
            <div className="pw-wrap">
              <input id={`fs-pw-${dok.id}`} type={lihatPw ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="pw-mata" aria-label={lihatPw ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={lihatPw} onClick={() => setLihatPw(!lihatPw)}>{lihatPw ? <IkonMataCoret /> : <IkonMata />}</button>
            </div>
            <div className="hint">Setiap persetujuan Fin. Mgr / CFO memerlukan password. Setelah dikonfirmasi, tidak perlu diulang selama 5 menit.</div>
          </div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => { setDlg('setuju'); setPw(''); setGalat(null); }} disabled={sibuk}>Kembali</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk || !pw}>{sibuk ? 'Memproses…' : `Setujui sebagai ${peranLabel}`}</button>
          </div>
        </form>
      </Dialog>
      <Dialog buka={dlg === 'kembalikan'} onTutup={tutup('kembalikan')} judul="Kembalikan ke PIC">
        <form onSubmit={(e) => { e.preventDefault(); void kembalikan(); }}>
          {ringkas}
          <p className="muted">Dokumen kembali ke status perlu revisi dan harus diverifikasi pajak ulang setelah diajukan lagi. Alasan akan dibaca PIC.</p>
          <div className="chips tombol-baris" role="group" aria-label="Template alasan">
            {TEMPLATE_ALASAN.map((t) => <button type="button" key={t} className="chip" onClick={() => setAlasan(t)}>{t}</button>)}
          </div>
          <div className="f"><label htmlFor={`fs-alasan-${dok.id}`}>Alasan</label>
            <textarea id={`fs-alasan-${dok.id}`} maxLength={ALASAN_MAX} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => { setDlg(null); setGalat(null); }} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-danger" disabled={sibuk || !alasanValid(alasan)}>{sibuk ? 'Memproses…' : 'Kembalikan'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
