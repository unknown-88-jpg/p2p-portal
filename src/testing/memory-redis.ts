import type { Clock } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import type { RedisPort } from '@/ports/redis';

interface Entry { v: string; exp: number | null }

/** Redis palsu di memori dengan TTL berbasis Clock + injeksi gangguan (down). Perilaku atomik tiap operasi sama dengan Redis asli. */
export class MemoryRedis implements RedisPort {
  private m = new Map<string, Entry>();
  down = false;
  ops = 0;
  /** latensi jaringan per operasi (virtual) — memaksa interleaving antar-task seperti di produksi */
  latencyMs = 0;
  constructor(private clock: Clock, private yieldEach = true) {}

  private async enter(): Promise<void> {
    if (this.down) throw new AppError('UPSTREAM_BUSY', 'Koordinasi data tidak tersedia. Coba lagi sebentar.', undefined, 3);
    this.ops++;
    if (this.latencyMs > 0) await this.clock.sleep(this.latencyMs);
    else if (this.yieldEach) await Promise.resolve(); // beri kesempatan task lain menyela antar operasi
  }
  private live(key: string): Entry | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= this.clock.now()) { this.m.delete(key); return undefined; }
    return e;
  }
  /** Simulasi kehilangan data Redis (restart/evict). */
  wipe(): void { this.m.clear(); }
  has(key: string): boolean { return this.live(key) !== undefined; }

  async get(key: string): Promise<string | null> { await this.enter(); return this.live(key)?.v ?? null; }
  async set(key: string, value: string, opts?: { pxMs?: number }): Promise<void> {
    await this.enter();
    this.m.set(key, { v: value, exp: opts?.pxMs ? this.clock.now() + opts.pxMs : null });
  }
  async setNx(key: string, value: string, pxMs: number): Promise<boolean> {
    await this.enter();
    if (this.live(key)) return false;
    this.m.set(key, { v: value, exp: this.clock.now() + pxMs });
    return true;
  }
  async del(key: string): Promise<void> { await this.enter(); this.m.delete(key); }
  async compareAndDelete(key: string, expected: string): Promise<boolean> {
    await this.enter();
    const e = this.live(key);
    if (!e || e.v !== expected) return false;
    this.m.delete(key);
    return true;
  }
  async incr(key: string): Promise<number> {
    await this.enter();
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.m.set(key, { v: String(n), exp: e?.exp ?? null });
    return n;
  }
  async pexpire(key: string, ms: number): Promise<void> {
    await this.enter();
    const e = this.live(key);
    if (e) e.exp = this.clock.now() + ms;
  }
  async pttl(key: string): Promise<number> {
    await this.enter();
    const e = this.live(key);
    if (!e) return -2;
    return e.exp === null ? -1 : e.exp - this.clock.now();
  }
  async setMax(key: string, n: number): Promise<number> {
    await this.enter();
    const e = this.live(key);
    const cur = e ? Number(e.v) : 0;
    const next = Math.max(cur, n);
    this.m.set(key, { v: String(next), exp: e?.exp ?? null });
    return next;
  }
}
