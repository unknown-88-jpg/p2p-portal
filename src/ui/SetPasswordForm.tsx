'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errMessage } from './api';
import { Pesan } from './kit';

export function SetPasswordForm() {
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [lihat, setLihat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // F-12: 'cek' = sedang memeriksa link, 'ok' = berlaku (atau tak bisa dipastikan), 'mati' = kedaluwarsa/tidak valid.
  const [link, setLink] = useState<'cek' | 'ok' | 'mati'>('cek');

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') ?? '';
    // React StrictMode (dev) menjalankan effect 2x: eksekusi ke-2 melihat URL yang sudah dibersihkan.
    // Jangan menimpa token yang sudah terbaca dengan string kosong.
    if (!t) return;
    setToken(t);
    window.history.replaceState(null, '', '/set-password'); // token tidak tertinggal di URL/riwayat
    // F-12: periksa link SEKARANG (hanya mengintip, tidak menghanguskan). Gagal jaringan/limit -> jangan memblokir: pengiriman password tetap divalidasi server.
    api<{ valid: boolean }>('/api/auth/set-password/cek', { body: { token: t } })
      .then((r) => setLink(r.valid ? 'ok' : 'mati'))
      .catch(() => setLink('ok'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setMsg('Konfirmasi password tidak sama.'); return; }
    setBusy(true); setMsg(null);
    try { await api('/api/auth/set-password', { body: { token, password: pw } }); setDone(true); }
    catch (err) { setMsg(errMessage(err)); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="card"><h1>Password tersimpan</h1><p className="sub">Silakan masuk dengan nomor HP dan password baru Anda.</p>
      <a href="/login"><button className="primary" type="button">Ke halaman masuk</button></a></div>
  );
  if (link === 'mati') return (
    <div className="card"><h1>Link tidak berlaku</h1>
      <Pesan jenis="err">Link sudah kedaluwarsa atau sudah dipakai. Minta link baru.</Pesan>
      <p className="sub">Buka halaman masuk, pilih &ldquo;Atur / lupa password&rdquo;, lalu masukkan nomor HP Anda.</p>
      <a href="/login"><button className="primary" type="button">Ke halaman masuk</button></a></div>
  );
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h1>Atur password</h1>
      <p className="sub">Link berlaku 60 menit dan hanya bisa dipakai sekali.</p>
      {!token && <Pesan jenis="err">Link tidak lengkap. Buka ulang link dari WhatsApp, atau minta link baru.</Pesan>}
      <label htmlFor="pw">Password baru</label>
      <div className="pw-wrap">
        <input id="pw" type={lihat ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <button type="button" className="link pw-toggle" aria-pressed={lihat} onClick={() => setLihat(!lihat)}>{lihat ? 'Sembunyikan' : 'Tampilkan'}</button>
      </div>
      <div className="hint">Minimal 8 karakter, bukan nomor HP, bukan password umum.</div>
      <label htmlFor="pw2">Ulangi password</label>
      <input id="pw2" type={lihat ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      <button className="primary" disabled={busy || link === 'cek' || !token || !pw || !pw2}>{busy ? 'Menyimpan…' : 'Simpan password'}</button>
      {msg && <Pesan jenis="err">{msg}</Pesan>}
    </form>
  );
}
