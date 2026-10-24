import { z } from 'zod';
import type { Account } from '@/domain/roles';
import { maskPhone, normalizePhone } from '@/domain/phone';
import { POLICY_MESSAGE, PASSWORD_MAX, checkPassword } from '@/domain/password-policy';
import { burnVerify, hashPassword, verifyPassword } from '@/infra/password';
import { LinkTokens, SETPASS_TTL_MS } from '@/infra/link-tokens';
import { SessionStore, type SessionData } from '@/infra/session';
import { LOGIN_RULE, Throttle, type ThrottleRule } from '@/infra/throttle';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { DrivePort } from '@/ports/drive';
import type { LinkSender } from '@/ports/link-sender';
import type { WaSender } from '@/ports/wa-sender';
import { appendAudit, auditMutation } from './audit';
import { loadAccounts, passwordMutations } from './users';
import { runAction, type UowDeps } from './uow';


export interface AuthDeps extends UowDeps {
  drive: DrivePort;
  sessions: SessionStore;
  tokens: LinkTokens;
  sender: LinkSender;
  /** Pengirim WhatsApp (notifikasi, balasan webhook). Tidak pernah melempar. */
  wa: WaSender;
  baseUrl: string;
}

export const GENERIC_LOGIN_FAIL = "Nomor HP atau password salah. Belum punya password? Gunakan 'Atur / lupa password'.";

// ---------- skema input (zod) ----------
export const loginSchema = z.object({ phone: z.string().min(1).max(32), password: z.string().min(1).max(PASSWORD_MAX) });
export const cekLinkSchema = z.object({ token: z.string().min(20).max(100) });
export const setPasswordSchema = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(PASSWORD_MAX) });
export const forgotSchema = z.object({ phone: z.string().min(1).max(32) });
export const stepUpSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX) });

const FORGOT_RULE = { pair: 3, perPhone: 3, perIp: 10, windowMs: 60 * 60_000 };
const throttleOf = (d: AuthDeps, scope: string, rule = LOGIN_RULE): Throttle => new Throttle(d.redis, d.clock, scope, rule);

/** Kunci throttle: nomor ternormalisasi, atau input mentah yang dibersihkan bila tidak valid (supaya tetap terhitung). */
const phoneKey = (raw: string): string => normalizePhone(raw) || `x:${raw.replace(/\s/g, '').slice(0, 20)}`;

/** Audit kegagalan = pengaman, bukan jalur kritis: dibatasi (1 per nomor per 15 mnt, maks 10/mnt global) agar penyerang tidak bisa menghabiskan kuota tulis Sheets (60/mnt). */
async function auditFailure(d: AuthDeps, action: string, pk: string, ip: string): Promise<void> {
  try {
    if (!(await d.redis.setNx(`fa:${action}:${pk}`, '1', 15 * 60_000))) return;
    const g = await d.redis.incr(`fag:${Math.floor(d.clock.now() / 60_000)}`);
    if (g === 1) await d.redis.pexpire(`fag:${Math.floor(d.clock.now() / 60_000)}`, 120_000);
    if (g > 10) return;
    await appendAudit(d.store, d.clock, { actor: '-', action, field: 'Auth', newValue: pk.startsWith('x:') ? pk : maskPhone(pk), notes: `ip=${ip}` });
  } catch (e) { logger.warn('audit_failure_skipped', { err: (e as Error).message }); }
}

async function auditRequired(d: AuthDeps, e: Parameters<typeof appendAudit>[2]): Promise<void> {
  try { await appendAudit(d.store, d.clock, e); }
  catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UPSTREAM_BUSY', 'Sistem sedang sibuk. Coba lagi sebentar.', undefined, 3);
  }
}

async function accountOf(d: AuthDeps, phone: string): Promise<Account | undefined> {
  return (await loadAccounts(d.store)).get(phone);
}

// ---------- login ----------
export interface LoginResult { token: string; user: { nama: string; jabatan: string; email: string }; roles: SessionData['roles'] }

