import { daftarVendor, picOptions, type Org } from '@/domain/master';
import { Cache } from '@/infra/cache';
import { readCoa, readEntitas, readKas, readOrg, readPph } from './master-read';
import { MASTER_VENDOR } from '@/repo/schema';
import type { AuthDeps } from './auth';
import type { UowDeps } from './uow';
import { bacaTampilan } from './view-cache';

const NS = 'master';
const OPT = { ttlMs: 600_000, staleMs: 3_600_000 }; // 10 mnt segar; bila Sheets error, data lama (<= 1 jam) tetap dilayani
const caches = new WeakMap<object, Cache>();
const cacheOf = (d: UowDeps): Cache => { let c = caches.get(d.redis); if (!c) { c = new Cache(d.redis, d.clock); caches.set(d.redis, c); } return c; };

// HANYA untuk tampilan/preview. Keputusan tulis (submit, M4) wajib baca SEGAR dari repo/master (design 4.3 langkah 4).
export const getOrg = (d: UowDeps) => cacheOf(d).get(NS, 'org', OPT, () => readOrg(d.store));
export const getEntitas = (d: UowDeps) => cacheOf(d).get(NS, 'entitas', OPT, () => readEntitas(d.store));
export const getCoa = (d: UowDeps) => cacheOf(d).get(NS, 'coa', OPT, () => readCoa(d.store));
export const getKas = (d: UowDeps) => cacheOf(d).get(NS, 'kas', OPT, () => readKas(d.store));
export const getPph = (d: UowDeps) => cacheOf(d).get(NS, 'pph', OPT, () => readPph(d.store));
export const invalidateMaster = (d: UowDeps): Promise<void> => cacheOf(d).invalidate(NS);
export const picOf = (org: Org, brand: string, dept: string) => picOptions(org, brand, dept);

/** Daftar pilihan vendor untuk TAMPILAN (cache 15 dtk + versi tab; M8 F-09). Submit memvalidasi vendor dari baca SEGAR (I8). */
export async function vendorListTampilan(d: AuthDeps, tipe: string) {
  return daftarVendor(await bacaTampilan(d, MASTER_VENDOR), tipe);
}
