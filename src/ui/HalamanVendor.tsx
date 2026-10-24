'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALASAN_MAX, TEMPLATE_ALASAN } from '@/domain/approval';
import { alasanValid } from '@/domain/approval-ui';
import { api, errMessage, isApiError } from './api';
import { Chips, Dialog, Field, Pesan, Skeleton, Toast, type IsiToast } from './kit';

interface Saya { kode: string; nama: string; tipe: string; bank: string; noRekening: string; status: string; tglDaftar: string }
interface Antre { kode: string; nama: string; tipe: string; npwp: string; bank: string; namaRekening: string; noRekening: string; didaftarkanOleh: string; tglDaftar: string; milikSaya: boolean; peringatan: string[] }
type Tab = 'daftar' | 'pengesahan';
const kosong = { namaVendor: '', tipeVendor: '', npwp: '', bank: '', namaRekening: '', noRekening: '' };
const baru = (): string => crypto.randomUUID();
const pill = (st: string): string => (st === 'Approved' ? 'hijau-muda' : st === 'Rejected' ? 'merah' : 'kuning');
const labelSt = (st: string): string => (st === 'Approved' ? 'Disahkan' : st === 'Rejected' ? 'Ditolak' : 'Menunggu pengesahan');

/** F3-A: daftar vendor baru (PIC/Manager/Finance/Admin) + antrean pengesahan (Finance Staff; maker-checker). */
export function HalamanVendor({ bisaDaftar, bisaSahkan }: { bisaDaftar: boolean; bisaSahkan: boolean }) {
  const [tab, setTab] = useState<Tab>(bisaDaftar ? 'daftar' : 'pengesahan');
  const [toast, setToast] = useState<IsiToast | null>(null);
  const [saya, setSaya] = useState<Saya[] | null>(null);
  const [antre, setAntre] = useState<Antre[] | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [f, setF] = useState(kosong);
  const [galat, setGalat] = useState<Record<string, string>>({});
  const [sibuk, setSibuk] = useState(false);
  const [dlg, setDlg] = useState<null | { aksi: 'approve' | 'reject'; v: Antre }>(null);
  const [alasan, setAlasan] = useState('');
  const [galatDlg, setGalatDlg] = useState<string | null>(null);
  const kunci = useRef<string | null>(null);

  const muat = useCallback(async () => {
    try {
      if (bisaDaftar || bisaSahkan) setSaya((await api<{ items: Saya[] }>('/api/vendors', { method: 'GET' })).items);
      if (bisaSahkan) setAntre((await api<{ items: Antre[] }>('/api/vendors?status=pending', { method: 'GET' })).items);
      setGalatMuat(null);
    } catch (e) { setGalatMuat(errMessage(e)); }
  }, [bisaDaftar, bisaSahkan]);
  useEffect(() => { void muat(); }, [muat]);

  const daftar = async () => {
    if (sibuk) return;
    setSibuk(true); setGalat({});
    kunci.current ??= baru();
    try {
      const r = await api<{ hasil: { kode: string; nama: string } }>('/api/vendors', { body: { ...f, ...(f.npwp.trim() ? {} : { npwp: undefined }) }, headers: { 'idempotency-key': kunci.current } });
      kunci.current = null; setF(kosong);
      setToast({ jenis: 'ok', teks: `Vendor ${r.hasil.nama} terdaftar dengan kode ${r.hasil.kode}. Menunggu pengesahan Finance sebelum bisa dipakai.` });
      void muat();
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x?.code !== undefined) kunci.current = null;
      if (x?.fields) setGalat(x.fields); else setGalat({ _: errMessage(e) });
    } finally { setSibuk(false); }
  };

  const putuskan = async () => {
    if (!dlg || sibuk) return;
    const { aksi, v } = dlg;
    if (aksi === 'reject' && !alasanValid(alasan)) return;
    setSibuk(true); setGalatDlg(null);
    kunci.current ??= baru();
    try {
      await api(`/api/vendors/${encodeURIComponent(v.kode)}/${aksi}`, { body: { bank: v.bank, noRekening: v.noRekening, ...(aksi === 'reject' ? { alasan: alasan.trim() } : {}) }, headers: { 'idempotency-key': kunci.current } });
      kunci.current = null; setDlg(null); setAlasan('');
      setToast({ jenis: 'ok', teks: aksi === 'approve' ? `${v.kode} ${v.nama} disahkan dan bisa dipakai di pengajuan.` : `${v.kode} ditolak.` });
      void muat();
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x) kunci.current = null;
      if (x?.code === 'CONFLICT' || x?.code === 'NOT_FOUND') { setDlg(null); setToast({ jenis: 'warn', teks: `${v.kode}: ${errMessage(e)}` }); void muat(); return; }
      setGalatDlg(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan tombol yang sama lagi - aman.');
    } finally { setSibuk(false); }
  };

  const tabs = useMemo(() => [
    ...(bisaDaftar ? [{ nilai: 'daftar' as const, teks: 'Daftarkan vendor' }] : []),
    ...(bisaSahkan ? [{ nilai: 'pengesahan' as const, teks: 'Menunggu pengesahan', jumlah: antre?.length ?? 0 }] : []),
  ], [bisaDaftar, bisaSahkan, antre]);
  const ubah = (k: keyof typeof kosong) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <>
      <div className="toast-wadah"><Toast isi={toast} onTutup={() => setToast(null)} /></div>
      <div className="toolbar"><h1 className="page-h">Vendor</h1></div>
      {tabs.length > 1 && <Chips label="Bagian" labelTersembunyi kecil nilai={tab} onPilih={setTab} pilihan={tabs} />}
      {galatMuat && <Pesan jenis="err">{galatMuat} <button type="button" className="link" onClick={() => void muat()}>Coba lagi</button></Pesan>}

      {tab === 'daftar' && bisaDaftar && (
        <div className="vendor-grid">
          <section className="kartu" aria-labelledby="h-daftar">
            <h2 className="kartu-t" id="h-daftar">Daftarkan vendor baru</h2>
            <p className="muted cap">Vendor baru berstatus <b>Menunggu pengesahan</b> dan baru bisa dipakai di pengajuan setelah disahkan Finance (orang lain dari pendaftar).</p>
            <form onSubmit={(e) => { e.preventDefault(); void daftar(); }}>
              <Field label="Nama vendor" id="v-nama" galat={galat.namaVendor}>{(p) => <input {...p} value={f.namaVendor} maxLength={120} onChange={(e) => ubah('namaVendor')(e.target.value)} />}</Field>
              <Chips label="Tipe vendor" nilai={f.tipeVendor as 'Trade' | 'Non-Trade' | ''} galat={galat.tipeVendor} onPilih={ubah('tipeVendor')} pilihan={[{ nilai: 'Trade', teks: 'Trade' }, { nilai: 'Non-Trade', teks: 'Non-Trade' }]} />
              <Field label="NPWP" id="v-npwp" opsional petunjuk="Kosongkan bila vendor tidak punya NPWP (PPh memakai tarif non-NPWP).">{(p) => <input {...p} value={f.npwp} maxLength={40} inputMode="numeric" onChange={(e) => ubah('npwp')(e.target.value)} />}</Field>
              <div className="grid2">
                <Field label="Bank" id="v-bank" galat={galat.bank}>{(p) => <input {...p} value={f.bank} maxLength={60} onChange={(e) => ubah('bank')(e.target.value)} />}</Field>
                <Field label="Nomor rekening" id="v-rek" galat={galat.noRekening} petunjuk="6–20 digit angka.">{(p) => <input {...p} value={f.noRekening} maxLength={40} inputMode="numeric" autoComplete="off" onChange={(e) => ubah('noRekening')(e.target.value)} />}</Field>
              </div>
              <Field label="Nama pemilik rekening" id="v-pemilik" galat={galat.namaRekening}>{(p) => <input {...p} value={f.namaRekening} maxLength={120} onChange={(e) => ubah('namaRekening')(e.target.value)} />}</Field>
              {galat._ && <Pesan jenis="err">{galat._}</Pesan>}
              <div className="cta-row"><button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Menyimpan…' : 'Daftarkan vendor'}</button></div>
            </form>
          </section>
          <section className="kartu" aria-labelledby="h-saya">
            <h2 className="kartu-t" id="h-saya">Vendor yang saya daftarkan</h2>
            {!saya ? <Skeleton baris={3} /> : saya.length === 0 ? <p className="muted">Belum ada.</p> : (
              <ul className="ringkas vendor-saya">{saya.map((v) => (
                <li key={v.kode}><span className="vs-n"><b>{v.nama}</b><span className="muted cap">{v.kode} · {v.tipe} · {v.bank} {v.noRekening}</span></span><span className={`pill-st ${pill(v.status)}`}>{labelSt(v.status)}</span></li>
              ))}</ul>
            )}
          </section>
        </div>
      )}

      {tab === 'pengesahan' && bisaSahkan && (
        !antre ? <Skeleton baris={3} /> : antre.length === 0 ? <div className="kosong" role="status"><h2>Tidak ada vendor yang menunggu pengesahan</h2></div> : (
          <ul className="vendor-antre">{antre.map((v) => (
            <li key={v.kode} className="kartu">
              <div className="kartu-judul"><h2 className="kartu-t">{v.nama}</h2><span className="muted cap num">{v.kode} · {v.tipe}</span></div>
              <dl className="ds-grid">
                <div><dt>Bank</dt><dd>{v.bank}</dd></div><div><dt>No. rekening</dt><dd className="num">{v.noRekening}</dd></div>
                <div><dt>Pemilik rekening</dt><dd>{v.namaRekening}</dd></div><div><dt>NPWP</dt><dd>{v.npwp || '—'}</dd></div>
                <div><dt>Didaftarkan oleh</dt><dd>{v.didaftarkanOleh}</dd></div><div><dt>Tanggal</dt><dd>{v.tglDaftar}</dd></div>
              </dl>
              {v.peringatan.length > 0 && <Pesan jenis="warn"><ul className="hasil-bulk">{v.peringatan.map((p) => <li key={p}>{p}</li>)}</ul></Pesan>}
              {v.milikSaya && <Pesan jenis="info">Anda yang mendaftarkan vendor ini; pengesahan harus oleh Finance lain.</Pesan>}
              <div className="cta-row">
                <button type="button" className="btn btn-primary" disabled={sibuk || v.milikSaya} onClick={() => { setGalatDlg(null); setDlg({ aksi: 'approve', v }); }}>Sahkan</button>
                <button type="button" className="btn btn-secondary" disabled={sibuk} onClick={() => { setGalatDlg(null); setAlasan(''); setDlg({ aksi: 'reject', v }); }}>Tolak</button>
              </div>
            </li>
          ))}</ul>
        )
      )}

      <Dialog buka={!!dlg} onTutup={() => { if (!sibuk) setDlg(null); }} judul={dlg?.aksi === 'approve' ? 'Sahkan vendor?' : 'Tolak vendor'}>
        {dlg && (
          <form onSubmit={(e) => { e.preventDefault(); void putuskan(); }}>
            <div className="dlg-ringkas"><span className="num">{dlg.v.kode} · {dlg.v.nama}</span><strong className="num">{dlg.v.bank} {dlg.v.noRekening}</strong></div>
            {dlg.aksi === 'approve'
              ? <p className="muted">Pastikan nama pemilik rekening <b>{dlg.v.namaRekening}</b> dan nomor rekening sudah dicek ke dokumen vendor. Setelah disahkan vendor bisa dipakai di pengajuan.</p>
              : <>
                <div className="chips tombol-baris" role="group" aria-label="Template alasan">
                  {['Data rekening tidak sesuai dokumen', 'NPWP / identitas vendor perlu dicek', ...TEMPLATE_ALASAN.slice(0, 1)].map((t) => <button type="button" key={t} className="chip" onClick={() => setAlasan(t)}>{t}</button>)}
                </div>
                <div className="f"><label htmlFor="v-alasan">Alasan</label><textarea id="v-alasan" maxLength={ALASAN_MAX} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></div>
              </>}
            {galatDlg && <Pesan jenis="err">{galatDlg}</Pesan>}
            <div className="dlg-aksi">
              <button type="button" className="btn btn-secondary" onClick={() => setDlg(null)} disabled={sibuk}>Batal</button>
              <button type="submit" className={dlg.aksi === 'approve' ? 'btn btn-primary' : 'btn btn-danger'} disabled={sibuk || (dlg.aksi === 'reject' && !alasanValid(alasan))}>{sibuk ? 'Memproses…' : dlg.aksi === 'approve' ? 'Sahkan' : 'Tolak'}</button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