export async function login(d: AuthDeps, input: z.infer<typeof loginSchema>, ip: string): Promise<LoginResult> {
  const phone = normalizePhone(input.phone);
  const pk = phoneKey(input.phone);
  const th = throttleOf(d, 'login');
  await th.assertOpen(pk, ip);

  const acc = phone ? await accountOf(d, phone) : undefined;
  const usable = acc && acc.aktif && acc.hash;
  let verdict: Awaited<ReturnType<typeof verifyPassword>> = { ok: false };
  if (usable) verdict = await verifyPassword(input.password, acc.hash, acc.salt);
  else await burnVerify(input.password);

  if (!usable || !verdict.ok) {
    const { justLocked } = await th.recordFailure(pk, ip);
    await auditFailure(d, justLocked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', pk, ip);
    throw new AppError('UNAUTHENTICATED', GENERIC_LOGIN_FAIL);
  }
  await th.reset(pk, ip);

  if (verdict.needsRehash) await upgradeHash(d, acc, input.password); // best-effort, tidak menghalangi login

  await auditRequired(d, { actor: acc.email || acc.phone, action: 'LOGIN', field: 'Auth', newValue: maskPhone(acc.phone), notes: `ip=${ip}` });
  const token = await d.sessions.create({ phone: acc.phone, email: acc.email, nama: acc.nama, jabatan: acc.jabatan, roles: acc.roles });
  return { token, user: { nama: acc.nama, jabatan: acc.jabatan, email: acc.email }, roles: acc.roles };
}

/** Lazy-migrate hash lama -> scrypt. NB: setelah ini sistem Apps Script lama tidak bisa memverifikasi user tsb (catat di checklist cutover). */
async function upgradeHash(d: AuthDeps, acc: Account, password: string): Promise<void> {
  try {
    const { hash, salt } = await hashPassword(password);
    await runAction(d, {
      name: 'auth.rehash', actor: acc.email || acc.phone, lockKeys: [`user:${acc.phone}`],
      execute: async ({ store, clock }) => {
        const cur = (await loadAccounts(store)).get(acc.phone);
        if (!cur || cur.hash !== acc.hash) throw new AppError('CONFLICT', 'Password berubah saat upgrade.'); // ada set-password lain: jangan timpa
        return { mutations: [...passwordMutations(cur, hash, salt), auditMutation({ actor: cur.email || cur.phone, action: 'PASSWORD_REHASH', field: 'Master_User_TTD', newValue: maskPhone(cur.phone) }, clock)], result: true };
      },
    });
  } catch (e) { logger.warn('rehash_skipped', { err: (e as Error).message }); }
}

// ---------- sesi ----------
export async function getSession(d: AuthDeps, token: string | undefined): Promise<SessionData | null> {
  return d.sessions.load(token);
}

export async function logout(d: AuthDeps, token: string | undefined): Promise<void> {
  const s = await d.sessions.load(token).catch(() => null);
  await d.sessions.destroy(token);
  if (s) { try { await appendAudit(d.store, d.clock, { actor: s.email || s.phone, action: 'LOGOUT', field: 'Auth', newValue: maskPhone(s.phone) }); } catch (e) { logger.warn('logout_audit_skipped', { err: (e as Error).message }); } }
}

// ---------- step-up (konfirmasi ulang password untuk aksi uang; berlaku 5 menit per sesi) ----------
export async function stepUp(d: AuthDeps, token: string, s: SessionData, input: z.infer<typeof stepUpSchema>, ip: string): Promise<void> {
  const th = throttleOf(d, 'stepup');
  await th.assertOpen(s.phone, ip);
  const acc = await accountOf(d, s.phone);
  const v = acc && acc.aktif && acc.hash ? await verifyPassword(input.password, acc.hash, acc.salt) : (await burnVerify(input.password), { ok: false as const });
  if (!v.ok) {
    const { justLocked } = await th.recordFailure(s.phone, ip);
    await auditFailure(d, justLocked ? 'STEPUP_LOCKED' : 'STEPUP_FAILED', s.phone, ip);
    throw new AppError('UNAUTHENTICATED', 'Password salah.');
  }
  await th.reset(s.phone, ip);
  await d.sessions.markStepUp(token);
}

/** Guard untuk aksi uang (dipakai M5+): lempar bila belum konfirmasi password dalam 5 menit terakhir. */
export async function requireStepUp(d: AuthDeps, token: string): Promise<void> {
  if (!(await d.sessions.hasStepUp(token))) throw new AppError('FORBIDDEN', 'Konfirmasi password diperlukan untuk aksi ini.', { stepUp: 'required' });
}

// ---------- set-password (token sekali pakai) ----------
/**
 * F-12: pemeriksaan link set-password SAAT HALAMAN DIBUKA, supaya pengguna tidak mengetik password dulu baru tahu link mati.
 * Hanya mengintip (`peek`): token TIDAK dihanguskan dan nomor TIDAK dikembalikan (hanya benar/tidak).
 * Pembatas TERPISAH dari `setpass` (lihat `SETPASS_RULE`). Pemeriksaan dihitung per IP (20 link tak valid / 15 mnt) dengan plafon global longgar; token 256-bit, jadi ini
 * hanya penahan penyalahgunaan, bukan satu-satunya pertahanan.
 */
const CEK_LINK_RULE: ThrottleRule = { pair: 20, perPhone: 500, perIp: 20, windowMs: 15 * 60_000 };
export async function cekLinkSetPassword(d: AuthDeps, input: z.infer<typeof cekLinkSchema>, ip: string): Promise<{ valid: boolean }> {
  const th = throttleOf(d, 'setpasscek', CEK_LINK_RULE);
  await th.assertOpen('-', ip);
  const peek = await d.tokens.peek(input.token);
  if (!peek) { await th.recordFailure('-', ip); return { valid: false }; }
  return { valid: true };
}

/**
 * Pembatas link tak valid saat menyimpan password. Kunci nomor selalu '-' (nomor belum diketahui sebelum token dicek), jadi:
 * `pair` & `perIp` = batas PER IP (10 / 15 mnt), `perPhone` = plafon GLOBAL longgar (500 / 15 mnt) sebagai rem penyalahgunaan massal.
 * Dulu plafon global = 10: 10 kegagalan dari IP mana pun mengunci set-password untuk SEMUA orang 15 menit (temuan STATUS, 2026-10-24).
 * Token 256-bit, jadi pembatas ini bukan satu-satunya pertahanan terhadap tebakan.
 */
export const SETPASS_RULE: ThrottleRule = { pair: 10, perPhone: 500, perIp: 10, windowMs: 15 * 60_000 };
export async function setPasswordViaToken(d: AuthDeps, input: z.infer<typeof setPasswordSchema>, ip: string): Promise<void> {
  const th = throttleOf(d, 'setpass', SETPASS_RULE);
  await th.assertOpen('-', ip);
  const peek = await d.tokens.peek(input.token);
  if (!peek) {
    await th.recordFailure('-', ip);
    throw new AppError('VALIDATION', 'Link sudah kedaluwarsa atau tidak valid. Minta link baru.');
  }
  const issue = checkPassword(input.password, peek.phone);
  if (issue) throw new AppError('VALIDATION', POLICY_MESSAGE[issue], { password: issue });

  const { hash, salt } = await hashPassword(input.password); // di luar lock: scrypt ±puluhan ms
  let restore: (() => Promise<void>) | null = null;
  try {
    await runAction(d, {
      name: 'auth.setPassword', actor: peek.phone, lockKeys: [`user:${peek.phone}`],
      execute: async ({ store, clock }) => {
        const claim = await d.tokens.claim(input.token);            // atomik: hanya satu yang menang
        if (!claim) throw new AppError('VALIDATION', 'Link sudah dipakai atau kedaluwarsa. Minta link baru.');
        restore = claim.restore;
        const acc = (await loadAccounts(store)).get(claim.phone);
        if (!acc || !acc.aktif) throw new AppError('FORBIDDEN', 'Akun tidak aktif. Hubungi admin.');
        return {
          mutations: [...passwordMutations(acc, hash, salt), auditMutation({ actor: acc.email || acc.phone, action: 'SET_PASSWORD', field: 'Master_User_TTD', newValue: maskPhone(acc.phone), notes: `ip=${ip}` }, clock)],
          result: true,
        };
      },
    });
  } catch (e) {
    if (restore && !(e instanceof AppError && e.code === 'VALIDATION')) await (restore as () => Promise<void>)().catch(() => undefined);
    throw e;
  }
  await d.sessions.revokeAll(peek.phone).catch((e: unknown) => logger.error('revoke_failed', { err: (e as Error).message }));
}

// ---------- lupa password / admin kirim link ----------
export function setPasswordLink(d: AuthDeps, token: string): string {
  return `${d.baseUrl.replace(/\/+$/, '')}/set-password?t=${token}`;
}

/**
 * Publik: balasan SELALU generik. Hanya akun aktif yang benar-benar menerima link. Rate-limit per nomor & per IP.
 * Tahap sinkron (dijalankan SEBELUM membalas): throttle yang dihitung untuk SEMUA permintaan.
 * Mengembalikan `deliver` = kerja yang hanya ada untuk nomor terdaftar (token, kirim link, audit).
 * Route menjalankannya SETELAH respons dikirim (after()), supaya waktu respons tidak membedakan nomor terdaftar
 * dari yang tidak (mencegah enumerasi lewat timing). `deliver` tidak pernah melempar.
 */
export async function forgotPasswordPrepare(d: AuthDeps, input: z.infer<typeof forgotSchema>, ip: string): Promise<() => Promise<void>> {
  const pk = phoneKey(input.phone);
  const th = throttleOf(d, 'forgot', FORGOT_RULE);
  await th.assertOpen(pk, ip);
  await th.recordFailure(pk, ip); // menghitung SEMUA permintaan
  const phone = normalizePhone(input.phone);
  return async () => {
    try {
      const acc = phone ? await accountOf(d, phone) : undefined;
      if (acc && acc.aktif) {
        const token = await d.tokens.issue(acc.phone);
        await d.sender.sendSetPasswordLink(acc.phone, acc.nama, setPasswordLink(d, token), SETPASS_TTL_MS / 60_000);
        await auditFailure(d, 'FORGOT_PASSWORD', pk, ip); // penanda, throttled
      }
    } catch (e) { logger.error('forgot_failed', { err: (e as Error).message }); }
  };
}

/** Versi menunggu (tes & pemanggil non-route): prepare lalu deliver berurutan. */
export async function forgotPassword(d: AuthDeps, input: z.infer<typeof forgotSchema>, ip: string): Promise<void> {
  const deliver = await forgotPasswordPrepare(d, input, ip);
  await deliver();
}

/** Admin-run (script): terbitkan link set-password tanpa mengirim; mengembalikan link. Pengganti kirimLinkSetPasswordApprover. */
export async function issueSetPasswordLink(d: AuthDeps, phoneInput: string): Promise<{ link: string; nama: string; phone: string }> {
  const phone = normalizePhone(phoneInput);
  const acc = phone ? await accountOf(d, phone) : undefined;
  if (!acc) throw new AppError('NOT_FOUND', 'Nomor HP tidak ditemukan di Master_User_TTD.');
  if (!acc.aktif) throw new AppError('FORBIDDEN', 'Semua baris untuk nomor ini nonaktif.');
  const token = await d.tokens.issue(acc.phone);
  await appendAudit(d.store, d.clock, { actor: 'admin-script', action: 'ISSUE_SETPASS_LINK', field: 'Auth', newValue: maskPhone(acc.phone) });
  return { link: setPasswordLink(d, token), nama: acc.nama, phone: acc.phone };
}


// Re-ekspor untuk lapisan app (app tidak boleh mengimpor infra langsung).
export { SESSION_ABSOLUTE_MS, STEPUP_MS } from '@/infra/session';
export type { SessionData } from '@/infra/session';
