'use client';
import { useRef, useState, type DragEvent } from 'react';
import { formatUkuran, GABUNG_MAKS_FILE, LAMPIRAN_MAX_BYTES } from '@/domain/lampiran';
import type { TahapUnggah } from '../unggah-lampiran';
import { Pesan } from '../kit';

export interface Sumber { file: File; ukuranAsli: number }
/** `file` = yang akan diunggah (satu file apa adanya, atau PDF gabungan bila `sumber` > 1). */
export interface Staged { file: File; previewUrl: string | null; ukuranAsli: number; sumber: Sumber[] }
const TEKS_TAHAP: Record<TahapUnggah, string> = { menyiapkan: 'Menyiapkan…', mengunggah: 'Mengunggah', memverifikasi: 'Memverifikasi file…' };

/** Pemilih lampiran: seret-lepas / pilih / kamera (di HP). Presentasional - kompres & unggah dikerjakan orchestrator. */
export function UnggahLampiranUI({ idTrx, punyaLampiran, staged, memproses, unggah, galat, onPilih, onHapus, onHapusSatu, onGeser }: {
  idTrx: string | null; punyaLampiran: boolean; staged: Staged | null; memproses: boolean;
  unggah: { tahap: TahapUnggah; bagian: number } | null; galat: string | null; onPilih: (f: File[]) => void; onHapus: () => void; onHapusSatu: (i: number) => void; onGeser: (i: number, arah: -1 | 1) => void;
}) {
  const [aktif, setAktif] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pilih = (fl: FileList | null) => { const f = fl ? Array.from(fl) : []; if (f.length) onPilih(f); if (input.current) input.current.value = ''; };
  const drop = (e: DragEvent) => { e.preventDefault(); setAktif(false); pilih(e.dataTransfer.files); };
  const pct = unggah ? Math.round(unggah.bagian * 100) : 0;

  return (
    <div className="f">
      <div className="lbl" id="lampiran-l">Lampiran invoice</div>
      <input ref={input} id="lampiran-input" className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple onChange={(e) => pilih(e.target.files)} aria-describedby="lampiran-h" />

      {unggah ? (
        <div className="kartu" role="status" aria-live="polite">
          <div className="cap-strong">{TEKS_TAHAP[unggah.tahap]}{unggah.tahap === 'mengunggah' ? ` ${pct}%` : ''}</div>
          <progress value={unggah.tahap === 'memverifikasi' ? 1 : unggah.bagian} max={1} aria-label="Kemajuan unggah" />
          <p className="hint">Jangan tutup halaman sampai selesai.</p>
        </div>
      ) : memproses ? (
        <div className="kartu" role="status"><div className="cap-strong">Menyiapkan file…</div><p className="hint">Mengecilkan foto dan menggabungkan file bila lebih dari satu.</p></div>
      ) : staged ? (
        <div className="kartu">
          <div className="file-row">
            {staged.previewUrl ? <img className="thumb" src={staged.previewUrl} alt="Pratinjau lampiran" /> : <div className="thumb" aria-hidden="true">PDF</div>}
            <div className="info">
              <div className="nama">{staged.sumber.length > 1 ? `${staged.sumber.length} file digabung jadi satu PDF` : staged.file.name}</div>
              <div className="cap muted">{formatUkuran(staged.file.size)}{staged.sumber.length === 1 && staged.ukuranAsli > staged.file.size ? ` · dikecilkan dari ${formatUkuran(staged.ukuranAsli)}` : ''} · diunggah saat Anda menekan Lanjut</div>
            </div>
            <div className="aksi">
              {staged.sumber.length < GABUNG_MAKS_FILE && <label htmlFor="lampiran-input" className="link-label">Tambah file</label>}
              <button type="button" className="link" onClick={onHapus}>{staged.sumber.length > 1 ? 'Hapus semua' : 'Hapus'}</button>
            </div>
          </div>
          {staged.sumber.length > 1 && (
            <ol className="file-urut" aria-label="Urutan file di dalam PDF gabungan">
              {staged.sumber.map((x, i) => (
                <li key={`${i}-${x.file.name}`}>
                  <span className="nama">{x.file.name}</span>
                  <span className="cap muted num">{formatUkuran(x.file.size)}</span>
                  <span className="aksi">
                    <button type="button" className="link" disabled={i === 0} onClick={() => onGeser(i, -1)} aria-label={`Naikkan ${x.file.name}`}>Naik</button>
                    <button type="button" className="link" disabled={i === staged.sumber.length - 1} onClick={() => onGeser(i, 1)} aria-label={`Turunkan ${x.file.name}`}>Turun</button>
                    <button type="button" className="link" onClick={() => onHapusSatu(i)} aria-label={`Hapus ${x.file.name}`}>Hapus</button>
                  </span>
                </li>
              ))}
            </ol>
          )}
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
          <div className="judul">Seret file invoice ke sini (boleh lebih dari satu)</div>
          <p className="hint">atau</p>
          <div className="tombol-baris">
            <label htmlFor="lampiran-input" className="btn btn-secondary btn-sm">Pilih file / ambil foto</label>
          </div>
        </div>
      )}
      <div className="hint" id="lampiran-h">PDF, JPG, atau PNG · maksimal {LAMPIRAN_MAX_BYTES / 1024 / 1024} MB. Foto otomatis dikecilkan. Boleh pilih beberapa file (maks. {GABUNG_MAKS_FILE}); semuanya digabung jadi satu PDF.</div>
      {galat && <Pesan jenis="err">{galat}</Pesan>}
    </div>
  );
}
