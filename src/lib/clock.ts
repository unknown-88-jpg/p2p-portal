/** Jam yang bisa disuntik (test memakai jam palsu). Semua kode berwaktu memakai ini, bukan Date.now() langsung. */
export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Sumber acak yang bisa disuntik (jitter retry/poll). */
export type Rng = () => number;
