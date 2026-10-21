import { AppError } from '@/lib/errors';
import { colIndex, type TabSchema } from '@/repo/schema';
import { FIRST_DATA_ROW, type RawRow, type TableStore } from '@/ports/store';
import type { RedisPort } from '@/ports/redis';

export interface Found { row: number; data: RawRow }

/**
 * Cari nomor baris dari ID. Indeks id->baris di Redis hanya PETUNJUK: selalu diverifikasi dengan membaca baris itu
 * (kolom kunci harus == ID). Salah/hilang -> bangun ulang dari kolom kunci (1 request). Nomor baris TIDAK PERNAH dari klien (R-21).
 */
export async function findRowById(redis: RedisPort, store: TableStore, schema: TabSchema, keyCol: string, id: string): Promise<Found | null> {
  const ki = colIndex(schema, keyCol);
  const rk = `ri:${schema.tab}:${id}`;
  let hint: number | null = null;
  try { const h = await redis.get(rk); hint = h ? Number(h) : null; } catch { /* tanpa petunjuk */ }
  if (hint && hint >= FIRST_DATA_ROW) {
    const data = await store.readRow(schema, hint);
    if (data && String(data[ki] ?? '') === id) return { row: hint, data };
  }
  const col = await store.readColumn(schema, keyCol);
  const matches: number[] = [];
  col.forEach((v, i) => { if (String(v ?? '') === id) matches.push(i + FIRST_DATA_ROW); });
  if (matches.length > 1) throw new AppError('INTERNAL', `ID ganda di ${schema.tab}: ${id}. Hubungi admin.`);
  const row = matches[0];
  if (row === undefined) return null;
  const data = await store.readRow(schema, row);
  if (!data) return null;
  try { await redis.set(rk, String(row), { pxMs: 24 * 3_600_000 }); } catch { /* abaikan */ }
  return { row, data };
}
