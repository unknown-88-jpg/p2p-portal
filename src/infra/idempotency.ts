import { createHash } from 'node:crypto';
import type { Clock } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import type { RedisPort } from '@/ports/redis';

export const IDEM_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const INFLIGHT_TTL_MS = 60_000;
const KEEP_MS = 24 * 3_600_000;
export const QUIESCE_MS = 10_000; // setelah hasil ambigu, tunggu sebelum menjalankan ulang (permintaan lama mungkin masih terbang)

type Rec = { state: 'inflight' | 'ambiguous' | 'done'; at: number; result?: unknown };
export type Begin =
  | { kind: 'new' }
  | { kind: 'replay'; result: unknown }
  | { kind: 'ambiguous'; at: number };

export function scopeHash(actor: string, action: string, key: string): string {
  return createHash('sha256').update(`${actor}\u0000${action}\u0000${key}`).digest('hex');
}
/** Penanda yang ditulis ke Notes baris audit pertama aksi; dipakai membaca-balik hasil yang ambigu. */
export function marker(hash: string, key: string): string { return `[idem:${hash.slice(0, 8)}:${key}]`; }

export class Idempotency {
  constructor(private redis: RedisPort, private clock: Clock) {}
  private rk(hash: string): string { return `idem:${hash}`; }
  private async load(hash: string): Promise<Rec | null> {
    const raw = await this.redis.get(this.rk(hash));
    return raw ? (JSON.parse(raw) as Rec) : null;
  }

  async begin(hash: string): Promise<Begin> {
    const rec: Rec = { state: 'inflight', at: this.clock.now() };
    if (await this.redis.setNx(this.rk(hash), JSON.stringify(rec), INFLIGHT_TTL_MS)) return { kind: 'new' };
    const cur = await this.load(hash);
    if (!cur) return this.begin(hash); // kedaluwarsa di antara dua panggilan
    if (cur.state === 'done') return { kind: 'replay', result: cur.result };
    if (cur.state === 'ambiguous') return { kind: 'ambiguous', at: cur.at };
    throw new AppError('CONFLICT', 'Permintaan yang sama sedang diproses.', undefined, 2);
  }
  /** Dipanggil di dalam lock saat record ambigu: ambil alih jadi inflight baru. */
  async takeOver(hash: string): Promise<void> {
    await this.redis.set(this.rk(hash), JSON.stringify({ state: 'inflight', at: this.clock.now() } satisfies Rec), { pxMs: INFLIGHT_TTL_MS });
  }
  async current(hash: string): Promise<Rec | null> { return this.load(hash); }
  async done(hash: string, result: unknown): Promise<void> {
    await this.redis.set(this.rk(hash), JSON.stringify({ state: 'done', at: this.clock.now(), result } satisfies Rec), { pxMs: KEEP_MS });
  }
  async ambiguous(hash: string): Promise<void> {
    await this.redis.set(this.rk(hash), JSON.stringify({ state: 'ambiguous', at: this.clock.now() } satisfies Rec), { pxMs: KEEP_MS });
  }
  /** Kegagalan tegas (tidak ada yang tertulis): izinkan ulang dengan kunci yang sama. */
  async clear(hash: string): Promise<void> { await this.redis.del(this.rk(hash)); }
}
