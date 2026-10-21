import type { Clock, Rng } from '@/lib/clock';

export class GoogleHttpError extends Error {
  constructor(public readonly status: number, public readonly body = '') {
    super(`Google HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'GoogleHttpError';
  }
}

export interface RetryOpts {
  clock: Clock;
  rng: Rng;
  /** maksimum percobaan ULANG (bukan total). Design 4.3: <= 2. */
  maxRetries?: number;
  /** total waktu tunggu backoff yang boleh dihabiskan. Design 4.3: <= 5 dtk. */
  budgetMs?: number;
  baseMs?: number;
  isRetryable: (e: unknown) => boolean;
}

/** Backoff eksponensial + jitter penuh, dibatasi jumlah dan anggaran waktu. HANYA untuk operasi idempoten (baca) atau penolakan tegas (429). */
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOpts): Promise<T> {
  const max = o.maxRetries ?? 2;
  const budget = o.budgetMs ?? 5_000;
  const base = o.baseMs ?? 300;
  let spent = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= max || !o.isRetryable(e)) throw e;
      const wait = Math.round(o.rng() * base * 2 ** attempt + base * 2 ** attempt / 2);
      if (spent + wait > budget) throw e;
      spent += wait;
      await o.clock.sleep(wait);
    }
  }
}
