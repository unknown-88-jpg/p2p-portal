'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, Pemuat } from './kit';

/** Baca isi respons sambil melaporkan persentase (hanya bila ukuran diketahui lewat content-length; dibatasi 99 sampai benar-benar selesai). */
async function bacaDenganProgres(r: Response, tipe: string, onPersen: (p: number | null) => void): Promise<Blob> {
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total) return r.blob();
  const pembaca = r.body.getReader();
  const potongan: Uint8Array[] = [];
  let terbaca = 0;
  onPersen(0);
  for (;;) {
    const { done, value } = await pembaca.read();
    if (done) break;
    potongan.push(value); terbaca += value.byteLength;
    onPersen(Math.min(99, Math.floor((terbaca / total) * 100)));
  }
  onPersen(100);
  return new Blob(potongan as BlobPart[], { type: tipe });
}

type Keadaan = 'diam' | 'muat' | 'gambar' | 'pdf' | 'gagal';

/**
 * Tombol "Lihat lampiran" yang membuka pratinjau di popup (tanpa pindah halaman). Gambar dimuat sebagai blob lewat proxy ber-otorisasi
 * (CSP mengizinkan img-src blob:). PDF tidak bisa disematkan (CSP object-src 'none') -> tombol buka di tab baru.
 */
export function LampiranPopup({ id, label = 'Lihat lampiran', kelas = 'btn btn-secondary', ikon }: { id: string; label?: string; kelas?: string; ikon?: ReactNode }) {
  const [buka, setBuka] = useState(false);
  const [keadaan, setKeadaan] = useState<Keadaan>('diam');
  const [src, setSrc] = useState<string | null>(null);
  const [percobaan, setPercobaan] = useState(0);
  const [persen, setPersen] = useState<number | null>(null);
  const sudah = useRef(false);
  const url = `/api/pengajuan/${encodeURIComponent(id)}/lampiran`;

  // Muat sekali saat pertama dibuka (dan lagi hanya bila "Coba lagi"). Status TIDAK masuk dependensi: kalau masuk, pembersihan efek
  // membatalkan unduhan yang sedang berjalan begitu status berubah ke 'memuat'.
  useEffect(() => {
    if (!buka || percobaan === 0 || sudah.current) return;
    let batal = false;
    setKeadaan('muat');
    setPersen(null);
    fetch(url, { credentials: 'same-origin' }).then(async (r) => {
      if (batal) return;
      if (!r.ok) { setKeadaan('gagal'); return; }
      const t = r.headers.get('content-type') ?? '';
      if (t.startsWith('image/')) {
        const blob = await bacaDenganProgres(r, t, (p) => { if (!batal) setPersen(p); });
        const u = URL.createObjectURL(blob);
        if (batal) { URL.revokeObjectURL(u); return; }
        setSrc(u); sudah.current = true; setKeadaan('gambar');
      }
      else if (t === 'application/pdf') { sudah.current = true; setKeadaan('pdf'); }
      else setKeadaan('gagal');
    }).catch(() => { if (!batal) setKeadaan('gagal'); });
    return () => { batal = true; };
  }, [buka, percobaan, url]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  return (
    <>
      <button type="button" className={kelas} onClick={() => { setBuka(true); setPercobaan((n) => (n === 0 ? 1 : n)); }}>{ikon}{label}</button>
      <Dialog buka={buka} onTutup={() => setBuka(false)} judul={`Lampiran ${id}`} lebar>
        <div className="lampiran-isi" aria-live="polite" tabIndex={0} role="region" aria-label="Pratinjau lampiran">
          {keadaan === 'muat' && <Pemuat teks="Memuat lampiran…" persen={persen} />}
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
