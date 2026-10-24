import { z } from 'zod';

const t = (max: number) => z.string().trim().max(max);
/** Form user admin. `row`+`etag` = ubah baris dari daftar (diverifikasi server); tanpa keduanya = baris baru. Hash/salt tidak pernah diterima. */
export const simpanUserSchema = z.object({
  row: z.number().int().min(2).max(100_000).optional(),
  etag: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  brand: t(60), dept: t(60), level: z.number().int(), jabatan: t(120), nama: t(120), email: t(160), aktif: z.boolean(), noHp: t(32),
}).strict();
export const noHpSchema = z.object({ noHp: t(32).pipe(z.string().min(6)) }).strict();
export const pratinjauRepairSchema = z.object({ jenis: z.enum(['rekonsiliasi', 'nol-rekening']) }).strict();
export const jalankanRepairSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,40}$/) }).strict();
