import { buildAccounts, type Account, type UserRowInput } from '@/domain/roles';
import type { Mutation, TableStore } from '@/ports/store';
import { FIRST_DATA_ROW } from '@/ports/store';
import { MASTER_USER_TTD, colIndex } from '@/repo/schema';

const I = (k: string): number => colIndex(MASTER_USER_TTD, k);
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Baca Master_User_TTD (SEGAR) -> akun per nomor HP. Tab kecil (puluhan baris): satu request. */
export async function loadAccounts(store: Pick<TableStore, 'readRows'>): Promise<Map<string, Account>> {
  const rows = await store.readRows(MASTER_USER_TTD);
  const inputs: UserRowInput[] = [];
  rows.forEach((r, i) => {
    inputs.push({
      row: i + FIRST_DATA_ROW, brand: s(r[I('Brand')]), dept: s(r[I('Departement')]), level: r[I('Level')], jabatan: s(r[I('Jabatan')]),
      nama: s(r[I('Nama')]), email: s(r[I('Email')]), aktif: r[I('Aktif')], phone: s(r[I('No_HP')]),
      hash: s(r[I('Password_Hash')]), salt: s(r[I('Password_Salt')]),
    });
  });
  return buildAccounts(inputs);
}

/** Hash & salt harus IDENTIK di semua baris milik nomor yang sama (aturan lama). */
export function passwordMutations(acc: Account, hash: string, salt: string): Mutation[] {
  return acc.rows.map((row) => ({ kind: 'update' as const, schema: MASTER_USER_TTD, row, cells: { Password_Hash: hash, Password_Salt: salt } }));
}
