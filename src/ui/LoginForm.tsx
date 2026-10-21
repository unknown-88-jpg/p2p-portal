'use client';
import { useState, type FormEvent } from 'react';
import { api, errMessage } from './api';

export function LoginForm() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'login') {
        await api('/api/auth/login', { body: { phone, password } });
        window.location.assign('/');
        return;
      }
      const r = await api<{ message: string }>('/api/auth/forgot', { body: { phone } });
      setMsg({ kind: 'ok', text: r.message });
    } catch (err) {
      setMsg({ kind: 'err', text: errMessage(err) });
    } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h1>{mode === 'login' ? 'Masuk' : 'Atur / lupa password'}</h1>
      <p className="sub">{mode === 'login' ? 'Gunakan nomor HP dan password Anda.' : 'Masukkan nomor HP terdaftar. Link atur password dikirim via WhatsApp.'}</p>
      <label htmlFor="phone">Nomor HP</label>
      <input id="phone" inputMode="tel" autoComplete="username" placeholder="0812xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      {mode === 'login' && (<>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </>)}
      <button className="primary" disabled={busy || !phone || (mode === 'login' && !password)}>{busy ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Kirim link'}</button>
      {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      <div className="row">
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setMsg(null); }}>
          {mode === 'login' ? 'Atur / lupa password' : 'Kembali ke masuk'}
        </button>
      </div>
    </form>
  );
}
