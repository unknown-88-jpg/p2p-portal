import type { Clock } from '@/lib/clock';

interface Timer { at: number; seq: number; wake: () => void }

/**
 * Jam virtual dengan auto-advance: waktu hanya maju ketika SEMUA task sedang menunggu sleep() (antrean microtask kosong),
 * lalu melompat ke timer terdekat. Perilakunya seperti waktu nyata tanpa menunggu sungguhan -> uji konkurensi deterministik.
 */
export class FakeClock implements Clock {
  private timers: Timer[] = [];
  private seq = 0;
  private pumping = false;
  constructor(public t = Date.UTC(2026, 9, 5, 3, 0, 0)) {}
  now(): number { return this.t; }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({ at: this.t + Math.max(0, ms), seq: this.seq++, wake: resolve });
      this.schedule();
    });
  }
  /** Lompatan manual (mis. simulasi TTL lock habis saat proses 'macet'). */
  advance(ms: number): void { this.t += ms; }
  private schedule(): void {
    if (this.pumping) return;
    this.pumping = true;
    setImmediate(() => {
      this.pumping = false;
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift();
      if (next) { this.t = Math.max(this.t, next.at); next.wake(); }
      if (this.timers.length) this.schedule();
    });
  }
}
