'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMessage, isApiError } from './api';
import { Chips, Field, Pesan, Skeleton, Toast, type IsiToast } from './kit';
import { unduhTeks } from './unduh';

type Jenis = 'keduanya' | 'pembelian' | 'pembayaran';
interface Riwayat { waktu: string; oleh: string; jenis: string; rentang: string; jumlah: string; namaFile: string; fileId: string }
interface Hasil { namaFile: string; fileId: string; csv: string; jumlahPembelian: number; jumlahPembayaran: number; peringatan: string[] }

/** F3-B: export jurnal Odoo (pembelian + pembayaran) — rentang tanggal WIB, file disimpan di Shared Drive + langsung terunduh. */
export function HalamanExportOdoo({ hariIni, awalBulan }: { hariIni: string; awalBulan: string }) {
  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(hariIni);
  const [jenis, setJenis] = useState<Jenis>('keduanya');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<Record<string, string>>({});
  const [peringatan, setPeringatan] = useState<string[]>([]);
  const [riwayat, setRiwayat] = useState<Riwayat[] | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [toast, setToast] = useState<IsiToast | null>(null);

  const muat = useCallback(async () => {
    try { setRiwayat((await api<{ riwayat: Riwayat[] }>('/api/finance/export/odoo', { method: 'GET' })).riwayat); setGalatMuat(null); }
    catch (e) { setGalatMuat(errMessage(e)); }
  }, []);
  useEffect(() => { void muat(); }, [muat]);

  const jalankan = async () => {
    if (sibuk) return;
    if (dari > sampai) { setGalat({ sampai: 'Tanggal selesai sebelum tanggal mulai.' }); return; }
    setSibuk(true); setGalat({}); setPeringatan([]);
    try {
      const h = await api<Hasil>('/api/finance/export/odoo', { body: { dari, sampai, jenis } });
      unduhTeks(h.namaFile, h.csv);
      setPeringatan(h.peringatan);
      setToast({ jenis: 'ok', teks: `${h.namaFile} diunduh & disimpan di Drive. Pembelian: ${h.jumlahPembelian} entry · Pembayaran: ${h.jumlahPembayaran} entry.` });
      void muat();
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x?.fields) setGalat(x.fields);
      setGalat((g) => ({ ...g, _: errMessage(e) }));
    } finally { setSibuk(false); }
  };

  const pilihan = useMemo(() => [
    { nilai: 'keduanya' as const, teks: 'Keduanya' }, { nilai: 'pembelian' as const, teks: 'Pembelian' }, { nilai: 'pembayaran' as const, teks: 'Pembayaran' },
  ], []);

  return (
    <>
      <div className="toast-wadah"><Toast isi={toast} onTutup={() => setToast(null)} /></div>
      <div className="toolbar"><h1 className="page-h">Export jurnal Odoo</h1></div>
      <div className="vendor-grid">
        <section className="kartu" aria-labelledby="h-exp">
          <h2 className="kartu-t" id="h-exp">Buat file import</h2>
          <p className="muted cap">Pembelian difilter tanggal invoice (kosong → tanggal submit), pembayaran difilter tanggal bayar. Rentang tanggal WIB, inklusif. Format CSV sama dengan sistem lama (Accounting › Journal Entries › Import).</p>
          <form onSubmit={(e) => { e.preventDefault(); void jalankan(); }}>
            <div className="grid2">
              <Field label="Dari tanggal" id="x-dari" galat={galat.dari}>{(p) => <input {...p} type="date" value={dari} max={hariIni} onChange={(e) => setDari(e.target.value)} />}</Field>
              <Field label="Sampai tanggal" id="x-sampai" galat={galat.sampai}>{(p) => <input {...p} type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />}</Field>
            </div>
            <Chips label="Jenis jurnal" nilai={jenis} onPilih={setJenis} pilihan={pilihan} />
            {galat._ && <Pesan jenis="err">{galat._}</Pesan>}
            {peringatan.length > 0 && <Pesan jenis="warn"><b>Periksa sebelum impor:</b><ul className="hasil-bulk">{peringatan.map((p) => <li key={p}>{p}</li>)}</ul></Pesan>}
            <div className="cta-row"><button type="submit" className="btn btn-primary" disabled={sibuk || !dari || !sampai}>{sibuk ? 'Menyusun…' : 'Export & unduh CSV'}</button></div>
          </form>
        </section>
        <section className="kartu" aria-labelledby="h-riw">
          <h2 className="kartu-t" id="h-riw">Riwayat export</h2>
          {galatMuat && <Pesan jenis="err">{galatMuat} <button type="button" className="link" onClick={() => void muat()}>Coba lagi</button></Pesan>}
          {!riwayat ? (galatMuat ? null : <Skeleton baris={3} />) : riwayat.length === 0 ? <p className="muted">Belum ada export.</p> : (
            <ul className="ringkas vendor-saya">{riwayat.map((r) => (
              <li key={`${r.fileId}-${r.waktu}`}>
                <span className="vs-n"><b>{r.rentang.replace('..', ' – ')} · {r.jenis}</b><span className="muted cap">{r.waktu} · {r.oleh} · {r.jumlah}</span></span>
                {r.fileId ? <a className="btn btn-secondary btn-sm" href={`/api/finance/export/odoo/${encodeURIComponent(r.fileId)}`} download={r.namaFile}>Unduh</a> : null}
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}
