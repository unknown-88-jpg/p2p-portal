// Cache baca KHUSUS TAMPILAN (M8). Kuota Google ±45 baca/mnt global; halaman yang membaca seluruh tab tiap kali (beranda, detail, Ctrl+K)
// menghabiskannya dengan segelintir pengguna. Aksi (submit/approve/dst.) TIDAK memakai ini: mereka selalu baca segar di dalam lock.
// Aturan: entri per-instance (WeakMap per store), sah bila versi tab di Redis sama DAN umur < TTL; tulis (uow) menaikkan versi tab.
// Versi dibaca SEBELUM data diambil -> pembaca yang tertinggal tak bisa menyimpan data lama di bawah versi baru. Redis mati -> lewati cache.
import { logger } from '@/lib/logger';
import type { RawRow, TableStore } from '@/ports/store';
import type { RedisPort } from '@/ports/redis';
import type { TabSchema } from '@/repo/schema';
import type { Clock } from '@/lib/clock';

export const VIEW_TTL_MS = 15_000;
/** Bila Google gagal tapi ada salinan lebih muda dari ini, tampilan memakai salinan itu (stale-if-error). */
export const VIEW_STALE_MAX_MS = 5 * 60_000;

interface Entri { ver: string; at: number; rows: RawRow[] }
interface Slot { entri: Map<string, Entri>; terbang: Map<string, Promise<RawRow[]>> }
const slots = new WeakMap<TableStore, Slot>();
const slotOf = (s: TableStore): Slot => { let x = slots.get(s); if (!x) { x = { entri: new Map(), terbang: new Map() }; slots.set(s, x); } return x; };
const verKey = (tab: string): string => `tabver:${tab}`;

export interface ViewDeps { redis: RedisPort; store: TableStore; clock: Clock }

/** Dipanggil setelah tulis berhasil ATAU ambigu. Gagal menaikkan versi tidak menggagalkan apa pun (cache tetap kedaluwarsa dalam ≤ TTL). */
export async function naikkanVersi(redis: RedisPort, tabs: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(tabs)].map((t) => redis.incr(verKey(t)).then(() => undefined))).catch((e: unknown) => logger.warn('view_ver_bump_failed', { err: (e as Error).message }));
}

export interface HasilTampilan { rows: RawRow[]; basi: boolean }

/** Baca tab untuk TAMPILAN. Banyak pemanggil bersamaan = satu pembacaan (single-flight). */
export async function bacaTampilan(d: ViewDeps, schema: TabSchema): Promise<RawRow[]> {
  return (await bacaTampilanDetail(d, schema)).rows;
}

export async function bacaTampilanDetail(d: ViewDeps, schema: TabSchema): Promise<HasilTampilan> {
  const slot = slotOf(d.store);
  const tab = schema.tab;
  let ver: string;
  try { ver = (await d.redis.get(verKey(tab))) ?? '0'; }
  catch { return { rows: await d.store.readRows(schema), basi: false }; } // Redis mati: tanpa cache
  const now = d.clock.now();
  const ada = slot.entri.get(tab);
  if (ada && ada.ver === ver && now - ada.at < VIEW_TTL_MS) return { rows: ada.rows, basi: false };

  const kunci = `${tab}@${ver}`;
  let p = slot.terbang.get(kunci);
  if (!p) {
    p = d.store.readRows(schema).then((rows) => { slot.entri.set(tab, { ver, at: d.clock.now(), rows }); return rows; }).finally(() => slot.terbang.delete(kunci));
    slot.terbang.set(kunci, p);
  }
  try { return { rows: await p, basi: false }; }
  catch (e) {
    if (ada && now - ada.at < VIEW_STALE_MAX_MS) { logger.warn('view_stale_served', { tab, umurMs: now - ada.at, err: (e as Error).message }); return { rows: ada.rows, basi: true }; }
    throw e;
  }
}
