'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errMessage, isApiError } from './api';
import { Chips, Dialog, Field, Pesan, Skeleton, Toast, type IsiToast } from './kit';
import { useStepUp } from './StepUp';
import { unduhTeks } from './unduh';

type Tab = 'pengguna' | 'kesehatan' | 'integritas' | 'master' | 'repair' | 'arsip';
interface User { row: number; etag: string; brand: string; dept: string; level: number; jabatan: string; nama: string; email: string; aktif: boolean; noHp: string; punyaPassword: boolean }
interface Temuan { kategori: string; level: 'KRITIS' | 'TINGGI' | 'SEDANG'; id: string; masalah: string; saran: string }
interface Koneksi { nama: string; ok: boolean; info: string; ms: number }
interface Health {
  appEnv: string; koneksi: Koneksi[]; cron: { nama: string; at: number | null; hasil: string }[];
  header: { ok: true; writable: boolean; tabs: { tab: string; ok: boolean; missingTab?: boolean; issues: { position: number; expected: string; found: string }[] }[] } | { ok: false; pesan: string };
}
interface Ubah { row: number; id: string; cells: Record<string, string | number>; sebelum: Record<string, string | number> }
interface Arsip { jumlahBaris: number; batas: string; kandidat: { id: string; vendor: string; nominal: number; lunas: string }[] }
interface Pratinjau { token: string; jenis: string; total: number; ubah: Ubah[]; lebihBayar: string[]; dibatasi: boolean }

