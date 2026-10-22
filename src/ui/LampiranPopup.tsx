'use client';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './kit';

type Keadaan = 'diam' | 'muat' | 'gambar' | 'pdf' | 'gagal';

/**
 * Tombol "Lihat lampiran" yang membuka pratinjau di popup (tanpa pindah halaman). Gambar dimuat sebagai blob lewat proxy ber-otorisasi
 * (CSP mengizinkan img-src blob:). PDF tidak bisa disematkan (CSP object-src 'none') -> tombol buka di tab baru.
 */
export function LampiranPopup({ id, label = 'Lihat lampiran', kelas = 'btn btn-secondary' }: { id: string; label?: string; kelas?: string }) {
  const [buka, setBuka] = useState(false);
  const [keadaan, setKeadaan] = useState<Keadaan>('diam');
  const [src, setSrc] = useState<string | null>(null);
  const [percobaan, setPercobaan] = useState(0);
  const sudah = useRef(false);
  const url = `/api/pengajuan/${encodeURIComponent(id)}/lampiran`;

  // Muat sekali saat pertama dibuka (dan lagi hanya bila "Coba lagi"). Status TIDAK masuk dependensi: kalau masuk, pembersihan efek
  // membatalkan unduhan yang sedang berjalan begitu status berubah ke 'memuat'.
  useEffect(() => {
    if (!buka || percobaan === 0 || sudah.current) return;
    let batal = false;
    setKeadaan('muat');
    fetch(url, { credentials: 'same-origin' }).then(async (r) => {
      if (batal) return;
      if (!r.ok) { setKeadaan('gagal'); return; }
      const t = r.headers.get('content-type') ?? '';
      if (t.startsWith('image/')) { const u = URL.createObjectURL(await r.blob()); if (batal) { URL.revokeObjectURL(u); return; } setSrc(u); sudah.current = true; setKeadaan('gambar'); }
      else if (t === 'application/pdf') { sudah.current = true; setKeadaan('pdf'); }
      else setKeadaan('gagal');
    }).catch(() => { if (!batal) setKeadaan('gagal'); });
    return () => { batal = true; };
  }, [buka, percobaan, url]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  return (
    <>
      <button type="button" className={kelas} onClick={() => { setBuka(true); setPercobaan((n) => (n === 0 ? 1 : n)); }}>{label}</button>
      <Dialog buka={buka} onTutup={() => setBuka(false)} judul={`Lampiran ${id}`} lebar>
        <div className="lampiran-isi" aria-live="polite">
          {keadaan === 'muat' && <div className="skel baris" aria-busy="true" aria-label="Memuat lampiran" />}
          {keadaan === 'gambar' && src && <img src={src} alt={`Lampiran ${id}`} />}
          {keadaan === 'pdf' && <p className="muted">Lampiran berupa PDF. Buka di tab baru untuk melihatnya.</p>}
          {keadaan === 'gagal' && <p className="err-teks" role="alert">Lampiran tidak dapat dimuat. Tutup lalu coba lagi.
            <button type="button" className="link" onClick={() => setPercobaan((n) => n + 1)}>Coba lagi</button></p>}
        </div>
        <div className="dlg-aksi">
          <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">Buka di tab baru</a>
          <button type="button" className="btn btn-primary" onClick={() => setBuka(false)}>Tutup</button>
        </div>
      </Dialog>
    </>
  );
}
