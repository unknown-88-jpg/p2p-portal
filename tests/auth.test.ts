import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { forgotPassword, getSession, GENERIC_LOGIN_FAIL, issueSetPasswordLink, login, logout, requireStepUp, setPasswordViaToken, stepUp } from '@/server/auth';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, STEPUP_MS } from '@/infra/session';
import { LEGACY_PW, P, authWorld, tokenOf } from './auth-helpers';

const IP = '10.0.0.1';
const L = (w: ReturnType<typeof authWorld>, phone: string, password: string, ip = IP) => login(w.deps, { phone, password }, ip);
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'OK'; } catch (e) { return e instanceof AppError ? e.code : `ERR:${String(e)}`; } };
async function setPw(w: ReturnType<typeof authWorld>, phone: string, pw: string): Promise<void> {
  const { link } = await issueSetPasswordLink(w.deps, phone);
  await setPasswordViaToken(w.deps, { token: tokenOf(link), password: pw }, IP);
}

describe('set-password (token sekali pakai)', () => {
  it('menulis hash scrypt IDENTIK di semua baris milik nomor yang sama + audit; login sesudahnya berhasil', async () => {
    const w = authWorld();
    await setPw(w, '0812-0000-0002', 'Kopi-Manis-47');
    const u = w.users();
    expect(u[1]![8]).toMatch(/^s1\$/); expect(u[1]![8]).toBe(u[2]![8]); expect(u[1]![9]).toBe('s1'); expect(u[2]![9]).toBe('s1');
    expect(u[0]![8]).toBeNull();                                     // orang lain tak tersentuh
    expect(w.audit().map((a) => a.action)).toContain('SET_PASSWORD');
    const r = await L(w, '081200000002', 'Kopi-Manis-47');
    expect(r.roles).toHaveLength(2);
  });
  it('token hanya bisa dipakai sekali', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    await setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, IP);
    expect(await code(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Teh-Pahit-99x' }, IP))).toBe('VALIDATION');
    expect((await L(w, P.budi, 'Kopi-Manis-47')).user.nama).toBe('Budi'); // password pertama yang berlaku
  });
  it('dua pengiriman bersamaan dengan password berbeda: tepat satu menang', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    const t = tokenOf(link);
    const res = await Promise.all([code(setPasswordViaToken(w.deps, { token: t, password: 'Kopi-Manis-47' }, IP)), code(setPasswordViaToken(w.deps, { token: t, password: 'Teh-Pahit-99x' }, IP))]);
    expect(res.filter((x) => x === 'OK')).toHaveLength(1);
  });
  it('password yang melanggar kebijakan ditolak TANPA menghanguskan token', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    expect(await code(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'password123' }, IP))).toBe('VALIDATION');
    expect(await code(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, IP))).toBe('OK');
  });
  it('penulisan ke Sheets gagal -> token dikembalikan, bisa dicoba lagi; tidak ada baris setengah jadi', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.citra);
    w.store.inject({ kind: 'beforeApply' });
    await expect(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, IP)).rejects.toThrow();
    expect(w.users()[1]![8]).toBeNull(); expect(w.users()[2]![8]).toBeNull();
    await setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, IP);
    expect(w.users()[2]![8]).toMatch(/^s1\$/);
  });
  it('token kedaluwarsa (60 mnt) / palsu ditolak', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    w.clock.advance(61 * 60_000);
    expect(await code(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, IP))).toBe('VALIDATION');
    expect(await code(setPasswordViaToken(w.deps, { token: 'x'.repeat(43), password: 'Kopi-Manis-47' }, IP))).toBe('VALIDATION');
  });
  it('akun nonaktif / nomor tak dikenal tidak bisa diberi link; set-password mencabut sesi lama', async () => {
    const w = authWorld();
    expect(await code(issueSetPasswordLink(w.deps, P.eko))).toBe('FORBIDDEN');
    expect(await code(issueSetPasswordLink(w.deps, '089999999999'))).toBe('NOT_FOUND');
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const s = await L(w, P.budi, 'Kopi-Manis-47');
    expect(await getSession(w.deps, s.token)).not.toBeNull();
    await setPw(w, P.budi, 'Teh-Pahit-99x');
    expect(await getSession(w.deps, s.token)).toBeNull();
  });
});

