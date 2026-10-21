'use client';
import { useRef, useState, type DragEvent } from 'react';
import { formatUkuran, LAMPIRAN_MAX_BYTES } from '@/domain/lampiran';
import type { TahapUnggah } from '../unggah-lampiran';
import { Pesan } from '../kit';

export interface Staged { file: File; previewUrl: string | null; ukuranAsli: number }
const TEKS_TAHAP: Record<TahapUnggah, string> = { menyiapkan: 'Menyiapkan…', mengunggah: 'Mengunggah', memverifikasi: 'Memverifikasi file…' };

/** Pemilih lampiran: seret-lepas / pilih / kamera (di HP). Presentasional - kompres & unggah dikerjakan orchestrator. */
export function UnggahLampiranUI({ idTrx, punyaLampiran, staged, memproses, unggah, galat, onPilih, onHapus }: {
  idTrx: string | null; punyaLampiran: boolean; staged: Staged | null; memproses: boolean;
  unggah: { tahap: TahapUnggah; bagian: number } | null; galat: string | null; onPilih: (f: File) => void; onHapus: () => void;
}) {
  const [aktif, setAktif] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pilih = (fl: FileList | null) => { const f = fl?.[0]; if (f) onPilih(f); if (input.current) input.current.value = ''; };
  const drop = (e: DragEvent) => { e.preventDefault(); setAktif(false); pilih(e.dataTransfer.files); };
  const pct = unggah ? Math.round(unggah.bagian * 100) : 0;

  return (
    <div className="f">
      <div className="lbl" id="lampiran-l">Lampiran invoice</div>
      <input ref={input} id="lampiran-input" className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => pilih(e.target.files)} aria-describedby="lampiran-h" />

      {unggah ? (
        <div className="kartu" role="status" aria-live="polite">
          <div className="cap-strong">{TEKS_TAHAP[unggah.tahap]}{unggah.tahap === 'mengunggah' ? ` ${pct}%` : ''}</div>
          <progress value={unggah.tahap === 'memverifikasi' ? 1 : unggah.bagian} max={1} aria-label="Kemajuan unggah" />
          <p className="hint">Jangan tutup halaman sampai selesai.</p>
        </div>
      ) : memproses ? (
        <div className="kartu" role="status"><div className="cap-strong">Menyiapkan gambar…</div><p className="hint">Mengecilkan ukuran foto agar cepat diunggah.</p></div>
      ) : staged ? (
        <div className="kartu">
          <div className="file-row">
            {staged.previewUrl ? <img className="thumb" src={staged.previewUrl} alt="Pratinjau lampiran" /> : <div className="thumb" aria-hidden="true">PDF</div>}
            <div className="info">
              <div className="nama">{staged.file.name}</div>
              <div className="cap muted">{formatUkuran(staged.file.size)}{staged.ukuranAsli > staged.file.size ? ` · dikecilkan dari ${formatUkuran(staged.ukuranAsli)}` : ''} · diunggah saat Anda menekan Lanjut</div>
            </div>
            <div className="aksi">
              <label htmlFor="lampiran-input" className="link-label">Ganti</label>
              <button type="button" className="link" onClick={onHapus}>Hapus</button>
            </div>
          </div>
        </div>
      ) : punyaLampiran && idTrx ? (
        <div className="kartu">
          <div className="file-row">
            <div className="thumb" aria-hidden="true">✓</div>
            <div className="info"><div className="nama">Lampiran sudah tersimpan</div><div className="cap muted">Terverifikasi oleh server.</div></div>
            <div className="aksi">
              <a href={`/api/pengajuan/${encodeURIComponent(idTrx)}/lampiran`} target="_blank" rel="noopener noreferrer">Lihat</a>
              <label htmlFor="lampiran-input" className="link-label">Ganti</label>
            </div>
          </div>
        </div>
      ) : (
        <div className={`dropzone${aktif ? ' aktif' : ''}`} onDragOver={(e) => { e.preventDefault(); setAktif(true); }} onDragLeave={() => setAktif(false)} onDrop={drop}>
          <div className="ikon" aria-hidden="true">⬆︎</div>
          <div className="judul">Seret file invoice ke sini</div>
          <p className="hint">atau</p>
          <div className="tombol-baris">
            <label htmlFor="lampiran-input" className="btn btn-secondary btn-sm">Pilih file / ambil foto</label>
          </div>
        </div>
      )}
      <div className="hint" id="lampiran-h">PDF, JPG, atau PNG · maksimal {LAMPIRAN_MAX_BYTES / 1024 / 1024} MB. Foto otomatis dikecilkan.</div>
      {galat && <Pesan jenis="err">{galat}</Pesan>}
    </div>
  );
}
