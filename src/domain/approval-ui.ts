// Logika murni UI inbox Persetujuan (tanpa React) supaya bisa diuji.
import { ALASAN_MAX, CATATAN_MAX } from './approval';

export interface ItemInbox { id: string; butuhStepUp: boolean; terkunci: string | null; etag: string }

/** Bulk hanya untuk item yang tidak butuh step-up dan tidak terkunci SoD (design: bulk < 5 jt). */
export const bisaBulk = (i: Pick<ItemInbox, 'butuhStepUp' | 'terkunci'>): boolean => !i.butuhStepUp && !i.terkunci;

export const alasanValid = (t: string): boolean => { const x = t.trim(); return x.length >= 3 && x.length <= ALASAN_MAX; };
export const catatanValid = (t: string): boolean => t.trim().length <= CATATAN_MAX;

/** Setelah aksi: pilih item berikutnya di daftar (yang sesudahnya, atau sebelumnya bila terakhir); null bila kosong. */
export function itemBerikutnya(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return ids[0] ?? null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/** Galat server -> apakah kunci idempotensi boleh dipakai ulang. Hanya jaringan putus (ambigu) & step-up yang mempertahankan kunci. */
export const pertahankanKunci = (e: { code?: string; fields?: Record<string, string> } | null): boolean =>
  !e || !e.code || (e.code === 'FORBIDDEN' && e.fields?.stepUp === 'required');

/** Galat yang berarti dokumen sudah berubah/hilang -> daftar harus dimuat ulang. */
export const perluMuatUlang = (code?: string): boolean => code === 'CONFLICT' || code === 'NOT_FOUND';
