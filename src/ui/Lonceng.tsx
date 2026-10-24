'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { IkonLonceng } from './icons';

interface Butir { kunci: string; judul: string; jumlah: number; href: string; nada: 'merah' | 'kuning' | 'biru' }
const INTERVAL_MS = 60_000;

/** Lonceng "perlu tindakan" (semua peran). Dimuat saat halaman dibuka, tiap 60 dtk selama tab terlihat, dan saat tab kembali aktif. */
export function Lonceng() {
  const [data, setData] = useState<{ butir: Butir[]; total: number } | null>(null);
  const [buka, setBuka] = useState(false);
  const wadah = useRef<HTMLDivElement>(null);

  const muat = useCallback(async () => {
    try { setData(await api<{ butir: Butir[]; total: number }>('/api/notifikasi', { method: 'GET' })); } catch { /* hiasan: diam saja */ }
  }, []);
  useEffect(() => {
    void muat();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void muat(); }, INTERVAL_MS);
    const v = () => { if (document.visibilityState === 'visible') void muat(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [muat]);
  useEffect(() => {
    if (!buka) return;
    const luar = (e: MouseEvent) => { if (!wadah.current?.contains(e.target as Node)) setBuka(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setBuka(false); };
    document.addEventListener('mousedown', luar); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', luar); document.removeEventListener('keydown', esc); };
  }, [buka]);

  const total = data?.total ?? 0;
  return (
    <div className="lonceng" ref={wadah}>
      <button type="button" className={`lonceng-btn${total ? ' ada' : ''}`} aria-expanded={buka} aria-haspopup="true"
        aria-label={total ? `${total} hal perlu tindakan` : 'Tidak ada yang perlu tindakan'} onClick={() => { setBuka(!buka); if (!buka) void muat(); }}>
        <IkonLonceng />
        {total > 0 && <span className="lonceng-n" aria-hidden="true">{total > 99 ? '99+' : total}</span>}
      </button>
      {buka && (
        <div className="lonceng-panel" role="region" aria-label="Perlu tindakan">
          <div className="lonceng-h">Perlu tindakan</div>
          {!data ? <p className="muted cap">Memuat…</p> : data.butir.length === 0 ? <p className="lonceng-kosong">Semua beres — tidak ada yang menunggu Anda.</p> : (
            <ul>{data.butir.map((b) => (
              <li key={b.kunci}><a href={b.href} className={`lonceng-i ${b.nada}`}><span className="titik" aria-hidden="true" /><span className="t">{b.judul}</span><span className="n">{b.jumlah}</span></a></li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
}
