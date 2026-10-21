import { AppError } from '@/lib/errors';
import { colIndex, type TabSchema } from '@/repo/schema';
import type { RedisPort } from '@/ports/redis';
import type { TableStore } from '@/ports/store';

export interface IdSpec { prefix: string; pad: number; schema: TabSchema; keyCol: string }
/** Spesifikasi ID sistem lama: TRD-00001, NTR-00001, VND-0001. */
export const idLockName = (prefix: string): string => `seq:${prefix}`;

/**
 * Nomor berikutnya. WAJIB dipanggil sambil memegang lock `seq:{prefix}`.
 * Sumber kebenaran = sheet: counter Redis di-set ke max(Redis, ID tertinggi di sheet) lalu INCR, dan ID hasil dipastikan belum ada
 * di sheet (Redis boleh hilang/mundur tanpa menghasilkan ID kembar).
 */
export async function nextId(redis: RedisPort, store: TableStore, spec: IdSpec): Promise<string> {
  const col = await store.readColumn(spec.schema, spec.keyCol);
  const re = new RegExp(`^${spec.prefix}-(\\d+)$`);
  const used = new Set<string>();
  let max = 0;
  for (const v of col) {
    const s = String(v ?? '');
    const m = re.exec(s);
    if (m) { used.add(s); max = Math.max(max, parseInt(m[1]!, 10)); }
  }
  void colIndex(spec.schema, spec.keyCol);
  const key = `seqn:${spec.prefix}`;
  await redis.setMax(key, max);
  for (let i = 0; i < 5; i++) {
    const n = await redis.incr(key);
    const id = `${spec.prefix}-${String(n).padStart(spec.pad, '0')}`;
    if (!used.has(id)) return id;
  }
  throw new AppError('INTERNAL', 'Gagal membuat nomor baru. Coba lagi.');
}
