'use client';
import { useCallback, useRef, useState } from 'react';
import { api, errMessage, isApiError } from './api';
import { IkonMata, IkonMataCoret } from './icons';
import { Dialog, Pesan } from './kit';

/**
 * Step-up password yang bisa dipakai ulang: `lindungi(fn)` menjalankan fn; bila server menjawab FORBIDDEN stepUp=required,
 * dialog password muncul lalu fn diulang SEKALI setelah konfirmasi berhasil. Elemen `dialog` wajib dirender pemanggil.
 */
export function useStepUp(alasan: string) {
  const [buka, setBuka] = useState(false);
  const [pw, setPw] = useState('');
  const [lihat, setLihat] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const tunda = useRef<(() => Promise<void>) | null>(null);

  const lindungi = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); }
    catch (e) {
      if (isApiError(e) && e.code === 'FORBIDDEN' && e.fields?.stepUp === 'required') { tunda.current = fn; setGalat(null); setPw(''); setBuka(true); return; }
      throw e;
    }
  }, []);

  const konfirmasi = async () => {
    if (!pw || sibuk) return;
    setSibuk(true); setGalat(null);
    try {
      await api('/api/auth/step-up', { body: { password: pw } });
      setPw(''); setBuka(false);
      const fn = tunda.current; tunda.current = null;
      if (fn) await fn().catch((e: unknown) => { setGalat(errMessage(e)); setBuka(true); });
    } catch (e) { setGalat(errMessage(e)); }
    finally { setSibuk(false); }
  };

  const dialog = (
    <Dialog buka={buka} onTutup={() => { if (!sibuk) { setBuka(false); setPw(''); tunda.current = null; } }} judul="Konfirmasi password">
      <form onSubmit={(e) => { e.preventDefault(); void konfirmasi(); }}>
        <div className="f">
          <div className="dlg-lbl"><label htmlFor="su-pw">Password</label></div>
          <div className="pw-wrap">
            <input id="su-pw" type={lihat ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="pw-mata" aria-label={lihat ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={lihat} onClick={() => setLihat(!lihat)}>{lihat ? <IkonMataCoret /> : <IkonMata />}</button>
          </div>
          <div className="hint">{alasan} Setelah dikonfirmasi, tidak perlu diulang selama 5 menit.</div>
        </div>
        {galat && <Pesan jenis="err">{galat}</Pesan>}
        <div className="dlg-aksi">
          <button type="button" className="btn btn-secondary" onClick={() => { setBuka(false); setPw(''); tunda.current = null; }} disabled={sibuk}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={sibuk || !pw}>{sibuk ? 'Memproses…' : 'Konfirmasi'}</button>
        </div>
      </form>
    </Dialog>
  );
  return { lindungi, dialog };
}