describe('login', () => {
  it('hash lama (SHA-256 3000x) diterima lalu otomatis di-upgrade ke scrypt; login berikutnya memakai scrypt', async () => {
    const w = authWorld();
    const r = await L(w, '081200000003', LEGACY_PW);
    expect(r.roles).toEqual([{ brand: 'ALL', dept: 'ALL', level: 3 }]);
    expect(w.users()[3]![8]).toMatch(/^s1\$/); expect(w.users()[3]![9]).toBe('s1');
    expect(w.audit().map((a) => a.action)).toEqual(expect.arrayContaining(['PASSWORD_REHASH', 'LOGIN']));
    await expect(L(w, '081200000003', LEGACY_PW)).resolves.toBeTruthy();
    expect(await code(L(w, '081200000003', 'salah-total-1'))).toBe('UNAUTHENTICATED');
  });
  it('semua kegagalan: kode & pesan IDENTIK (tidak jadi oracle enumerasi)', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const msgs = new Set<string>();
    for (const [ph, pw] of [[P.budi, 'salah-salah-1'], ['089999999999', 'apa-saja-123'], [P.eko, 'apa-saja-123'], [P.citra, 'apa-saja-123'], ['abc', 'x']] as const) {
      try { await L(w, ph, pw, `1.1.1.${msgs.size}`); } catch (e) { msgs.add(`${(e as AppError).code}|${(e as AppError).message}`); }
    }
    expect([...msgs]).toEqual([`UNAUTHENTICATED|${GENERIC_LOGIN_FAIL}`]);
  });
  it('lockout 5 gagal / 15 mnt per (nomor, IP): percobaan ke-6 ditolak walau password benar; IP lain tidak terkunci; lepas setelah 15 mnt', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    for (let i = 0; i < 5; i++) expect(await code(L(w, P.budi, 'salah-salah-1'))).toBe('UNAUTHENTICATED');
    let e: unknown; try { await L(w, P.budi, 'Kopi-Manis-47'); } catch (x) { e = x; }
    expect(e).toMatchObject({ code: 'RATE_LIMITED' }); expect((e as AppError).retryAfterSec).toBeGreaterThan(0);
    expect(await code(L(w, P.budi, 'Kopi-Manis-47', '10.9.9.9'))).toBe('OK');
    w.clock.advance(15 * 60_000 + 1000);
    expect(await code(L(w, P.budi, 'Kopi-Manis-47'))).toBe('OK');
  });
  it('login sukses mereset hitungan gagal', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    for (let r = 0; r < 3; r++) { for (let i = 0; i < 4; i++) await code(L(w, P.budi, 'salah-salah-1')); expect(await code(L(w, P.budi, 'Kopi-Manis-47'))).toBe('OK'); }
  });
  it('serangan terdistribusi: plafon per nomor (30) menahan walau tiap IP baru', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    for (let i = 0; i < 30; i++) await code(L(w, P.budi, 'salah-salah-1', `20.0.0.${i}`));
    expect(await code(L(w, P.budi, 'Kopi-Manis-47', '30.0.0.1'))).toBe('RATE_LIMITED');
  });
  it('audit kegagalan DIBATASI: 1 per nomor per 15 mnt dan maks 10/menit global (tidak menghabiskan kuota tulis Sheets)', async () => {
    const w = authWorld();
    for (let i = 0; i < 4; i++) await code(L(w, '089999999999', 'x-x-x-x-1', `5.5.5.${i}`));
    expect(w.audit().filter((a) => a.action.startsWith('LOGIN_')).length).toBe(1);
    for (let i = 0; i < 40; i++) await code(L(w, `0877000${String(i).padStart(4, '0')}`, 'x-x-x-x-1', `6.6.6.${i}`));
    expect(w.audit().filter((a) => a.action.startsWith('LOGIN_')).length).toBeLessThanOrEqual(10);
  });
  it('audit sukses wajib: gagal menulis audit -> login gagal & tidak ada sesi', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    w.store.inject({ kind: 'beforeApply', error: new Error('boom') });
    await expect(L(w, P.budi, 'Kopi-Manis-47')).rejects.toMatchObject({ code: 'UPSTREAM_BUSY' });
    expect(w.audit().filter((a) => a.action === 'LOGIN')).toHaveLength(0);
  });
  it('Redis mati -> tidak bisa login (fail-closed)', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    w.redis.down = true;
    await expect(L(w, P.budi, 'Kopi-Manis-47')).rejects.toBeTruthy();
  });
});

