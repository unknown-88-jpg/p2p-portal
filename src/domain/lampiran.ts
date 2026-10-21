import { RuleError } from './errors';

// Aturan lampiran invoice (design 4.6). Murni: tidak menyentuh Drive. Klien tidak tepercaya -> SEMUA ini ditegakkan ulang di server.

export const LAMPIRAN_MAX_BYTES = 10 * 1024 * 1024; // sama dengan batas sistem lama (JS_Main.html: 10 MB)
export const MIME_LAMPIRAN: Readonly<Record<string, string>> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export interface UnggahanInput { namaAsli: string; size: number; mimeType: string }

export function validasiUnggahan(i: UnggahanInput): void {
  if (!Object.hasOwn(MIME_LAMPIRAN, i.mimeType)) throw new RuleError('Tipe file tidak didukung. Gunakan PDF, JPG, atau PNG.');
  if (!Number.isInteger(i.size) || i.size <= 0) throw new RuleError('Ukuran file tidak valid.');
  if (i.size > LAMPIRAN_MAX_BYTES) throw new RuleError(`File lebih dari ${LAMPIRAN_MAX_BYTES / 1024 / 1024} MB. Kecilkan dulu.`);
}

/** Bagian nama asli yang aman dipakai di nama file Drive: tanpa path, hanya [A-Za-z0-9_-], maks 40 karakter. Kosong -> "file". */
export function sanitasiNama(namaAsli: string): string {
  const tanpaPath = namaAsli.split(/[\\/]/).pop() ?? '';
  const tanpaEkstensi = tanpaPath.replace(/\.[^.]*$/, '');
  const bersih = tanpaEkstensi.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40);
  return bersih || 'file';
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** `invoice_{ID_TRX}_{yyyymmdd-hhmmss UTC}_{acak6}_{nama}.{ext}` — dibuat SERVER; ekstensi dari MIME yang lolos whitelist, bukan dari klien. */
export function namaFileServer(a: { idTrx: string; nowMs: number; acak: string; namaAsli: string; mimeType: string }): string {
  const ext = MIME_LAMPIRAN[a.mimeType];
  if (!ext) throw new RuleError('Tipe file tidak didukung.');
  if (!/^[a-z0-9]{6}$/.test(a.acak)) throw new Error('acak harus 6 karakter [a-z0-9]');
  const d = new Date(a.nowMs);
  const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `invoice_${a.idTrx}_${ts}_${a.acak}_${sanitasiNama(a.namaAsli)}.${ext}`;
}
/** Pola nama buatan server — pembersihan file yatim HANYA boleh menyentuh file yang cocok. */
export const POLA_NAMA_SERVER = /^invoice_(TRD|NTR)-\d{5,}_\d{8}-\d{6}_[a-z0-9]{6}_[A-Za-z0-9_-]+\.(pdf|jpg|png)$/;

/** Cek magic bytes: isi file harus sesuai tipe yang diklaim (nama/MIME bisa dipalsukan, isi tidak). */
export function cocokMagic(mimeType: string, head: Uint8Array): boolean {
  const eq = (sig: number[]): boolean => head.length >= sig.length && sig.every((b, i) => head[i] === b);
  switch (mimeType) {
    case 'application/pdf': return eq([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'image/jpeg': return eq([0xff, 0xd8, 0xff]);
    case 'image/png': return eq([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    default: return false;
  }
}

/** Port extractDriveId_: `/d/{id}`, `id={id}`, atau id telanjang. Tidak cocok -> ''. */
export function fileIdDariUrl(url: unknown): string {
  const s = String(url ?? '').trim();
  if (!s) return '';
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}
export const urlFileDrive = (fileId: string): string => `https://drive.google.com/file/d/${fileId}/view`;

// ---- Kompresi gambar di browser (M4c). Konstanta = sistem lama (JS_Main.html): sisi terpanjang 1800 px, JPEG 0,82. PDF tidak disentuh.
export const KOMPRES = { MAX_SISI: 1800, KUALITAS: 0.82 } as const;
export const MIME_GAMBAR: readonly string[] = ['image/jpeg', 'image/png'];

/** Ukuran hasil skala: sisi terpanjang <= MAX_SISI, rasio tetap, tidak pernah membesarkan. Dimensi tak valid -> null. */
export function hitungUkuranKompres(w: number, h: number, maxSisi: number = KOMPRES.MAX_SISI): { w: number; h: number } | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  const skala = Math.min(1, maxSisi / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * skala)), h: Math.max(1, Math.round(h * skala)) };
}

/** Pakai hasil kompresi hanya bila benar-benar lebih kecil dari aslinya (foto yang sudah kecil/PNG kecil sering malah membengkak jadi JPEG). */
export function pilihBerkas<T extends { size: number }>(asli: T, hasil: T | null): T {
  return hasil && hasil.size > 0 && hasil.size < asli.size ? hasil : asli;
}

/** Nama file hasil kompres: ekstensi mengikuti isi baru (.jpg), nama dasar dipertahankan. */
export function namaSetelahKompres(namaAsli: string): string {
  const dasar = (namaAsli.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '') || 'foto';
  return `${dasar}.jpg`;
}

export function formatUkuran(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
