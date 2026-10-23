'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { IkonCari } from './icons';
import { Dialog } from './kit';
import { rupiah } from '@/domain/pengajuan-form';
import { labelStatus } from '@/domain/status-label';

interface Hasil { id: string; vendor: string; invoice: string; status: string; nominal: number }

/** Ctrl/⌘+K: cari dokumen (ID, vendor, invoice, P.O, keperluan). Server hanya mengembalikan yang boleh dilihat (I13). */
export function PaletPencarian() {
  const [buka, setBuka] = useState(false);
  const [q, setQ] = useState('');
  const [hasil, setHasil] = useState<Hasil[]>([]);
  const [muat, setMuat] = useState(false);
  const [gagal, setGagal] = useState(false);
  const seq = useRef(0);
  const kolom = useRef<HTMLInputElement>(null);
  // autoFocus React tidak berlaku untuk isi <dialog> yang dibuka belakangan (showModal memfokuskan tombol pertama): fokuskan kolom cari sendiri.
  useEffect(() => { if (buka) requestAnimationFrame(() => kolom.current?.focus()); }, [buka]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuka(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHasil([]); setMuat(false); setGagal(false); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setMuat(true); setGagal(false);
      try {
        const r = await api<{ hasil: Hasil[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`, { method: 'GET' });
        if (n === seq.current) setHasil(r.hasil);
      } catch { if (n === seq.current) { setGagal(true); setHasil([]); } }
      finally { if (n === seq.current) setMuat(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const tutup = () => { setBuka(false); setQ(''); setHasil([]); };
  return (
    <>
      <button type="button" className="cari-trigger" onClick={() => setBuka(true)} aria-keyshortcuts="Control+K Meta+K"><IkonCari /><span className="ct-teks">Cari dokumen</span><kbd>Ctrl K</kbd></button>
      <Dialog buka={buka} onTutup={tutup} judul="Cari dokumen">
        <input ref={kolom} className="inp" type="search" placeholder="ID, vendor, no. invoice, P.O, keperluan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Kata kunci" />
        <div className="cari-hasil" aria-live="polite">
          {q.trim().length < 2 ? <p className="muted">Ketik minimal 2 huruf.</p>
            : gagal ? <p className="muted">Pencarian gagal. Coba lagi.</p>
            : muat ? <p className="muted">Mencari…</p>
            : hasil.length === 0 ? <p className="muted">Tidak ada dokumen yang cocok.</p>
            : <ul>{hasil.map((h) => (
              <li key={h.id}><a href={`/pengajuan/${encodeURIComponent(h.id)}`}><b>{h.id}</b> · {h.vendor || '—'}<span className="muted"> {h.invoice} · {rupiah(h.nominal)} · {labelStatus(h.status).label}</span></a></li>
            ))}</ul>}
        </div>
        <div className="dlg-aksi"><button className="btn btn-secondary" onClick={tutup}>Tutup</button></div>
      </Dialog>
    </>
  );
}
