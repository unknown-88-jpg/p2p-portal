'use client';
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { bacaKetikan, formatRibuan } from '@/domain/pengajuan-form';
import { labelStatus, type Nada } from '@/domain/status-label';
import { IkonDokumen, IkonInfo, IkonPerhatian, IkonProses, IkonSelesai, IkonSilang } from './icons';

// Komponen dasar (gaya: lihat globals.css). Presentasional; tanpa pemanggilan API.

export interface FieldProps { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }

export function Field({ label, opsional, galat, petunjuk, children, id }: {
  label: string; opsional?: boolean; galat?: string | undefined; petunjuk?: ReactNode; id?: string; children: (p: FieldProps) => ReactNode;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const desc = [galat ? `${fid}-err` : '', petunjuk ? `${fid}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="f">
      <label htmlFor={fid}>{label}{opsional && <span className="opt"> (opsional)</span>}</label>
      {children({ id: fid, ...(galat ? { 'aria-invalid': true as const } : {}), ...(desc ? { 'aria-describedby': desc } : {}) })}
      {galat && <div className="err" id={`${fid}-err`} role="alert">{galat}</div>}
      {petunjuk && !galat && <div className="hint" id={`${fid}-hint`}>{petunjuk}</div>}
    </div>
  );
}

/** Pilihan tunggal berbentuk chip. role=radiogroup; panah kiri/kanan memindahkan pilihan (pola WAI-ARIA radio). */
export function Chips<T extends string>({ label, nilai, pilihan, onPilih, kecil, galat, besar, labelTersembunyi }: {
  label: string; nilai: T | ''; pilihan: readonly { nilai: T; teks: string; deskripsi?: string; nada?: 'netral' | 'merah' | 'biru' | 'hijau'; jumlah?: number }[]; onPilih: (v: T) => void; kecil?: boolean; galat?: string | undefined; besar?: boolean; labelTersembunyi?: boolean;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const aktif = Math.max(0, pilihan.findIndex((p) => p.nilai === nilai));
  function tombol(e: KeyboardEvent, i: number) {
    const arah = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!arah) return;
    e.preventDefault();
    const n = (i + arah + pilihan.length) % pilihan.length;
    onPilih(pilihan[n]!.nilai);
    refs.current[n]?.focus();
  }
  return (
    <div className="f">
      <div className={labelTersembunyi ? 'sr-only' : 'lbl'} id={`${id}-l`}>{label}</div>
      <div className={besar ? 'chips-besar' : 'chips'} role="radiogroup" aria-labelledby={`${id}-l`} {...(galat ? { 'aria-describedby': `${id}-e` } : {})}>
        {pilihan.map((p, i) => (
          <button key={p.nilai} type="button" role="radio" aria-checked={p.nilai === nilai} tabIndex={i === aktif ? 0 : -1}
            ref={(el) => { refs.current[i] = el; }} className={`chip${kecil ? ' kecil' : ''}${besar ? ' chip-besar' : ''}${p.nada ? ` fl-${p.nada}` : ''}${p.jumlah === 0 ? ' nol' : ''}`}
            onClick={() => onPilih(p.nilai)} onKeyDown={(e) => tombol(e, i)}>
            {besar ? <><span className="t">{p.teks}</span>{p.deskripsi && <span className="d">{p.deskripsi}</span>}</> : p.jumlah !== undefined ? <><span>{p.teks}</span><span className="cn">{p.jumlah}</span></> : p.teks}
          </button>
        ))}
      </div>
      {galat && <div className="err" id={`${id}-e`} role="alert">{galat}</div>}
    </div>
  );
}

/**
 * Input Rupiah: pemisah ribuan diformat saat mengetik, posisi kursor dijaga (dihitung dari jumlah digit di kiri kursor).
 * Ketikan yang TIDAK bisa diurai dibiarkan apa adanya supaya galatnya tampil (tidak pernah "dibersihkan" diam-diam jadi angka lain).
 */
export function UangInput({ nilai, onUbah, onBlur, fp, placeholder }: { nilai: string; onUbah: (v: string) => void; onBlur?: () => void; fp: FieldProps; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => { if (caret.current !== null && ref.current && document.activeElement === ref.current) ref.current.setSelectionRange(caret.current, caret.current); caret.current = null; });
  return (
    <div className="uang">
      <input {...fp} ref={ref} inputMode="numeric" autoComplete="off" placeholder={placeholder ?? '0'} value={nilai} onBlur={onBlur}
        onChange={(e) => {
          const mentah = e.target.value;
          const pos = e.target.selectionStart ?? mentah.length;
          const r = bacaKetikan(nilai, mentah);
          if (!r.ok || !/\d/.test(mentah)) { onUbah(r.ok ? '' : mentah); return; }
          const digitDiKiri = mentah.slice(0, pos).replace(/\D/g, '').length;
          const baru = formatRibuan(r.n);
          let seen = 0, p = 0;
          for (; p < baru.length && seen < digitDiKiri; p++) if (/\d/.test(baru[p]!)) seen++;
          caret.current = p;
          onUbah(baru);
        }} />
    </div>
  );
}

// Ikon status: jam = sedang menunggu/berjalan, centang = selesai/siap, segitiga = perlu perhatian, silang = ditolak. Warna bukan satu-satunya penanda.
const IKON_STATUS: Record<Nada, () => ReactNode> = {
  abu: () => <IkonDokumen />, biru: () => <IkonProses />, cyan: () => <IkonProses />, kuning: () => <IkonProses />, oranye: () => <IkonProses />,
  'hijau-muda': () => <IkonSelesai />, hijau: () => <IkonSelesai />, merah: () => <IkonPerhatian />, 'merah-tua': () => <IkonSilang />,
};
export const StatusPill = ({ status }: { status: string }) => { const l = labelStatus(status); return <span className={`pill-st ${l.nada}`}>{IKON_STATUS[l.nada]()}{l.label}</span>; };

export function Pesan({ jenis, children, role }: { jenis: 'err' | 'ok' | 'warn' | 'info'; children: ReactNode; role?: 'alert' | 'status' }) {
  const Ikon = jenis === 'ok' ? IkonSelesai : jenis === 'info' ? IkonInfo : IkonPerhatian;
  return <div className={`msg ${jenis}`} role={role ?? (jenis === 'err' ? 'alert' : 'status')}><Ikon /><div className="msg-isi">{children}</div></div>;
}

export function Skeleton({ baris = 3 }: { baris?: number }) {
  return <div aria-busy="true" aria-label="Memuat">{Array.from({ length: baris }, (_, i) => <div key={i} className="skel baris" />)}</div>;
}

/** Dialog modal bawaan <dialog>: fokus terkunci & Esc menutup (perilaku peramban), tanpa pustaka. */
export function Dialog({ buka, onTutup, judul, children, lebar }: { buka: boolean; onTutup: () => void; judul: string; children: ReactNode; lebar?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (buka && !d.open) d.showModal();
    if (!buka && d.open) d.close();
  }, [buka]);
  return (
    <dialog ref={ref} className={lebar ? 'lebar' : undefined} aria-labelledby={id} onClose={onTutup} onCancel={(e) => { e.preventDefault(); onTutup(); }}>
      <div className="dlg"><h2 id={id}>{judul}</h2>{children}</div>
    </dialog>
  );
}
