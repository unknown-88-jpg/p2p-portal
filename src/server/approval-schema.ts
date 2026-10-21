import { z } from 'zod';
import { bersihkanTeks } from '@/domain/pengajuan';
import { ALASAN_MAX, CATATAN_MAX } from '@/domain/approval';

const txt = (max: number, nl = false) => z.string().max(max * 2).transform((v) => bersihkanTeks(v, nl)).pipe(z.string().max(max));
const etag = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** STRICT: kunci asing (status, level, approver, nominal, ...) ditolak 400. Identitas & nominal selalu dari server. */
export const approveSchema = z.object({ etag, notes: txt(CATATAN_MAX).optional() }).strict();
export const rejectSchema = z.object({ etag, alasan: txt(ALASAN_MAX).pipe(z.string().min(3)) }).strict();
