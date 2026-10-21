import { createHmac, randomBytes } from 'node:crypto';
import type { RedisPort } from '@/ports/redis';
import type { Clock } from '@/lib/clock';

export const SETPASS_TTL_MS = 60 * 60_000; // sama dengan lama (APPROVER_SETPASS_TOKEN_TTL_MIN = 60)

/** Token sekali-pakai untuk set-password. Disimpan di bawah HMAC(token); klaim atomik (compare-and-delete) -> tidak bisa dipakai dua kali. */
export class LinkTokens {
  constructor(private redis: RedisPort, private clock: Clock, private pepper: string) {}
  private key(token: string): string { return `spt:${createHmac('sha256', this.pepper).update(token).digest('hex')}`; }

  async issue(phone: string, ttlMs = SETPASS_TTL_MS): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(token), JSON.stringify({ phone, at: this.clock.now() }), { pxMs: ttlMs });
    return token;
  }
  async peek(token: string): Promise<{ phone: string } | null> {
    if (token.length < 20 || token.length > 100) return null;
    const raw = await this.redis.get(this.key(token));
    return raw ? { phone: (JSON.parse(raw) as { phone: string }).phone } : null;
  }
  /** Klaim sekali pakai. `restore()` mengembalikan token bila penulisan sesudahnya gagal. */
  async claim(token: string): Promise<{ phone: string; restore: () => Promise<void> } | null> {
    if (token.length < 20 || token.length > 100) return null;
    const k = this.key(token);
    const raw = await this.redis.get(k);
    if (!raw) return null;
    if (!(await this.redis.compareAndDelete(k, raw))) return null; // keduluan klaim lain
    return { phone: (JSON.parse(raw) as { phone: string }).phone, restore: () => this.redis.set(k, raw, { pxMs: 10 * 60_000 }) };
  }
}
