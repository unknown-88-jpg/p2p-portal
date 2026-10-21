import { GalatPut } from './unggah-lampiran';

/** PUT berkas ke URL sesi resumable Drive lewat XHR (fetch belum punya progres unggah). Browser-only. */
export function putKeDrive(sessionUrl: string, berkas: Blob, onProgress: (bagian: number) => void, signal?: AbortSignal): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', sessionUrl);
    x.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total)); };
    x.onerror = () => reject(new GalatPut('Koneksi terputus saat mengunggah. Coba lagi.'));
    x.ontimeout = () => reject(new GalatPut('Unggah terlalu lama. Coba lagi.'));
    x.onabort = () => reject(new GalatPut('Unggah dibatalkan.'));
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        try {
          const j = JSON.parse(x.responseText) as { id?: unknown };
          if (typeof j.id === 'string' && j.id) return resolve({ id: j.id });
        } catch { /* jatuh ke galat di bawah */ }
        return reject(new GalatPut('Respons Drive tidak dikenali. Coba lagi.', x.status));
      }
      reject(new GalatPut(x.status === 0 ? 'Koneksi terputus saat mengunggah. Coba lagi.' : `Drive menolak unggahan (kode ${x.status}). Coba lagi.`, x.status));
    };
    if (signal) { if (signal.aborted) return reject(new GalatPut('Unggah dibatalkan.')); signal.addEventListener('abort', () => x.abort(), { once: true }); }
    x.timeout = 10 * 60_000;
    x.send(berkas);
  });
}
