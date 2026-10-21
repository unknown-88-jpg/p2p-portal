import { bangunCoa, bangunEntitas, bangunKas, bangunOrg, bangunPph, cariVendor, daftarVendor, type Entitas, type Org } from '@/domain/master';
import type { TableStore } from '@/ports/store';
import { MASTER_COA, MASTER_PPH, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR } from '@/repo/schema';

// Pembaca data master (SEGAR dari Sheets; cache diatur pemanggil di server/master.ts). Tab kecil -> satu request per tab.
export const readEntitas = async (s: TableStore): Promise<Entitas> => bangunEntitas(await s.readRows(MASTER_SETTING));
export const readCoa = async (s: TableStore) => bangunCoa(await s.readRows(MASTER_COA));
export const readKas = async (s: TableStore) => bangunKas(await readCoa(s));
export const readPph = async (s: TableStore) => bangunPph(await s.readRows(MASTER_PPH));
export async function readOrg(s: TableStore): Promise<Org> {
  const [users, ent] = await Promise.all([s.readRows(MASTER_USER_TTD), readEntitas(s)]);
  return bangunOrg(users, ent.brandCompanyMap);
}
export const readVendorByCode = async (s: TableStore, kode: string) => cariVendor(await s.readRows(MASTER_VENDOR), kode);
export const readVendorList = async (s: TableStore, tipe: string) => daftarVendor(await s.readRows(MASTER_VENDOR), tipe);
