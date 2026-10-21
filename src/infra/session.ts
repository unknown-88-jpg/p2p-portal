import { createHmac, randomBytes } from 'node:crypto';
import type { Clock } from '@/lib/clock';
import type { Role } from '@/domain/roles';
import type { RedisPort } from '@/ports/redis';

export const SESSION_IDLE_MS = 60 * 60_000;       // idle 60 menit
export const SESSION_ABSOLUTE_MS = 8 * 3_600_000; // maks 8 jam
export const STEPUP_MS = 5 * 60_000;              // hasil konfirmasi password berlaku 5 menit

export interface SessionData {
  phone: string; email: string; nama: string; jabatan: string; roles: Role[];
  created: number; ep: number; // ep = epoch revoke milik nomor ini saat sesi dibuat
}

/**
 * Sesi = token acak opak (256 bit) di cookie httpOnly; di Redis disimpan di bawah HMAC(token) (kebocoran Redis tidak membocorkan token).
 * Deviasi sadar dari design 5.3: bukan JWT. Karena jti WAJIB dicek ke Redis tiap request (revoke), JWT tidak memberi keuntungan stateless;
 * token opak lebih sederhana, tanpa pustaka tambahan & tanpa risiko salah-konfigurasi algoritma.
 */
export class SessionStore {
  constructor(private redis: RedisPort, private clock: Clock, private pepper: string) {}

  private sid(token: string): string { return createHmac('sha256', this.pepper).update(token).digest('hex'); }
  private epKey(phone: string): string { return `uep:${phone}`; }
  private async epoch(phone: string): Promise<number> { return Number((await this.redis.get(this.epKey(phone))) ?? 0); }

  async create(d: Omit<SessionData, 'created' | 'ep'>): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const rec: SessionData = { ...d, created: this.clock.now(), ep: await this.epoch(d.phone) };
    await this.redis.set(`sess:${this.sid(token)}`, JSON.stringify(rec), { pxMs: SESSION_IDLE_MS });
    return token;
  }

  /** Muat + validasi (absolut, epoch) + perpanjang idle. null = tidak valid. Redis error -> dilempar (fail-closed). */
  async load(token: string | undefined): Promise<SessionData | null> {
    if (!token || token.length < 20 || token.length > 100) return null;
    const key = `sess:${this.sid(token)}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionData;
    if (this.clock.now() - s.created > SESSION_ABSOLUTE_MS || s.ep !== (await this.epoch(s.phone))) {
      await this.redis.del(key);
      return null;
    }
    await this.redis.pexpire(key, SESSION_IDLE_MS);
    return s;
  }

  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    const id = this.sid(token);
    await this.redis.del(`sess:${id}`);
    await this.redis.del(`su:${id}`);
  }

  /** Matikan SEMUA sesi nomor ini (ganti password, user dinonaktifkan). */
  async revokeAll(phone: string): Promise<void> { await this.redis.incr(this.epKey(phone)); }

  async markStepUp(token: string): Promise<void> { await this.redis.set(`su:${this.sid(token)}`, '1', { pxMs: STEPUP_MS }); }
  async hasStepUp(token: string): Promise<boolean> { return (await this.redis.get(`su:${this.sid(token)}`)) === '1'; }
}
