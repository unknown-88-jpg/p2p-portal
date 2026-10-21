'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bisaBulk, alasanValid, catatanValid, itemBerikutnya, perluMuatUlang, pertahankanKunci, type ItemInbox } from '@/domain/approval-ui';
import { CATATAN_MAX, ALASAN_MAX, TEMPLATE_ALASAN } from '@/domain/approval';
import { rupiah, pilihKunci, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, isApiError, type ApiError } from './api';
import { Dialog, Pesan, Skeleton } from './kit';

interface Item extends ItemInbox {
  tanggal: string; company: string; brand: string; departement: string; tipe: string; pic: string; description: string; eventProject: string;
  notesUser: string; poNumber: string; vendorNama: string; noInvoice: string; dateInvoice: string; dueDate: string; jenisPembayaran: string;
  invoiceAmount: number; diskon: number; biayaLainnya: number; statusPPN: string; dpp: number; ppnAmount: number; nominal: number;
  perluCFO: boolean; punyaLampiran: boolean;
}
type Dlg = null | 'setuju' | 'tolak' | 'stepup' | 'bulk';
interface HasilBulk { id: string; ok: boolean; pesan: string }

const baru = (): string => crypto.randomUUID();
const Baris = ({ l, v }: { l: string; v: string }) => (v ? <div className="kvr"><dt>{l}</dt><dd>{v}</dd></div> : null);

