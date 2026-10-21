import type { Clock } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import type { RedisPort } from '@/ports/redis';

export interface ThrottleRule { pair: number; perPhone: number; perIp: number; windowMs: number }
/** design 5.3: 5 gagal / 15 mnt per (nomor, IP). Plus plafon per nomor & per IP agar serangan terdistribusi tetap tertahan. */
export const LOGIN_RULE: ThrottleRule = { pair: 5, perPhone: 30, perIp: 50, windowMs: 15 * 60_000 };

/**
 * Pembatas percobaan (login, step-up, lupa password). Hitung KEGAGALAN (atau semua permintaan untuk `forgot`).
 * Kunci memakai string nomor apa adanya (termasuk yang tidak terdaftar) supaya tidak jadi oracle enumerasi.
 * Redis bermasalah -> error dilempar (fail-closed): tanpa Redis memang tidak ada sesi.
 */
export class Throttle {
  constructor(private redis: RedisPort, private clock: Clock, private scope: string, private rule: ThrottleRule) {}
  private keys(phone: string, ip: string): [string, string, string] {
    return [`th:${this.scope}:pi:${phone}:${ip}`, `th:${this.scope}:p:${phone}`, `th:${this.scope}:i:${ip}`];
  }
  private limits(): [number, number, number] { return [this.rule.pair, this.rule.perPhone, this.rule.perIp]; }

  /** Lempar RATE_LIMITED bila sudah terkunci. */
  async assertOpen(phone: string, ip: string): Promise<void> {
    const ks = this.keys(phone, ip), ls = this.limits();
    for (let i = 0; i < ks.length; i++) {
      const c = Number((await this.redis.get(ks[i]!)) ?? 0);
      if (c >= ls[i]!) {
        const ttl = await this.redis.pttl(ks[i]!);
        const sec = Math.max(1, Math.ceil((ttl > 0 ? ttl : this.rule.windowMs) / 1000));
        throw new AppError('RATE_LIMITED', 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.', undefined, sec);
      }
    }
  }
  /** Catat satu kegagalan; true bila inilah yang membuat pasangan (nomor, IP) terkunci. */
  async recordFailure(phone: string, ip: string): Promise<{ justLocked: boolean }> {
    const ks = this.keys(phone, ip);
    let justLocked = false;
    for (let i = 0; i < ks.length; i++) {
      const n = await this.redis.incr(ks[i]!);
      if (n === 1) await this.redis.pexpire(ks[i]!, this.rule.windowMs);
      if (i === 0 && n === this.rule.pair) justLocked = true;
    }
    return { justLocked };
  }
  async reset(phone: string, ip: string): Promise<void> { await this.redis.del(this.keys(phone, ip)[0]); }
}
