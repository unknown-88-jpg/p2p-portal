'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bisaBulk, alasanValid, catatanValid, itemBerikutnya, perluMuatUlang, pertahankanKunci, type ItemInbox } from '@/domain/approval-ui';
import { CATATAN_MAX, ALASAN_MAX, TEMPLATE_ALASAN } from '@/domain/approval';
import { rupiah, pilihKunci, type KunciIdem } from '@/domain/pengajuan-form';
import { api, errMessage, isApiError, type ApiError } from './api';
import { Dialog, Pesan, Skeleton, Toast, type IsiToast } from './kit';
import { IkonKlip, IkonKunci, IkonMata, IkonMataCoret, IkonSelesai } from './icons';
import { LampiranPopup } from './LampiranPopup';

interface Item extends ItemInbox {
  tanggal: string; company: string; brand: string; departement: string; tipe: string; pic: string; description: string; eventProject: string;
  notesUser: string; poNumber: string; vendorNama: string; noInvoice: string; dateInvoice: string; dueDate: string; jenisPembayaran: string;
  invoiceAmount: number; diskon: number; biayaLainnya: number; statusPPN: string; dpp: number; ppnAmount: number; nominal: number;
  perluCFO: boolean; punyaLampiran: boolean;
}
type Dlg = null | 'setuju' | 'tolak' | 'stepup' | 'bulk';
interface HasilBulk { id: string; ok: boolean; pesan: string }

const baru = (): string => crypto.randomUUID();
const Info = ({ l, v }: { l: string; v: string }) => (v ? <div><dt>{l}</dt><dd>{v}</dd></div> : null);
const RingkasanDok = ({ it }: { it: Pick<Item, 'id' | 'vendorNama' | 'nominal'> }) => (
  <div className="dlg-ringkas"><span className="num">{it.id} · {it.vendorNama || '—'}</span><strong className="num">{rupiah(it.nominal)}</strong></div>
);
const Kepala = ({ meta }: { meta?: ReactNode }) => <div className="inbox-top"><h1 className="page-h">Persetujuan</h1>{meta}</div>;

