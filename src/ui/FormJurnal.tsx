'use client';
import { useEffect, useRef, useState } from 'react';
import { CATATAN_MAX } from '@/domain/approval';
import { pertahankanKunci } from '@/domain/approval-ui';
import { JURNAL_MAKS, opsiCoa, validasiJurnal, type BarisCoa } from '@/domain/finance';
import { pilihKunci, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, hasilDipulihkan, isApiError, PESAN_DIPULIHKAN } from './api';
import { Dialog, Field, Pesan } from './kit';

export interface DokJurnal { id: string; vendorNama: string; etag: string }
const LABEL = ['Kategori (Level 1)', 'Head COA (Level 2)', 'Level 3', 'Level 4', 'Level 5'] as const;
const baru = (): string => crypto.randomUUID();

/**
 * F2-D: jurnal COA untuk satu dokumen atau beberapa yang dicentang ("isi sama untuk yang dicentang"). Dropdown bertingkat dari Master_COA;
 * level tanpa turunan otomatis "-". Validasi akhir & penerapan di server dalam satu batch; hasil per dokumen dilaporkan.
 */
export function FormJurnal({ target, onSelesai }: { target: readonly DokJurnal[]; onSelesai: (pesan: { jenis: 'ok' | 'warn'; teks: string }, muatUlang: boolean) => void }) {
  const [coa, setCoa] = useState<BarisCoa[] | null>(null);
  const [galatCoa, setGalatCoa] = useState<string | null>(null);
  const [lv, setLv] = useState<string[]>(['', '', '', '', '']);
  const [budget, setBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [dlg, setDlg] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef<KunciIdem | null>(null);

  useEffect(() => {
    api<{ coa: BarisCoa[] }>('/api/master/coa', { method: 'GET' }).then((r) => setCoa(r.coa)).catch((e) => setGalatCoa(errMessage(e)));
  }, []);

  const opsi = (n: number): string[] => (coa ? opsiCoa(coa, lv, n) : []);
  const ubah = (n: number, v: string) => setLv((x) => [...x.slice(0, n), v, ...['', '', '', '', ''].slice(n + 1)]);
  // Level tanpa turunan dikirim sebagai "-" (aturan lama).
  const isian = { lvl1: lv[0]!, lvl2: lv[1]!, lvl3: lv[2] || '-', lvl4: lv[3] || '-', lvl5: lv[4] || '-', budget };
  const cek = coa ? validasiJurnal(coa, isian) : null;
  const terlalu = target.length > JURNAL_MAKS;

  const kirim = async () => {
    if (sibuk || !cek?.ok || terlalu) return;
    setSibuk(true); setGalat(null);
    const body = { items: target.map((t) => ({ id: t.id, etag: t.etag, ...isian, ...(notes.trim() ? { notes: notes.trim() } : {}) })) };
    kunci.current = pilihKunci(kunci.current, JSON.stringify(body), baru);
    try {
      const r = await api<{ hasil: { berhasil: { id: string }[]; gagal: { id: string; alasan: string }[] } }>('/api/finance/jurnal', { body, headers: { 'idempotency-key': kunci.current.key } });
      if (hasilDipulihkan(r.hasil)) { kunci.current = null; setDlg(false); onSelesai({ jenis: 'warn', teks: PESAN_DIPULIHKAN }, true); return; }
      kunci.current = null; setDlg(false);
      const { berhasil, gagal } = r.hasil;
      onSelesai({ jenis: gagal.length ? 'warn' : 'ok', teks: `${berhasil.length} dokumen terjurnal ke ${cek.akun}.${gagal.length ? ` Gagal: ${gagal.map((g) => `${g.id} (${g.alasan})`).join('; ')}` : ''}` }, true);
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (!pertahankanKunci(x)) kunci.current = null;
      setGalat(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan "Posting jurnal" lagi - aman, tidak akan tercatat dua kali.');
    } finally { setSibuk(false); }
  };

  if (galatCoa) return <div className="vp"><Pesan jenis="err">Master COA belum bisa dimuat: {galatCoa}</Pesan></div>;
  return (
    <div className="vp">
      <h3 className="ds-h">Jurnal COA</h3>
      <p className="muted cap">{target.length > 1 ? `Isian ini diterapkan ke ${target.length} dokumen yang dicentang.` : 'Centang beberapa dokumen di daftar untuk menjurnal sekaligus dengan isian yang sama.'}</p>
      {terlalu && <Pesan jenis="warn">Maksimal {JURNAL_MAKS} dokumen sekali jurnal.</Pesan>}
      {LABEL.map((l, n) => {
        const o = opsi(n);
        const nonaktif = !coa || (n > 0 && !lv[n - 1]) || o.length === 0;
        return (
          <Field key={l} label={l} id={`jr-l${n}`} opsional={n >= 2}>
            {(p) => <select {...p} value={lv[n]} disabled={nonaktif} onChange={(e) => ubah(n, e.target.value)}>
              <option value="">{!coa ? 'Memuat…' : n > 0 && !lv[n - 1] ? '—' : o.length === 0 ? '- (tidak ada turunan)' : n >= 2 ? '- (tidak dipilih)' : 'Pilih…'}</option>
              {o.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>}
          </Field>
        );
      })}
      <Field label="Plafon budget" id="jr-budget" petunjuk="Kode/plafon budget (huruf besar). Dipakai sebagai analitik di export Odoo.">
        {(p) => <input {...p} value={budget} maxLength={60} autoComplete="off" onChange={(e) => setBudget(e.target.value.toUpperCase())} />}
      </Field>
      <Field label="Catatan Finance" id="jr-cat" opsional>{(p) => <textarea {...p} maxLength={CATATAN_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {cek && !cek.ok && (lv[0] || budget) && <p className="hint">{cek.alasan}</p>}
      {cek?.ok && <p className="cap">Akun dijurnal: <b>{cek.akun}</b></p>}
      {galat && !dlg && <Pesan jenis="err">{galat}</Pesan>}
      <div className="ip-aksi">
        <button type="button" className="btn btn-primary" disabled={sibuk || !cek?.ok || terlalu || target.length === 0} onClick={() => { setGalat(null); setDlg(true); }}>
          Posting jurnal{target.length > 1 ? ` (${target.length} dokumen)` : ''}
        </button>
      </div>
      <Dialog buka={dlg} onTutup={() => { if (!sibuk) setDlg(false); }} judul={`Posting jurnal ${target.length} dokumen?`}>
        <form onSubmit={(e) => { e.preventDefault(); void kirim(); }}>
          <div className="dlg-ringkas"><span className="num">{target.map((t) => t.id).slice(0, 6).join(', ')}{target.length > 6 ? ` +${target.length - 6}` : ''}</span><strong>{cek?.ok ? cek.akun : ''}</strong></div>
          <p className="muted">Budget {budget || '-'}. Dokumen yang valid lanjut ke Siap Dibayar; yang gagal dilaporkan tanpa membatalkan yang lain.</p>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => setDlg(false)} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Memproses…' : 'Posting jurnal'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