describe('sesi', () => {
  it('idle 60 mnt, perpanjang saat dipakai, batas absolut 8 jam, revoke', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const s = await L(w, P.budi, 'Kopi-Manis-47');
    expect((await getSession(w.deps, s.token))?.email).toBe('budi@x.id');
    for (let i = 1; i <= 9; i++) { w.clock.advance(50 * 60_000); expect(await getSession(w.deps, s.token)).not.toBeNull(); } // aktif terus (<60 mnt jeda): hidup sampai 450 mnt
    w.clock.advance(50 * 60_000);                                                                                      // 500 mnt > 8 jam sejak dibuat
    expect(await getSession(w.deps, s.token)).toBeNull();
    const s2 = await L(w, P.budi, 'Kopi-Manis-47');
    w.clock.advance(SESSION_IDLE_MS + 1000); expect(await getSession(w.deps, s2.token)).toBeNull();
    expect(SESSION_ABSOLUTE_MS).toBe(8 * 3_600_000);
  });
  it('logout menghancurkan sesi & menulis audit; token acak/kosong ditolak; revokeAll mematikan semua sesi nomor itu', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const a = await L(w, P.budi, 'Kopi-Manis-47'), b = await L(w, P.budi, 'Kopi-Manis-47');
    await logout(w.deps, a.token);
    expect(await getSession(w.deps, a.token)).toBeNull();
    expect(w.audit().map((x) => x.action)).toContain('LOGOUT');
    expect(await getSession(w.deps, b.token)).not.toBeNull();
    await w.deps.sessions.revokeAll(P.budi);
    expect(await getSession(w.deps, b.token)).toBeNull();
    for (const t of [undefined, '', 'abc', 'x'.repeat(43)]) expect(await getSession(w.deps, t)).toBeNull();
  });
  it('isi Redis tidak memuat token mentah (disimpan sebagai HMAC)', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const s = await L(w, P.budi, 'Kopi-Manis-47');
    expect(w.redis.has(`sess:${s.token}`)).toBe(false);
  });
});

describe('step-up', () => {
  it('password benar -> berlaku 5 menit; salah -> ditolak & terhitung; tanpa step-up requireStepUp menolak', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const s = await L(w, P.budi, 'Kopi-Manis-47');
    const sess = (await getSession(w.deps, s.token))!;
    expect(await code(requireStepUp(w.deps, s.token))).toBe('FORBIDDEN');
    expect(await code(stepUp(w.deps, s.token, sess, { password: 'salah-salah-1' }, IP))).toBe('UNAUTHENTICATED');
    await stepUp(w.deps, s.token, sess, { password: 'Kopi-Manis-47' }, IP);
    await requireStepUp(w.deps, s.token);
    w.clock.advance(STEPUP_MS + 1000);
    expect(await code(requireStepUp(w.deps, s.token))).toBe('FORBIDDEN');
  });
  it('step-up tidak terbawa ke sesi lain; lockout 5 gagal berlaku juga di modal ini', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const a = await L(w, P.budi, 'Kopi-Manis-47'), b = await L(w, P.budi, 'Kopi-Manis-47');
    const sa = (await getSession(w.deps, a.token))!;
    await stepUp(w.deps, a.token, sa, { password: 'Kopi-Manis-47' }, IP);
    expect(await code(requireStepUp(w.deps, b.token))).toBe('FORBIDDEN');
    for (let i = 0; i < 5; i++) await code(stepUp(w.deps, a.token, sa, { password: 'salah-salah-1' }, IP));
    expect(await code(stepUp(w.deps, a.token, sa, { password: 'Kopi-Manis-47' }, IP))).toBe('RATE_LIMITED');
  });
  it('logout menghapus status step-up', async () => {
    const w = authWorld();
    await setPw(w, P.budi, 'Kopi-Manis-47');
    const s = await L(w, P.budi, 'Kopi-Manis-47');
    await stepUp(w.deps, s.token, (await getSession(w.deps, s.token))!, { password: 'Kopi-Manis-47' }, IP);
    await logout(w.deps, s.token);
    expect(await code(requireStepUp(w.deps, s.token))).toBe('FORBIDDEN');
  });
});

describe('lupa password', () => {
  it('nomor tak dikenal / nonaktif: balasan sama (tanpa error) dan TIDAK ada link terkirim; nomor aktif: tepat satu link', async () => {
    const w = authWorld();
    for (const ph of ['089999999999', P.eko, 'abc']) await forgotPassword(w.deps, { phone: ph }, IP);
    expect(w.sender.sent).toHaveLength(0);
    await forgotPassword(w.deps, { phone: '0812 0000 0001' }, IP);
    expect(w.sender.sent).toHaveLength(1);
    expect(w.sender.sent[0]!.phone).toBe(P.budi);
    await setPasswordViaToken(w.deps, { token: tokenOf(w.sender.sent[0]!.link), password: 'Kopi-Manis-47' }, IP);
    await expect(L(w, P.budi, 'Kopi-Manis-47')).resolves.toBeTruthy();
  });
  it('rate-limit: maks 3 permintaan/jam per nomor; pengirim gagal tidak membocorkan apa pun', async () => {
    const w = authWorld();
    for (let i = 0; i < 3; i++) await forgotPassword(w.deps, { phone: P.budi }, `7.7.7.${i}`);
    expect(await code(forgotPassword(w.deps, { phone: P.budi }, '7.7.7.9'))).toBe('RATE_LIMITED');
    const w2 = authWorld();
    w2.deps.sender.sendSetPasswordLink = async () => { throw new Error('WA down'); };
    await expect(forgotPassword(w2.deps, { phone: P.budi }, IP)).resolves.toBeUndefined();
  });
});
