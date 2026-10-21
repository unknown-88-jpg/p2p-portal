import { randomInt } from 'node:crypto';
import { KODE_TTL_MS } from '@/domain/wa';
import { AppError } from '@/lib/errors';
import type { AuthDeps } from './auth';

/**
 * Kode approval WA di Redis (pengganti tab WA_Pending_Approval + Script Properties WA_ACT_*).
 * Kode TERIKAT NOMOR (kunci memuat nomor): pengirim hanya bisa membuka kode miliknya sendiri. TTL 3 hari (= aturan lama).
 * `etag` = versi dokumen saat kode diterbitkan; dokumen berubah sesudahnya -> aksi ditolak (CONFLICT), bukan menyetujui versi lain.
 * Redis BUKAN sumber kebenaran: kode hilang = approver cukup menunggu digest berikutnya atau memakai web.
 */
export interface KodeRec { idTrx: string; email: string; etag: string; status: 'WAITING' | 'DONE'; dibuat: number }

const kKode = (phone: string, kode: string): string => `wa:k:${phone}:${kode}`;
const kDoc = (phone: string, idTrx: string): string => `wa:d:${phone}:${idTrx}`;

export async function bacaKode(d: AuthDeps, phone: string, kode: string): Promise<KodeRec | null> {
  const raw = await d.redis.get(kKode(phone, kode));
  if (!raw) return null;
  try { return JSON.parse(raw) as KodeRec; } catch { return null; }
}

/** Dokumen+approver yang sama dengan etag sama memakai ulang kode (approver tidak bingung kode berubah tiap digest). Etag berubah -> kode lama dicabut. */
export async function terbitkanKode(d: AuthDeps, a: { phone: string; email: string; idTrx: string; etag: string }): Promise<string> {
  const lama = await d.redis.get(kDoc(a.phone, a.idTrx));
  if (lama) {
    const rec = await bacaKode(d, a.phone, lama);
    if (rec && rec.status === 'WAITING' && rec.etag === a.etag) return lama;
    await d.redis.del(kKode(a.phone, lama));
  }
  const rec: KodeRec = { idTrx: a.idTrx, email: a.email, etag: a.etag, status: 'WAITING', dibuat: d.clock.now() };
  for (let i = 0; i < 50; i++) {
    const kode = String(randomInt(1000, 10000));
    if (await d.redis.setNx(kKode(a.phone, kode), JSON.stringify(rec), KODE_TTL_MS)) {
      await d.redis.set(kDoc(a.phone, a.idTrx), kode, { pxMs: KODE_TTL_MS });
      return kode;
    }
  }
  throw new AppError('UPSTREAM_BUSY', 'Gagal menerbitkan kode approval.', undefined, 3);
}

/** Sekali pakai: tandai DONE (tetap disimpan sampai TTL supaya balasan "sudah dipakai" benar). */
export async function tandaiSelesai(d: AuthDeps, phone: string, kode: string, rec: KodeRec): Promise<void> {
  const ttl = await d.redis.pttl(kKode(phone, kode));
  await d.redis.set(kKode(phone, kode), JSON.stringify({ ...rec, status: 'DONE' } satisfies KodeRec), { pxMs: ttl > 0 ? ttl : KODE_TTL_MS });
}