const LEVEL_LABEL: Record<number, string> = { 1: 'L1 PIC', 2: 'L2 Manager', 3: 'L3 Finance Staff', 4: 'L4 Fin. Mgr', 5: 'L5 CFO', 9: 'L9 Admin' };
const kosong = { brand: '', dept: '', level: 1, jabatan: '', nama: '', email: '', aktif: true, noHp: '' };
const nadaLevel = (l: Temuan['level']): string => (l === 'KRITIS' ? 'merah' : l === 'TINGGI' ? 'kuning' : 'biru');
const waktuWib = (ms: number | null): string => (ms ? new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const csvTemuan = (t: readonly Temuan[]): string => [['KATEGORI', 'LEVEL', 'ID / BARIS', 'MASALAH', 'SARAN PERBAIKAN'], ...t.map((x) => [x.kategori, x.level, x.id, x.masalah, x.saran])]
  .map((r) => r.map((c) => `"${(/^[=+@\t\r]|^-./s.test(c) ? `'${c}` : c).replace(/"/g, '""')}"`).join(',')).join('\n');

function DaftarTemuan({ temuan, namaFile }: { temuan: Temuan[]; namaFile: string }) {
  if (!temuan.length) return <Pesan jenis="ok">Tidak ada masalah terdeteksi.</Pesan>;
  const n = (l: Temuan['level']) => temuan.filter((t) => t.level === l).length;
  return (
    <>
      <div className="toolbar-sub"><span className="muted cap">{temuan.length} temuan · {n('KRITIS')} kritis · {n('TINGGI')} tinggi · {n('SEDANG')} sedang</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => unduhTeks(namaFile, csvTemuan(temuan))}>Unduh CSV</button></div>
      <ul className="temuan">{temuan.map((t, i) => (
        <li key={`${t.id}-${i}`}><span className={`pill-st ${nadaLevel(t.level)}`}>{t.level}</span>
          <div><b>{t.kategori} · <span className="num">{t.id}</span></b><p>{t.masalah}</p><p className="muted cap">{t.saran}</p></div></li>
      ))}</ul>
    </>
  );
}

/** F3-C: halaman System Admin — pengguna (Master_User_TTD), kesehatan, integritas data, master, repair. */
export function HalamanAdmin({ emailSaya }: { emailSaya: string }) {
  const [tab, setTab] = useState<Tab>('pengguna');
  const [toast, setToast] = useState<IsiToast | null>(null);
  const stepUp = useStepUp('Perubahan oleh admin memerlukan password.');

  // ---- pengguna
  const [users, setUsers] = useState<User[] | null>(null);
  const [cari, setCari] = useState('');
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [form, setForm] = useState<null | { row?: number; etag?: string; v: typeof kosong }>(null);
  const [galatForm, setGalatForm] = useState<Record<string, string>>({});
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef<string | null>(null);

  const muatUser = useCallback(async () => {
    try { setUsers((await api<{ items: User[] }>('/api/admin/users', { method: 'GET' })).items); setGalatMuat(null); }
    catch (e) { setGalatMuat(errMessage(e)); }
  }, []);
  useEffect(() => { void muatUser(); }, [muatUser]);
  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return (users ?? []).filter((u) => !q || [u.nama, u.email, u.noHp, u.brand, u.dept, u.jabatan].some((x) => x.toLowerCase().includes(q)));
  }, [users, cari]);

  const simpan = async () => {
    if (!form || sibuk) return;
    setSibuk(true); setGalatForm({});
    kunci.current ??= crypto.randomUUID();
    try {
      await stepUp.lindungi(async () => {
        const r = await api<{ hasil: { perluPassword: boolean } }>('/api/admin/users', { body: { ...form.v, ...(form.row ? { row: form.row, etag: form.etag } : {}) }, headers: { 'idempotency-key': kunci.current! } });
        kunci.current = null; setForm(null);
        setToast({ jenis: 'ok', teks: `${form.v.nama} disimpan.${r.hasil.perluPassword ? ' Nomor ini belum punya password — kirim link set-password.' : ''} Sesi nomor terkait dicabut.` });
        void muatUser();
      });
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x) kunci.current = null;
      if (x?.fields) setGalatForm(x.fields);
      setGalatForm((g) => ({ ...g, _: errMessage(e) }));
    } finally { setSibuk(false); }
  };
  const aksiNomor = async (u: User, jenis: 'link' | 'logout') => {
    try {
      await api(`/api/admin/users/${jenis}`, { body: { noHp: u.noHp } });
      setToast({ jenis: 'ok', teks: jenis === 'link' ? `Link set-password dikirim ke WA ${u.nama}.` : `Semua sesi ${u.nama} dicabut.` });
    } catch (e) { setToast({ jenis: 'err', teks: errMessage(e) }); }
  };

  // ---- kesehatan / integritas / master
  const [health, setHealth] = useState<Health | null>(null);
  const [integ, setInteg] = useState<Temuan[] | null>(null);
  const [master, setMaster] = useState<{ jumlah: Record<string, number>; temuan: Temuan[] } | null>(null);
  const [arsip, setArsip] = useState<Arsip | null>(null);
  const [muat, setMuat] = useState<Tab | null>(null);
  const [galatTab, setGalatTab] = useState<string | null>(null);
  const jalankan = async (t: Tab) => {
    setMuat(t); setGalatTab(null);
    try {
      if (t === 'kesehatan') setHealth(await api<Health>('/api/admin/health', { method: 'GET' }));
      if (t === 'integritas') setInteg((await api<{ temuan: Temuan[] }>('/api/admin/integritas', { method: 'GET' })).temuan);
      if (t === 'arsip') setArsip(await api<Arsip>('/api/admin/arsip', { method: 'GET' }));
      if (t === 'master') setMaster(await api<{ jumlah: Record<string, number>; temuan: Temuan[] }>('/api/admin/master', { method: 'GET' }));
    } catch (e) { setGalatTab(errMessage(e)); }
    finally { setMuat(null); }
  };
  useEffect(() => { if (tab === 'kesehatan' && !health) void jalankan('kesehatan'); if (tab === 'master' && !master) void jalankan('master'); if (tab === 'arsip' && !arsip) void jalankan('arsip'); }, [tab]);

  // ---- repair
  const [jenisRepair, setJenisRepair] = useState<'rekonsiliasi' | 'nol-rekening'>('rekonsiliasi');
  const [prat, setPrat] = useState<Pratinjau | null>(null);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const kunciRepair = useRef<string | null>(null);
  const pratinjau = async () => {
    setSibuk(true); setGalatTab(null); setPrat(null);
    try { setPrat(await api<Pratinjau>('/api/admin/repair/pratinjau', { body: { jenis: jenisRepair } })); kunciRepair.current = null; }
    catch (e) { setGalatTab(errMessage(e)); }
    finally { setSibuk(false); }
  };
  const eksekusi = async () => {
    if (!prat || sibuk) return;
    setSibuk(true); setGalatTab(null);
    kunciRepair.current ??= crypto.randomUUID();
    try {
      await stepUp.lindungi(async () => {
        const r = await api<{ hasil: { diperbaiki: number; sisa: number; lebihBayar: string[] } }>('/api/admin/repair/jalankan', { body: { token: prat.token }, headers: { 'idempotency-key': kunciRepair.current! } });
        kunciRepair.current = null; setKonfirmasi(false); setPrat(null);
        setToast({ jenis: r.hasil.sisa || r.hasil.lebihBayar.length ? 'warn' : 'ok', teks: `${r.hasil.diperbaiki} baris diperbaiki.${r.hasil.sisa ? ` Masih ada ${r.hasil.sisa} baris — buat pratinjau lagi.` : ''}${r.hasil.lebihBayar.length ? ` Kelebihan bayar (urus manual): ${r.hasil.lebihBayar.join(', ')}` : ''}` });
      });
    } catch (e) {
      const x = isApiError(e) ? e : null;
      if (x) kunciRepair.current = null;
      setKonfirmasi(false);
      setGalatTab(x ? errMessage(e) : 'Koneksi terputus, hasil belum pasti. Tekan "Jalankan" lagi — aman, tidak dobel.');
    } finally { setSibuk(false); }
  };

  const tabs = useMemo(() => [
    { nilai: 'pengguna' as const, teks: 'Pengguna' }, { nilai: 'kesehatan' as const, teks: 'Kesehatan' }, { nilai: 'integritas' as const, teks: 'Integritas data' },
    { nilai: 'master' as const, teks: 'Master' }, { nilai: 'repair' as const, teks: 'Repair' }, { nilai: 'arsip' as const, teks: 'Arsip & backup' },
  ], []);
  const ubahF = <K extends keyof typeof kosong>(k: K) => (v: (typeof kosong)[K]) => setForm((f) => (f ? { ...f, v: { ...f.v, [k]: v } } : f));

  return (
    <>
      <div className="toast-wadah"><Toast isi={toast} onTutup={() => setToast(null)} /></div>
      <div className="toolbar"><h1 className="page-h">Admin</h1></div>
      <Chips label="Bagian" labelTersembunyi kecil nilai={tab} onPilih={(t) => { setTab(t); setGalatTab(null); }} pilihan={tabs} />
      {galatTab && <Pesan jenis="err">{galatTab}</Pesan>}

      {tab === 'pengguna' && (
        <section className="kartu">
          <div className="toolbar-sub">
            <input className="cari-admin" type="search" placeholder="Cari nama, email, nomor, brand…" aria-label="Cari pengguna" value={cari} onChange={(e) => setCari(e.target.value)} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setGalatForm({}); setForm({ v: kosong }); }}>Tambah user</button>
          </div>
          {galatMuat && <Pesan jenis="err">{galatMuat} <button type="button" className="link" onClick={() => void muatUser()}>Coba lagi</button></Pesan>}
          {!users ? (galatMuat ? null : <Skeleton baris={5} />) : (
            <div className="tabel-gulir"><table className="tabel">
              <thead><tr><th>Nama</th><th>Nomor HP</th><th>Brand / Dept</th><th>Level</th><th>Status</th><th><span className="sr-only">Aksi</span></th></tr></thead>
              <tbody>{tampil.map((u) => (
                <tr key={u.row}>
                  <td><b>{u.nama}</b><div className="muted cap">{u.jabatan} · {u.email || '— tanpa email'}</div></td>
                  <td className="kode">{u.noHp}</td><td>{u.brand} / {u.dept}</td><td>{LEVEL_LABEL[u.level] ?? `L${u.level}`}</td>
                  <td>{u.aktif ? <span className="pill-st hijau-muda">Aktif</span> : <span className="pill-st abu">Nonaktif</span>}{!u.punyaPassword && <div className="muted cap">belum punya password</div>}</td>
                  <td><div className="aksi-sel">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setGalatForm({}); setForm({ row: u.row, etag: u.etag, v: { brand: u.brand, dept: u.dept, level: u.level, jabatan: u.jabatan, nama: u.nama, email: u.email, aktif: u.aktif, noHp: u.noHp } }); }}>Ubah</button>
                    {u.aktif && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void aksiNomor(u, 'link')}>Kirim link password</button>}
                    {u.email !== emailSaya && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void aksiNomor(u, 'logout')}>Paksa logout</button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted cap">Satu baris = satu peran (brand/dept/level). Nomor HP yang sama di beberapa baris = satu akun dengan beberapa peran; password ikut nomor. Menyimpan mencabut sesi nomor terkait supaya peran baru langsung berlaku.</p>
        </section>
      )}

      {tab === 'kesehatan' && (
        <section className="kartu">
          <div className="toolbar-sub"><h2 className="kartu-t">Kesehatan sistem</h2><button type="button" className="btn btn-secondary btn-sm" disabled={muat === 'kesehatan'} onClick={() => void jalankan('kesehatan')}>{muat === 'kesehatan' ? 'Memeriksa…' : 'Periksa ulang'}</button></div>
          {!health ? <Skeleton baris={4} /> : (
            <>
              <h3 className="ds-h">Koneksi</h3>
              <ul className="ringkas vendor-saya">{health.koneksi.map((k) => <li key={k.nama}><span className="vs-n"><b>{k.nama}</b><span className="muted cap">{k.info} · {k.ms} ms</span></span><span className={`pill-st ${k.ok ? 'hijau-muda' : 'merah'}`}>{k.ok ? 'OK' : 'Gagal'}</span></li>)}</ul>
              <h3 className="ds-h">Cron terakhir</h3>
              <ul className="ringkas vendor-saya">{health.cron.map((c) => <li key={c.nama}><span className="vs-n"><b>{c.nama}</b><span className="muted cap">{waktuWib(c.at)}</span></span><span className={`pill-st ${c.hasil === 'ok' ? 'hijau-muda' : c.hasil === 'gagal' ? 'merah' : 'abu'}`}>{c.hasil}</span></li>)}</ul>
              <h3 className="ds-h">Header tab (validator)</h3>
              {!health.header.ok ? <Pesan jenis="err">{health.header.pesan}</Pesan> : (
                <>
                  <Pesan jenis={health.header.writable ? 'ok' : 'err'}>{health.header.writable ? 'Semua header cocok — penulisan diizinkan.' : 'Ada header yang tidak cocok — penulisan diblokir sampai diperbaiki.'} Lingkungan: {health.appEnv}.</Pesan>
                  <ul className="ringkas vendor-saya">{health.header.tabs.filter((t) => !t.ok).map((t) => <li key={t.tab}><span className="vs-n"><b>{t.tab}</b><span className="muted cap">{t.missingTab ? 'tab tidak ada' : t.issues.map((i) => `kolom ${i.position}: harus "${i.expected}", ada "${i.found}"`).join('; ')}</span></span></li>)}</ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'integritas' && (
        <section className="kartu">
          <div className="toolbar-sub"><h2 className="kartu-t">Integritas data (baca saja)</h2><button type="button" className="btn btn-primary btn-sm" disabled={muat === 'integritas'} onClick={() => void jalankan('integritas')}>{muat === 'integritas' ? 'Memeriksa…' : integ ? 'Jalankan ulang' : 'Jalankan audit'}</button></div>
          <p className="muted cap">Padanan auditDataIntegrity: rekening vs Master_Vendor, rekonsiliasi pembayaran (TOTAL_PAID/OS vs payment log, kelebihan bayar, log tanpa dokumen), P.O ↔ SJ, vendor kembar, user tanpa email/nomor, Level 4/5 tersedia.</p>
          {muat === 'integritas' ? <Skeleton baris={4} /> : integ && <DaftarTemuan temuan={integ} namaFile="audit-integritas.csv" />}
        </section>
      )}

      {tab === 'master' && (
        <section className="kartu">
          <div className="toolbar-sub"><h2 className="kartu-t">Master data</h2><button type="button" className="btn btn-secondary btn-sm" disabled={muat === 'master'} onClick={() => void jalankan('master')}>Periksa ulang</button></div>
          <p className="muted cap">Edit master tetap di Google Sheet. Halaman ini memeriksa isinya. Perubahan di Sheet terbaca dalam ±1 menit (cache).</p>
          {!master ? <Skeleton baris={3} /> : (
            <>
              <dl className="ds-grid">{Object.entries(master.jumlah).map(([k, n]) => <div key={k}><dt>{k}</dt><dd className="num">{n} baris</dd></div>)}</dl>
              <DaftarTemuan temuan={master.temuan} namaFile="validator-master.csv" />
            </>
          )}
        </section>
      )}

      {tab === 'repair' && (
        <section className="kartu">
          <h2 className="kartu-t">Repair data</h2>
          <p className="muted cap">Urutan selalu: <b>pratinjau</b> (snapshot, tidak menulis) → <b>konfirmasi</b> → <b>eksekusi</b> (password) → <b>laporan</b>. Nilai sebelum/sesudah tiap baris dicatat di Audit_Log (REPAIR_ROW) untuk rollback manual. Maks. 100 baris per eksekusi.</p>
          <Chips label="Jenis perbaikan" nilai={jenisRepair} onPilih={(v) => { setJenisRepair(v); setPrat(null); }} besar pilihan={[
            { nilai: 'rekonsiliasi', teks: 'Rekonsiliasi pembayaran', deskripsi: 'TOTAL_PAID / OS_BALANCE / PAY_STATUS dihitung ulang dari Trx_Payment_Log' },
            { nilai: 'nol-rekening', teks: 'Nol di depan rekening', deskripsi: 'Kembalikan nol yang hilang dari Master_Vendor (hanya kasus nol hilang)' },
          ]} />
          <div className="cta-row"><button type="button" className="btn btn-secondary" disabled={sibuk} onClick={() => void pratinjau()}>{sibuk && !prat ? 'Menghitung…' : 'Buat pratinjau'}</button></div>
          {prat && (
            <>
              {prat.lebihBayar.length > 0 && <Pesan jenis="warn">Kelebihan bayar (tidak bisa diperbaiki otomatis — cek bank, tagih balik / jadikan uang muka): {prat.lebihBayar.join(', ')}</Pesan>}
              {prat.total === 0 ? <Pesan jenis="ok">Tidak ada yang perlu diperbaiki.</Pesan> : (
                <>
                  <p className="muted cap">{prat.total} baris akan diubah{prat.dibatasi ? ` (eksekusi ini 100 pertama)` : ''}.</p>
                  <div className="tabel-gulir"><table className="tabel">
                    <thead><tr><th>Dokumen</th><th>Sebelum</th><th>Sesudah</th></tr></thead>
                    <tbody>{prat.ubah.map((u) => <tr key={u.id}><td className="kode">{u.id}</td><td className="kode cap">{Object.entries(u.sebelum).map(([k, v]) => `${k}=${v}`).join(' · ')}</td><td className="kode cap">{Object.entries(u.cells).map(([k, v]) => `${k}=${v}`).join(' · ')}</td></tr>)}</tbody>
                  </table></div>
                  <div className="cta-row"><button type="button" className="btn btn-danger" disabled={sibuk} onClick={() => setKonfirmasi(true)}>Jalankan perbaikan</button></div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'arsip' && (
        <section className="kartu">
          <div className="toolbar-sub"><h2 className="kartu-t">Arsip & backup</h2><button type="button" className="btn btn-secondary btn-sm" disabled={muat === 'arsip'} onClick={() => void jalankan('arsip')}>Periksa ulang</button></div>
          <p className="muted cap">Backup: spreadsheet disalin otomatis tiap malam (01:30 WIB) ke folder backup Shared Drive — disimpan 7 harian + 4 mingguan. Status terakhir ada di tab Kesehatan (cron "backup").</p>
          <p className="muted cap">Arsip (O10): dokumen Paid yang lunas lebih dari 18 bulan. Saat ini hanya ditampilkan; pemindahan ke tab arsip belum dijalankan sampai diputuskan.</p>
          {!arsip ? <Skeleton baris={3} /> : arsip.kandidat.length === 0 ? <Pesan jenis="ok">Tidak ada dokumen yang lunas sebelum {arsip.batas}. Trx_Pengajuan berisi {arsip.jumlahBaris} baris.</Pesan> : (
            <>
              <p className="muted cap">{arsip.kandidat.length} dokumen lunas sebelum {arsip.batas} (dari {arsip.jumlahBaris} baris).</p>
              <div className="tabel-gulir"><table className="tabel">
                <thead><tr><th>Dokumen</th><th>Vendor</th><th>Lunas</th><th className="num">Nominal</th></tr></thead>
                <tbody>{arsip.kandidat.map((k) => <tr key={k.id}><td className="kode">{k.id}</td><td>{k.vendor}</td><td className="kode">{k.lunas}</td><td className="num">Rp {k.nominal.toLocaleString('id-ID')}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </section>
      )}

      <Dialog buka={konfirmasi} onTutup={() => { if (!sibuk) setKonfirmasi(false); }} judul="Jalankan perbaikan?">
        <p>{prat?.ubah.length} baris di Trx_Pengajuan akan ditulis ulang sesuai pratinjau. Bila data berubah sejak pratinjau, eksekusi dibatalkan otomatis.</p>
        <div className="dlg-aksi">
          <button type="button" className="btn btn-secondary" onClick={() => setKonfirmasi(false)} disabled={sibuk}>Batal</button>
          <button type="button" className="btn btn-danger" onClick={() => void eksekusi()} disabled={sibuk}>{sibuk ? 'Memproses…' : 'Ya, jalankan'}</button>
        </div>
      </Dialog>

      <Dialog buka={!!form} onTutup={() => { if (!sibuk) setForm(null); }} judul={form?.row ? `Ubah user (baris ${form.row})` : 'Tambah user'} lebar>
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); void simpan(); }}>
            <div className="grid2">
              <Field label="Nama" id="u-nama" galat={galatForm.nama}>{(p) => <input {...p} value={form.v.nama} maxLength={120} onChange={(e) => ubahF('nama')(e.target.value)} />}</Field>
              <Field label="Jabatan" id="u-jab" opsional>{(p) => <input {...p} value={form.v.jabatan} maxLength={120} onChange={(e) => ubahF('jabatan')(e.target.value)} />}</Field>
              <Field label="Nomor HP" id="u-hp" galat={galatForm.noHp} petunjuk="Dipakai login & WA.">{(p) => <input {...p} value={form.v.noHp} inputMode="tel" maxLength={32} onChange={(e) => ubahF('noHp')(e.target.value)} />}</Field>
              <Field label="Email" id="u-email" galat={galatForm.email}>{(p) => <input {...p} type="email" value={form.v.email} maxLength={160} onChange={(e) => ubahF('email')(e.target.value)} />}</Field>
              <Field label="Brand" id="u-brand" galat={galatForm.brand} petunjuk="ALL untuk Finance/CFO/Admin.">{(p) => <input {...p} value={form.v.brand} maxLength={60} onChange={(e) => ubahF('brand')(e.target.value)} />}</Field>
              <Field label="Departemen" id="u-dept" galat={galatForm.dept}>{(p) => <input {...p} value={form.v.dept} maxLength={60} onChange={(e) => ubahF('dept')(e.target.value)} />}</Field>
              <Field label="Level" id="u-level" galat={galatForm.level}>{(p) => <select {...p} value={form.v.level} onChange={(e) => ubahF('level')(Number(e.target.value))}>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
              <div className="f"><label className="cek"><input type="checkbox" checked={form.v.aktif} onChange={(e) => ubahF('aktif')(e.target.checked)} /> Aktif</label></div>
            </div>
            {galatForm._ && <Pesan jenis="err">{galatForm._}</Pesan>}
            <div className="dlg-aksi">
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={sibuk}>Batal</button>
              <button type="submit" className="btn btn-primary" disabled={sibuk}>{sibuk ? 'Menyimpan…' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Dialog>
      {stepUp.dialog}
    </>
  );
}