export function InboxPersetujuan({ idAwal }: { idAwal?: string | undefined }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(idAwal ?? null);
  const [detailHP, setDetailHP] = useState<boolean>(!!idAwal);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [notes, setNotes] = useState('');
  const [alasan, setAlasan] = useState('');
  const [pw, setPw] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [info, setInfo] = useState<{ jenis: 'ok' | 'warn'; teks: string } | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [hasilBulk, setHasilBulk] = useState<HasilBulk[] | null>(null);
  const [progres, setProgres] = useState<string | null>(null);
  const kunci = useRef<KunciIdem | null>(null);

  const muat = useCallback(async (): Promise<Item[] | null> => {
    try {
      const r = await api<{ items: Item[] }>('/api/approvals/inbox', { method: 'GET' });
      setItems(r.items); setGalatMuat(null);
      setPilih((p) => new Set([...p].filter((id) => r.items.some((i) => i.id === id && bisaBulk(i)))));
      return r.items;
    } catch (e) { setGalatMuat(errMessage(e)); return null; }
  }, []);
  useEffect(() => { void muat(); }, [muat]);

  const ids = useMemo(() => (items ?? []).map((i) => i.id), [items]);
  const cur = useMemo(() => items?.find((i) => i.id === sel) ?? null, [items, sel]);
  // Desktop: otomatis pilih item pertama bila belum ada pilihan valid. (HP: tetap di daftar sampai diketuk.)
  const tampilCur = cur ?? (items && items.length && !detailHP ? items[0]! : null);

  const pilihItem = (id: string | null) => {
    setSel(id); setDetailHP(!!id); setGalat(null); setInfo(null);
    try { window.history.replaceState(null, '', id ? `/persetujuan?id=${encodeURIComponent(id)}` : '/persetujuan'); } catch { /* abaikan */ }
  };
  // Event 'close' <dialog> juga terpicu saat ditutup lewat kode (buka=false); hanya dialog yang masih AKTIF yang boleh mereset state.
  const tutup = (k: Dlg) => () => { if (!sibuk && dlg === k) { setDlg(null); setGalat(null); setPw(''); } };

  /** Setelah aksi sukses/konflik: muat ulang & pindah ke item berikutnya. */
  const sesudah = async (idSelesai: string, pesan: { jenis: 'ok' | 'warn'; teks: string }) => {
    const sebelum = ids;
    const baruList = await muat();
    setInfo(pesan);
    const sisa = baruList ? baruList.map((i) => i.id) : sebelum.filter((x) => x !== idSelesai);
    pilihItem(itemBerikutnya(sebelum, idSelesai) && sisa.includes(itemBerikutnya(sebelum, idSelesai)!) ? itemBerikutnya(sebelum, idSelesai) : sisa[0] ?? null);
    setInfo(pesan);
  };

  const kirimSetuju = async (it: Item, catatan: string): Promise<void> => {
    kunci.current = pilihKunci(kunci.current, `${it.id}|${it.etag}|${catatan}`, baru);
    await api(`/api/approvals/${encodeURIComponent(it.id)}/approve`, {
      body: { etag: it.etag, ...(catatan ? { notes: catatan } : {}) }, headers: { 'idempotency-key': kunci.current.key },
    });
    kunci.current = null;
  };

  const setuju = async (lanjut = false) => {
    if (!tampilCur || (sibuk && !lanjut) || !catatanValid(notes)) return;
    setSibuk(true); setGalat(null);
    try {
      await kirimSetuju(tampilCur, notes.trim());
      setDlg(null); setNotes('');
      await sesudah(tampilCur.id, { jenis: 'ok', teks: `${tampilCur.id} disetujui.` });
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x?.code === 'FORBIDDEN' && x.fields?.stepUp === 'required') { setDlg('stepup'); setGalat(null); }
      else {
        if (!pertahankanKunci(x)) kunci.current = null;
        setGalat(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan "Setujui" lagi - aman, tidak akan tercatat dua kali.');
        if (x && perluMuatUlang(x.code)) { setDlg(null); await sesudah(tampilCur.id, { jenis: 'warn', teks: `${tampilCur.id}: ${errMessage(e).replace(/\s*Muat ulang daftar\.?$/, '')} Daftar sudah dimuat ulang.` }); }
      }
    } finally { setSibuk(false); }
  };

  const konfirmasiStepUp = async () => {
    if (!pw || sibuk) return;
    setSibuk(true); setGalat(null);
    try {
      await api('/api/auth/step-up', { body: { password: pw } });
      setPw('');
      await setuju(true); // tetap di dialog step-up; galat lain tampil di sana
      return;
    } catch (e) { setGalat(errMessage(e)); }
    finally { setSibuk(false); }
  };

  const tolak = async () => {
    if (!tampilCur || sibuk || !alasanValid(alasan)) return;
    const it = tampilCur;
    setSibuk(true); setGalat(null);
    try {
      kunci.current = pilihKunci(kunci.current, `T|${it.id}|${it.etag}|${alasan.trim()}`, baru);
      await api(`/api/approvals/${encodeURIComponent(it.id)}/reject`, { body: { etag: it.etag, alasan: alasan.trim() }, headers: { 'idempotency-key': kunci.current.key } });
      kunci.current = null; setDlg(null); setAlasan('');
      await sesudah(it.id, { jenis: 'ok', teks: `${it.id} dikembalikan ke PIC untuk direvisi.` });
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (!pertahankanKunci(x)) kunci.current = null;
      setGalat(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan "Kembalikan" lagi - aman.');
      if (x && perluMuatUlang(x.code)) { setDlg(null); await sesudah(it.id, { jenis: 'warn', teks: `${it.id}: ${errMessage(e).replace(/\s*Muat ulang daftar\.?$/, '')} Daftar sudah dimuat ulang.` }); }
    } finally { setSibuk(false); }
  };

  const bulk = async () => {
    if (!items || sibuk) return;
    const target = items.filter((i) => pilih.has(i.id) && bisaBulk(i));
    setSibuk(true); setHasilBulk([]);
    const hasil: HasilBulk[] = [];
    for (const [n, it] of target.entries()) {
      setProgres(`Memproses ${n + 1} dari ${target.length}: ${it.id}`);
      try {
        await api(`/api/approvals/${encodeURIComponent(it.id)}/approve`, { body: { etag: it.etag }, headers: { 'idempotency-key': baru() } });
        hasil.push({ id: it.id, ok: true, pesan: 'Disetujui' });
      } catch (e) { hasil.push({ id: it.id, ok: false, pesan: isApiError(e) ? errMessage(e) : 'Koneksi terputus - cek status dokumen sebelum mengulang.' }); }
      setHasilBulk([...hasil]);
    }
    setProgres(null); setSibuk(false); setPilih(new Set());
    await muat();
    pilihItem(null);
  };

  if (galatMuat && !items) return <Pesan jenis="err">{galatMuat} <button type="button" className="link" onClick={() => { setGalatMuat(null); void muat(); }}>Coba lagi</button></Pesan>;
  if (!items) return <Skeleton baris={4} />;

  const nPilih = [...pilih].length;
  const kosong = items.length === 0;

  return (
    <>
      {info && <Pesan jenis={info.jenis}>{info.teks}</Pesan>}
      {hasilBulk && !sibuk && hasilBulk.length > 0 && (
        <Pesan jenis={hasilBulk.every((h) => h.ok) ? 'ok' : 'warn'}>
          <strong>{hasilBulk.filter((h) => h.ok).length} dari {hasilBulk.length} disetujui.</strong>
          <ul className="hasil-bulk">{hasilBulk.filter((h) => !h.ok).map((h) => <li key={h.id}>{h.id}: {h.pesan}</li>)}</ul>
          <button type="button" className="link" onClick={() => setHasilBulk(null)}>Tutup</button>
        </Pesan>
      )}
      {progres && <Pesan jenis="ok" role="status">{progres}</Pesan>}
      {kosong ? (
        <div className="kosong" role="status"><h2>Tidak ada yang menunggu persetujuan</h2><p className="muted">Pengajuan baru dari tim Anda akan muncul di sini.</p></div>
      ) : (
        <div className={`inbox${detailHP ? ' hp-detail' : ''}`}>
          <section className="inbox-list" aria-label="Menunggu persetujuan">
            <div className="inbox-head">
              <span className="muted">{items.length} dokumen menunggu</span>
              {nPilih > 0 && <button type="button" className="btn btn-primary btn-sm" disabled={sibuk} onClick={() => { setGalat(null); setDlg('bulk'); }}>Setujui {nPilih} terpilih</button>}
            </div>
            <ul className="daftar">
              {items.map((i) => (
                <li key={i.id} className={`inbox-row${tampilCur?.id === i.id ? ' aktif' : ''}`}>
                  {bisaBulk(i) && <input type="checkbox" className="pilih-cb" aria-label={`Pilih ${i.id} untuk persetujuan massal`} checked={pilih.has(i.id)}
                    onChange={(e) => setPilih((p) => { const n = new Set(p); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />}
                  <button type="button" className="doc" aria-current={tampilCur?.id === i.id ? 'true' : undefined} onClick={() => pilihItem(i.id)}>
                    <span className="id">{i.id} · {i.tanggal}</span>
                    <span className="kanan"><span className="nominal num">{rupiah(i.nominal)}</span>{i.perluCFO && <span className="badge-cfo">CFO</span>}</span>
                    <span className="vendor">{i.vendorNama || '—'}</span>
                    <span className="desk">{[i.pic, i.brand, i.departement].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="inbox-detail" aria-label="Detail dokumen">
            {tampilCur ? (
              <>
                <button type="button" className="link kembali" onClick={() => pilihItem(null)}>← Kembali ke daftar</button>
                <h2 className="det-h">{tampilCur.vendorNama || '—'}</h2>
                <p className="muted num">{tampilCur.id} · {tampilCur.tanggal}</p>
                <div className="hero-nominal card">
                  <div className="nominal-besar num">{rupiah(tampilCur.nominal)}</div>
                  <div className="cfo-baris">{tampilCur.perluCFO && <span className="badge-cfo">Perlu persetujuan CFO</span>}{tampilCur.butuhStepUp && <span className="pill-st kuning">Perlu konfirmasi password</span>}</div>
                </div>
                {tampilCur.terkunci && <Pesan jenis="warn">{tampilCur.terkunci}</Pesan>}
                <dl className="kvs">
                  <Baris l="Diajukan oleh" v={tampilCur.pic} /><Baris l="Perusahaan / Brand" v={[tampilCur.company, tampilCur.brand].filter(Boolean).join(' / ')} />
                  <Baris l="Departemen" v={tampilCur.departement} /><Baris l="Tipe" v={tampilCur.tipe} /><Baris l="Keperluan" v={tampilCur.description} />
                  <Baris l="Event / Project" v={tampilCur.eventProject} /><Baris l="Catatan PIC" v={tampilCur.notesUser} />
                  <Baris l="No. P.O" v={tampilCur.poNumber !== '-' ? tampilCur.poNumber : ''} /><Baris l="No. Invoice" v={tampilCur.noInvoice} />
                  <Baris l="Tanggal invoice" v={tampilCur.dateInvoice} /><Baris l="Jatuh tempo" v={tampilCur.dueDate} /><Baris l="Jenis pembayaran" v={tampilCur.jenisPembayaran} />
                  <Baris l="Nilai invoice" v={rupiah(tampilCur.invoiceAmount)} />
                  {tampilCur.diskon ? <Baris l="Diskon" v={rupiah(tampilCur.diskon)} /> : null}
                  {tampilCur.biayaLainnya ? <Baris l="Biaya lainnya" v={rupiah(tampilCur.biayaLainnya)} /> : null}
                  <Baris l="Status PPN" v={tampilCur.statusPPN} />
                  {tampilCur.ppnAmount ? <Baris l="PPN" v={rupiah(tampilCur.ppnAmount)} /> : null}
                </dl>
                <p>{tampilCur.punyaLampiran
                  ? <a className="btn btn-secondary btn-sm" href={`/api/pengajuan/${encodeURIComponent(tampilCur.id)}/lampiran`} target="_blank" rel="noopener noreferrer">Lihat lampiran invoice</a>
                  : <span className="muted">Tidak ada lampiran.</span>}</p>
                <div className="aksi-detail">
                  <button type="button" className="btn btn-secondary" disabled={sibuk} onClick={() => { setGalat(null); setAlasan(''); setDlg('tolak'); }}>Kembalikan</button>
                  <button type="button" className="btn btn-primary" disabled={sibuk || !!tampilCur.terkunci} aria-disabled={!!tampilCur.terkunci || undefined}
                    onClick={() => { setGalat(null); setNotes(''); setDlg('setuju'); }}>Setujui</button>
                </div>
              </>
            ) : <p className="muted">Pilih dokumen di daftar.</p>}
          </section>
        </div>
      )}

      <Dialog buka={dlg === 'setuju'} onTutup={tutup('setuju')} judul="Setujui pengajuan?">
        {tampilCur && (
          <form onSubmit={(e) => { e.preventDefault(); void setuju(); }}>
            <p>{tampilCur.id} · {tampilCur.vendorNama} · <strong className="num">{rupiah(tampilCur.nominal)}</strong></p>
            <div className="f"><label htmlFor="ib-notes">Catatan (opsional)</label>
              <textarea id="ib-notes" maxLength={CATATAN_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            {galat && <Pesan jenis="err">{galat}</Pesan>}
            <div className="dlg-aksi">
              <button type="button" className="btn btn-secondary" onClick={tutup('setuju')} disabled={sibuk}>Batal</button>
              <button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Memproses…' : 'Setujui'}</button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog buka={dlg === 'stepup'} onTutup={tutup('stepup')} judul="Konfirmasi password">
        <form onSubmit={(e) => { e.preventDefault(); void konfirmasiStepUp(); }}>
          <p className="muted">Nominal ≥ Rp 5.000.000 butuh konfirmasi password Anda. Berlaku 5 menit.</p>
          <div className="f"><label htmlFor="ib-pw">Password</label>
            <input id="ib-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={tutup('stepup')} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk || !pw}>{sibuk ? 'Memproses…' : 'Konfirmasi & setujui'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog buka={dlg === 'tolak'} onTutup={tutup('tolak')} judul="Kembalikan ke PIC">
        <form onSubmit={(e) => { e.preventDefault(); void tolak(); }}>
          <p className="muted">Dokumen kembali ke status perlu revisi. Alasan akan dibaca PIC.</p>
          <div className="chips tombol-baris" role="group" aria-label="Template alasan">
            {TEMPLATE_ALASAN.map((t) => <button type="button" key={t} className="chip" onClick={() => setAlasan(t)}>{t}</button>)}
          </div>
          <div className="f"><label htmlFor="ib-alasan">Alasan</label>
            <textarea id="ib-alasan" maxLength={ALASAN_MAX} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={tutup('tolak')} disabled={sibuk}>Batal</button>
            <button type="submit" className="btn btn-danger" disabled={sibuk || !alasanValid(alasan)}>{sibuk ? 'Memproses…' : 'Kembalikan'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog buka={dlg === 'bulk'} onTutup={tutup('bulk')} judul={`Setujui ${nPilih} dokumen?`}>
        <p className="muted">Hanya dokumen di bawah Rp 5.000.000. Diproses satu per satu; yang gagal ditampilkan alasannya.</p>
        <div className="dlg-aksi">
          <button type="button" className="btn btn-secondary" onClick={tutup('bulk')} disabled={sibuk}>Batal</button>
          <button type="button" className="btn btn-primary" disabled={sibuk} onClick={() => { setDlg(null); void bulk(); }}>Setujui semua</button>
        </div>
      </Dialog>
    </>
  );
}

export type { ApiError };
