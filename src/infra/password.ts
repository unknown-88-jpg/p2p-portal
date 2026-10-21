import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// scrypt N=2^15, r=8, p=1 (design 5.2) ≈ 32 MiB & puluhan ms CPU. Parameter ikut disimpan di string hash -> bisa dinaikkan tanpa memutus hash lama.
let N = 32768;
const R = 8, P = 1, KEYLEN = 32;
/** HANYA untuk test (mempercepat suite). Produksi tidak pernah memanggil ini. */
export function __setScryptCostForTests(n: number): void { N = n; dummy = null; }
const maxmem = (n: number, r: number): number => 128 * n * r * 2 + 1024 * 1024;

let dummy: string | null = null;
const b64 = (b: Buffer): string => b.toString('base64url');

export interface HashResult { hash: string; salt: string }

/** Format baru: `s1$N$r$p$salt$hash`. Kolom Password_Salt diisi penanda "s1" (kolom lama tetap non-kosong, salt sebenarnya ada di dalam string hash). */
export async function hashPassword(password: string): Promise<HashResult> {
  const salt = randomBytes(16);
  const dk = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return { hash: `s1$${N}$${R}$${P}$${b64(salt)}$${b64(dk)}`, salt: 's1' };
}

const eq = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

async function verifyS1(password: string, stored: string): Promise<boolean> {
  const [, n, r, p, salt, hash] = stored.split('$');
  if (!n || !r || !p || !salt || !hash) return false;
  const [nn, rr, pp] = [Number(n), Number(r), Number(p)];
  if (!Number.isInteger(nn) || !Number.isInteger(rr) || !Number.isInteger(pp) || nn > 2 ** 20 || rr > 32 || pp > 8) return false; // cegah parameter jahat/rusak
  const want = Buffer.from(hash, 'base64url');
  const dk = await scrypt(password, Buffer.from(salt, 'base64url'), want.length, { N: nn, r: rr, p: pp, maxmem: maxmem(nn, rr) });
  return eq(dk, want);
}

/** Hash lama Apps Script (hashPassword_ di Auth.gs): hex = salt+":"+password; ulang 3000x SHA-256 atas string hex hasil sebelumnya. */
export const LEGACY_ITERATIONS = 3000;
export function legacyHash(password: string, salt: string, iterations = LEGACY_ITERATIONS): string {
  let hex = `${salt}:${password}`;
  for (let i = 0; i < iterations; i++) hex = createHash('sha256').update(hex, 'utf8').digest('hex');
  return hex;
}

export type Verdict = { ok: false } | { ok: true; needsRehash: boolean };

/** Verifikasi s1 atau hash lama. needsRehash=true untuk hash lama (di-upgrade ke scrypt oleh pemanggil setelah login sukses). */
export async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<Verdict> {
  if (storedHash.startsWith('s1$')) return (await verifyS1(password, storedHash)) ? { ok: true, needsRehash: false } : { ok: false };
  if (!storedSalt || !/^[0-9a-f]{64}$/i.test(storedHash)) return { ok: false };
  const got = Buffer.from(legacyHash(password, storedSalt), 'hex');
  return eq(got, Buffer.from(storedHash.toLowerCase(), 'hex')) ? { ok: true, needsRehash: true } : { ok: false };
}

/** Menyamakan waktu respons untuk nomor yang tidak ada / belum punya password (anti-enumerasi lewat timing). */
export async function burnVerify(password: string): Promise<void> {
  dummy ??= (await hashPassword('dummy-password-for-timing')).hash;
  await verifyS1(password, dummy);
}
