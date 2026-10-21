/** Operasi Redis minimum yang dibutuhkan koordinasi (lock, cache, idempotency, counter, rate-limit). Redis BUKAN sumber kebenaran. */
export interface RedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { pxMs?: number }): Promise<void>;
  /** SET NX PX — true bila kunci berhasil dibuat. */
  setNx(key: string, value: string, pxMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Hapus hanya jika nilainya == expected (lepas lock aman). */
  compareAndDelete(key: string, expected: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<void>;
  /** sisa umur (ms); -1 tanpa TTL, -2 tidak ada */
  pttl(key: string): Promise<number>;
  /** Set kunci ke max(nilai sekarang, n); kembalikan hasilnya (bootstrap counter ID). */
  setMax(key: string, n: number): Promise<number>;
}
