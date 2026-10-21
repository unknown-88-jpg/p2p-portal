import { RuleError } from '@/domain/errors';
import { validasiUnggahan } from '@/domain/lampiran';
import { errMessage, isApiError, type ApiInit } from './api';

// Alur unggah lampiran di browser (design 4.6 / O11): (1) minta sesi ke server, (2) PUT langsung ke Drive, (3) server memverifikasi lalu menempelkan.
// Semua I/O diinjeksikan supaya urutan & penanganan galatnya bisa dites tanpa browser. URL sesi = kredensial pembawa: TIDAK pernah masuk pesan galat/log.

export type TahapUnggah = 'menyiapkan' | 'mengunggah' | 'memverifikasi';
export class GalatUnggah extends Error {
  constructor(public readonly tahap: TahapUnggah, message: string, public readonly bisaCobaLagi = true) { super(message); this.name = 'GalatUnggah'; }
}
export class GalatPut extends Error {
  constructor(message: string, public readonly status = 0) { super(message); this.name = 'GalatPut'; }
}

export interface BerkasUnggah { name: string; size: number; type: string }
export interface DepsUnggah<B extends BerkasUnggah> {
  api: <T>(path: string, init?: ApiInit) => Promise<T>;
  /** PUT isi berkas ke URL sesi Drive; resolve dengan id file. Lempar GalatPut bila gagal. */
  put: (sessionUrl: string, berkas: B, onProgress: (bagian: number) => void, signal?: AbortSignal) => Promise<{ id: string }>;
  tunggu: (ms: number) => Promise<void>;
}
export interface HasilUnggah { namaFile: string; size: number; mimeType: string }
interface SesiRespons { hasil: { uploadId: string; sessionUrl: string; maxBytes: number } }
interface KonfirmasiRespons { hasil: { punyaLampiran: true; namaFile?: string; size?: number; mimeType?: string } }

const KONFIRMASI_MAKS_COBA = 3;
const JEDA_KONFIRMASI_MS = [700, 1800];

export async function unggahLampiran<B extends BerkasUnggah>(
  d: DepsUnggah<B>, idTrx: string, berkas: B,
  opsi: { onTahap?: (t: TahapUnggah) => void; onProgress?: (bagian: number) => void; signal?: AbortSignal } = {},
): Promise<HasilUnggah> {
  const { onTahap = () => undefined, onProgress = () => undefined, signal } = opsi;
  try { validasiUnggahan({ namaAsli: berkas.name, size: berkas.size, mimeType: berkas.type }); }
  catch (e) { throw new GalatUnggah('menyiapkan', e instanceof RuleError ? e.message : 'File tidak valid.', false); }

  onTahap('menyiapkan');
  let sesi: SesiRespons['hasil'];
  try {
    sesi = (await d.api<SesiRespons>(`/api/pengajuan/${encodeURIComponent(idTrx)}/lampiran/sesi`, { body: { namaAsli: berkas.name, size: berkas.size, mimeType: berkas.type }, signal })).hasil;
  } catch (e) { throw new GalatUnggah('menyiapkan', errMessage(e), !isApiError(e) || e.code === 'UPSTREAM_BUSY' || e.code === 'RATE_LIMITED'); }

  onTahap('mengunggah'); onProgress(0);
  let fileId: string;
  try { fileId = (await d.put(sesi.sessionUrl, berkas, onProgress, signal)).id; }
  catch (e) {
    if (signal?.aborted) throw new GalatUnggah('mengunggah', 'Unggah dibatalkan.', true);
    // Pesan generik: GalatPut tidak membawa URL sesi; jangan teruskan e.message mentah dari sumber lain.
    throw new GalatUnggah('mengunggah', e instanceof GalatPut && e.message ? e.message : 'Gagal mengunggah. Periksa koneksi lalu coba lagi.', true);
  }
  onProgress(1);

  onTahap('memverifikasi');
  // Konfirmasi idempoten di server (sudah terpasang = sukses), jadi aman diulang bila jawabannya hilang di jaringan.
  let terakhir: unknown;
  for (let i = 0; i < KONFIRMASI_MAKS_COBA; i++) {
    try {
      const r = await d.api<KonfirmasiRespons>(`/api/pengajuan/${encodeURIComponent(idTrx)}/lampiran/konfirmasi`, { body: { uploadId: sesi.uploadId, fileId }, signal });
      return { namaFile: r.hasil.namaFile ?? berkas.name, size: r.hasil.size ?? berkas.size, mimeType: r.hasil.mimeType ?? berkas.type };
    } catch (e) {
      terakhir = e;
      const sementara = !isApiError(e) || e.code === 'UPSTREAM_BUSY';
      if (!sementara || i === KONFIRMASI_MAKS_COBA - 1) break;
      await d.tunggu(JEDA_KONFIRMASI_MS[i] ?? 1800);
    }
  }
  // Penolakan tegas server (mis. isi tidak cocok tipe): ulang dari awal tidak akan membantu kecuali file diganti.
  throw new GalatUnggah('memverifikasi', errMessage(terakhir), !isApiError(terakhir) || terakhir.code === 'UPSTREAM_BUSY');
}