export function InboxPersetujuan({ idAwal }: { idAwal?: string | undefined }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(idAwal ?? null);
  const [detailHP, setDetailHP] = useState<boolean>(!!idAwal);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [notes, setNotes] = useState('');
  const [alasan, setAlasan] = useState('');
  const [pw, setPw] = useState('');
  const [lihatPw, setLihatPw] = useState(false);
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
  // Ringkasan setuju massal sebagai pop-up; objek dibuat ulang hanya bila hasilnya berubah (supaya hitung mundur tutup otomatis tidak terulang tiap render).
  const toastBulk = useMemo<IsiToast | null>(() => (hasilBulk && !sibuk && hasilBulk.length > 0 ? {
    jenis: hasilBulk.every((h) => h.ok) ? 'ok' : 'warn',
    teks: <><strong>{hasilBulk.filter((h) => h.ok).length} dari {hasilBulk.length} disetujui.</strong>{hasilBulk.some((h) => !h.ok) && <ul className="hasil-bulk">{hasilBulk.filter((h) => !h.ok).map((h) => <li key={h.id}>{h.id}: {h.pesan}</li>)}</ul>}</>,
  } : null), [hasilBulk, sibuk]);
  const cur = useMemo(() => items?.find((i) => i.id === sel) ?? null, [items, sel]);
  // Desktop: otomatis pilih item pertama bila belum ada pilihan valid. (HP: tetap di daftar sampai diketuk.)
  const tampilCur = cur ?? (items && items.length && !detailHP ? items[0]! : null);

  const pilihItem = (id: string | null) => {
    setSel(id); setDetailHP(!!id); setGalat(null); setInfo(null);
    try { window.history.replaceState(null, '', id ? `/persetujuan?id=${encodeURIComponent(id)}` : '/persetujuan'); } catch { /* abaikan */ }
  };
  // Event 'close' <dialog> juga terpicu saat ditutup lewat kode (buka=false); hanya dialog yang masih AKTIF yang boleh mereset state.
  const tutup = (k: Dlg) => () => { if (!sibuk && dlg === k) { setDlg(null); setGalat(null); setPw(''); setLihatPw(false); } };

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

  if (galatMuat && !items) return <><Kepala /><Pesan jenis="err">{galatMuat} <button type="button" className="link" onClick={() => { setGalatMuat(null); void muat(); }}>Coba lagi</button></Pesan></>;
  if (!items) return <><Kepala /><Skeleton baris={4} /></>;

  const nPilih = [...pilih].length;
  const kosong = items.length === 0;
  const totalNominal = items.reduce((t, i) => t + i.nominal, 0);
  const adaBulk = items.some(bisaBulk);

  return (
    <>
      <Kepala meta={kosong ? null : <><span className="muted">{items.length} dokumen menunggu</span><span className="inbox-total num">Total {rupiah(totalNominal)}</span></>} />
      <div className="toast-wadah"><Toast isi={info} onTutup={() => setInfo(null)} /><Toast isi={toastBulk} onTutup={() => setHasilBulk(null)} /></div>
      {progres && <Pesan jenis="ok" role="status">{progres}</Pesan>}
      {kosong ? (
        <div className="kosong" role="status"><h2>Tidak ada yang menunggu persetujuan</h2><p className="muted">Pengajuan baru dari tim Anda akan muncul di sini.</p></div>
      ) : (
        <div className="inbox-wrap"><div className={`inbox${detailHP ? ' hp-detail' : ''}`}>
          <section className="inbox-list" aria-label="Menunggu persetujuan">
            <div className="inbox-head">
              {nPilih > 0
                ? <button type="button" className="btn btn-primary btn-sm" disabled={sibuk} onClick={() => { setGalat(null); setDlg('bulk'); }}>Setujui {nPilih} terpilih</button>
                : adaBulk && <span className="muted cap">Centang dokumen untuk menyetujui sekaligus</span>}
            </div>
            <ul className="ib-daftar">
              {items.map((i) => (
                <li key={i.id} className={`inbox-row${tampilCur?.id === i.id ? ' aktif' : ''}`}>
                  <button type="button" className="ib-kartu" aria-current={tampilCur?.id === i.id ? 'true' : undefined} onClick={() => pilihItem(i.id)}>
                    <span className="ib-h">
                      <span className="ib-v">{i.vendorNama || '—'}</span>
                      <span className="ib-meta"><span className="dok-id num">{i.id}</span><span className="ib-umur">{i.tanggal}</span>{i.perluCFO && <span className="fin-badges"><span className="badge-cfo">CFO</span></span>}</span>
                    </span>
                    <span className="ib-b">
                      <span className="ib-k"><span className="ib-dt">Jatuh tempo</span><span className="ib-dd num">{i.dueDate || '—'}</span></span>
                      <span className="ib-k kanan"><span className="ib-dt">Nominal</span><span className="ib-dd ib-n num">{rupiah(i.nominal)}</span></span>
                    </span>
                  </button>
                  {bisaBulk(i) && <label className="pilih-tap"><input type="checkbox" className="pilih-cb" aria-label={`Pilih ${i.id} untuk persetujuan massal`} checked={pilih.has(i.id)}
                    onChange={(e) => setPilih((p) => { const n = new Set(p); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} /></label>}
                </li>
              ))}
            </ul>
          </section>

          {tampilCur ? (
            <>
              <section className="inbox-detail" aria-label="Detail dokumen">
                <button type="button" className="link kembali" onClick={() => pilihItem(null)}>← Kembali ke daftar</button>
                <div className="ds-kepala">
                  <div className="ds-vendor">
                    <h2 className="ds-nama">{tampilCur.vendorNama || '—'}</h2>
                    <p className="ds-sub num">{tampilCur.id} · {tampilCur.tanggal}</p>
                  </div>
                  {tampilCur.punyaLampiran
                    ? <LampiranPopup id={tampilCur.id} label="Lihat lampiran invoice" kelas="btn btn-secondary btn-sm" ikon={<IkonKlip />} />
                    : <span className="muted cap">Tidak ada lampiran</span>}
                </div>
                {tampilCur.terkunci && <Pesan jenis="warn">{tampilCur.terkunci}</Pesan>}
                <div className="ds">
                  <h3 className="ds-h">Pengaju</h3>
                  <dl className="ds-grid">
                    <Info l="Diajukan oleh" v={tampilCur.pic} /><Info l="Perusahaan / Brand" v={[tampilCur.company, tampilCur.brand].filter(Boolean).join(' / ')} />
                    <Info l="Departemen" v={tampilCur.departement} /><Info l="Tipe" v={tampilCur.tipe} />
                  </dl>
                </div>
                <div className="ds">
                  <h3 className="ds-h">Dokumen</h3>
                  <dl className="ds-grid">
                    <Info l="Keperluan" v={tampilCur.description} /><Info l="Event / Project" v={tampilCur.eventProject} />
                    <Info l="No. P.O" v={tampilCur.poNumber !== '-' ? tampilCur.poNumber : ''} /><Info l="No. Invoice" v={tampilCur.noInvoice} />
                    <Info l="Tanggal invoice" v={tampilCur.dateInvoice} /><Info l="Catatan PIC" v={tampilCur.notesUser} />
                  </dl>
                </div>
                <div className="ds">
                  <h3 className="ds-h">Pembayaran</h3>
                  <dl className="ds-grid"><Info l="Jenis pembayaran" v={tampilCur.jenisPembayaran} /><Info l="Jatuh tempo" v={tampilCur.dueDate} /></dl>
                </div>
              </section>

              <aside className="inbox-aksi" aria-label="Keputusan">
                <span className="ds-l">Nilai invoice</span>
                <div className="ip-angka num">{rupiah(tampilCur.invoiceAmount)}</div>
                <p className="ip-sub">{[tampilCur.statusPPN, tampilCur.dueDate ? `Jatuh tempo ${tampilCur.dueDate}` : ''].filter(Boolean).join(' · ')}</p>
                {(tampilCur.diskon > 0 || tampilCur.biayaLainnya > 0 || tampilCur.ppnAmount > 0 || tampilCur.nominal !== tampilCur.invoiceAmount) && (
                  <dl className="ip-rincian">
                    {tampilCur.diskon > 0 && <div><dt>Diskon</dt><dd className="num">- {rupiah(tampilCur.diskon)}</dd></div>}
                    {tampilCur.biayaLainnya > 0 && <div><dt>Biaya lainnya</dt><dd className="num">{rupiah(tampilCur.biayaLainnya)}</dd></div>}
                    {tampilCur.ppnAmount > 0 && <div><dt>PPN</dt><dd className="num">{rupiah(tampilCur.ppnAmount)}</dd></div>}
                    <div className="ip-total"><dt>Nominal akhir</dt><dd className="num">{rupiah(tampilCur.nominal)}</dd></div>
                  </dl>
                )}
                <h3 className="ds-h ip-h">Yang dibutuhkan</h3>
                <ul className="ip-syarat">
                  {tampilCur.perluCFO && <li><span className="ip-ik bad" aria-hidden="true">!</span>Persetujuan CFO</li>}
                  {tampilCur.butuhStepUp && <li><span className="ip-ik warn" aria-hidden="true"><IkonKunci /></span>Konfirmasi password saat menyetujui</li>}
                  {!tampilCur.perluCFO && !tampilCur.butuhStepUp && <li><span className="ip-ik ok" aria-hidden="true"><IkonSelesai /></span>Tidak ada persyaratan tambahan</li>}
                </ul>
                <div className="ip-aksi">
                  <button type="button" className="btn btn-primary" disabled={sibuk || !!tampilCur.terkunci} aria-disabled={!!tampilCur.terkunci || undefined}
                    onClick={() => { setGalat(null); setNotes(''); setDlg('setuju'); }}>Setujui</button>
                  <button type="button" className="btn btn-secondary" disabled={sibuk} onClick={() => { setGalat(null); setAlasan(''); setDlg('tolak'); }}>Kembalikan<span className="ip-lanjut"> ke pengaju</span></button>
                </div>
              </aside>
            </>
          ) : <section className="inbox-detail"><p className="muted">Pilih dokumen di daftar.</p></section>}
        </div></div>
      )}

      <Dialog buka={dlg === 'setuju'} onTutup={tutup('setuju')} judul="Setujui pengajuan?" {...(tampilCur?.butuhStepUp ? { langkah: 'Langkah 1 dari 2' } : {})}>
        {tampilCur && (
          <form onSubmit={(e) => { e.preventDefault(); void setuju(); }}>
            <RingkasanDok it={tampilCur} />
            <div className="f">
              <div className="dlg-lbl"><label htmlFor="ib-notes">Catatan <span className="opt">(opsional)</span></label><span className="muted cap num">{notes.length}/{CATATAN_MAX}</span></div>
              <textarea id="ib-notes" maxLength={CATATAN_MAX} placeholder="Tambahkan catatan untuk pengaju" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {galat && <Pesan jenis="err">{galat}</Pesan>}
            <div className="dlg-aksi">
              <button type="button" className="btn btn-secondary" onClick={tutup('setuju')} disabled={sibuk}>Batal</button>
              <button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Memproses…' : tampilCur.butuhStepUp ? 'Lanjut' : 'Setujui'}</button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog buka={dlg === 'stepup'} onTutup={tutup('stepup')} judul="Konfirmasi password" langkah="Langkah 2 dari 2">
        <form onSubmit={(e) => { e.preventDefault(); void konfirmasiStepUp(); }}>
          {tampilCur && <RingkasanDok it={tampilCur} />}
          <div className="f">
            <div className="dlg-lbl"><label htmlFor="ib-pw">Password</label></div>
            <div className="pw-wrap">
              <input id="ib-pw" type={lihatPw ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="pw-mata" aria-label={lihatPw ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={lihatPw} onClick={() => setLihatPw(!lihatPw)}>{lihatPw ? <IkonMataCoret /> : <IkonMata />}</button>
            </div>
            <div className="hint">Nominal Rp 5.000.000 ke atas memerlukan password. Setelah dikonfirmasi, tidak perlu diulang selama 5 menit.</div>
          </div>
          {galat && <Pesan jenis="err">{galat}</Pesan>}
          <div className="dlg-aksi">
            <button type="button" className="btn btn-secondary" onClick={() => { setDlg('setuju'); setPw(''); setGalat(null); }} disabled={sibuk}>Kembali</button>
            <button type="submit" className="btn btn-primary" disabled={sibuk || !pw}>{sibuk ? 'Memproses…' : 'Setujui pengajuan'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog buka={dlg === 'tolak'} onTutup={tutup('tolak')} judul="Kembalikan ke pengaju">
        <form onSubmit={(e) => { e.preventDefault(); void tolak(); }}>
          {tampilCur && <RingkasanDok it={tampilCur} />}
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
