'use client';
import { useState } from 'react';
import { JADWAL_DIGEST_TEKS } from '@/domain/wa';
import { api, errMessage, isApiError } from './api';
import { IkonWA } from './icons';

const LABEL = { finmgr: 'Fin. Mgr', cfo: 'CFO' } as const;

/**
 * Tahap persetujuan Finance: "Kirim WA" ke penyetuju berikutnya (Fin. Mgr, lalu CFO setelah Fin. Mgr setuju).
 * Manual maks. 1x per tujuan (server: 429 bila sudah); pengingat otomatis tetap lewat digest terjadwal.
 */
export function KirimWaFinance({ id, wa }: { id: string; wa: { target: 'finmgr' | 'cfo'; terkirim: boolean } }) {
  const [tahap, setTahap] = useState<'siap' | 'kirim' | 'terkirim' | 'galat'>(wa.terkirim ? 'terkirim' : 'siap');
  const [pesan, setPesan] = useState(wa.terkirim ? `Sudah dikirim ke ${LABEL[wa.target]}` : '');
  const kirim = async () => {
    setTahap('kirim'); setPesan('');
    try {
      const r = await api<{ hasil: { target: 'finmgr' | 'cfo'; terkirim: number } }>(`/api/finance/${encodeURIComponent(id)}/kirim-wa`);
      setTahap('terkirim'); setPesan(`Terkirim ke ${r.hasil.terkirim} ${LABEL[r.hasil.target]}`);
    } catch (e) {
      if (isApiError(e) && e.code === 'RATE_LIMITED') { setTahap('terkirim'); setPesan(`Sudah dikirim ke ${LABEL[wa.target]}`); return; }
      setTahap('galat'); setPesan(errMessage(e));
    }
  };
  return (
    <div className="wa-fin">
      <span className="kirim-wa">
        <button type="button" className="btn-wa" onClick={() => void kirim()} disabled={tahap === 'kirim' || tahap === 'terkirim'}
          aria-label={`Kirim WA pengingat ke ${LABEL[wa.target]} untuk ${id}`} title={tahap === 'terkirim' ? 'Jatah kirim manual sudah dipakai' : `Kirim pengingat WA ke ${LABEL[wa.target]} (1x)`}>
          <IkonWA />{tahap === 'kirim' ? 'Mengirim…' : `Kirim WA ke ${LABEL[wa.target]}`}
        </button>
        <span role="status" className={`kirim-wa-ket${tahap === 'galat' ? ' galat' : ''}`}>{pesan}</span>
      </span>
      <p className="muted cap">Kirim manual 1x per tahap{wa.target === 'finmgr' ? ' (setelah Fin. Mgr menyetujui, tombol berpindah ke CFO)' : ''}. Pengingat otomatis tetap dikirim {JADWAL_DIGEST_TEKS}.</p>
    </div>
  );
}
