'use client';
import { useState } from 'react';
import { api, errMessage } from './api';
import { IkonWA } from './icons';

/**
 * F-15: tombol "Kirim WA" di samping status Menunggu Manager. Maks. 1x/hari per dokumen (dijaga server; 429 = sudah terkirim hari ini).
 * Pesan hasil diumumkan lewat role="status" di sebelah tombol.
 */
export function KirimWa({ id, sudahHariIni }: { id: string; sudahHariIni: boolean }) {
  const [tahap, setTahap] = useState<'siap' | 'kirim' | 'terkirim' | 'galat'>(sudahHariIni ? 'terkirim' : 'siap');
  const [pesan, setPesan] = useState(sudahHariIni ? 'Sudah dikirim hari ini' : '');
  const kirim = async () => {
    setTahap('kirim'); setPesan('');
    try {
      const r = await api<{ hasil: { manager: number; terkirim: number } }>(`/api/pengajuan/${encodeURIComponent(id)}/kirim-wa`);
      setTahap('terkirim'); setPesan(`Terkirim ke ${r.hasil.terkirim} Manager`);
    } catch (e) {
      const x = e as { code?: string };
      if (x.code === 'RATE_LIMITED') { setTahap('terkirim'); setPesan('Sudah dikirim hari ini'); return; }
      setTahap('galat'); setPesan(errMessage(e));
    }
  };
  return (
    <span className="kirim-wa">
      <button type="button" className="btn-wa" onClick={kirim} disabled={tahap === 'kirim' || tahap === 'terkirim'}
        aria-label={`Kirim WA pengingat ke Manager untuk ${id}`} title={tahap === 'terkirim' ? 'Bisa dikirim lagi besok' : 'Kirim pengingat WA ke Manager (1x per hari)'}>
        <IkonWA />{tahap === 'kirim' ? 'Mengirim…' : 'Kirim WA'}
      </button>
      <span role="status" className={`kirim-wa-ket${tahap === 'galat' ? ' galat' : ''}`}>{pesan}</span>
    </span>
  );
}
