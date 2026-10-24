import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'trial', APP_BASE_URL: 'http://localhost:3000', SHEET_ID: 'sheet-id-1234567', DRIVE_ROOT_ID: 'drive-root', GOOGLE_SA_JSON: 'x'.repeat(60),
    JWT_SECRET: 'j'.repeat(40), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't'.repeat(20), CRON_SECRET: 'c'.repeat(20), HEALTH_TOKEN: 'h'.repeat(20),
  });
});
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));

import { POST as cekRoute } from '@/app/api/auth/set-password/cek/route';
import { POST as setPasswordRoute } from '@/app/api/auth/set-password/route';
import { parsePerintah } from '@/domain/wa';
import { durasiTunggu } from '@/infra/throttle';
import { __setScryptCostForTests } from '@/infra/password';
import { AppError } from '@/lib/errors';
import { cekLinkSetPassword, issueSetPasswordLink, login, setPasswordViaToken } from '@/server/auth';
import { __setAuthDepsForTests } from '@/server/runtime';
import { P, authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const post = (path: string, body: unknown, o: { origin?: string | null } = {}): Request => {
  const h: Record<string, string> = { 'x-real-ip': '10.3.3.3', 'content-type': 'application/json' };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
};
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'OK'; } catch (e) { return e instanceof AppError ? e.code : `ERR:${String(e)}`; } };

describe('F-11: pesan kunci menyebut durasi', () => {
  it('durasiTunggu: detik bila < 1 menit, selain itu "±N menit" dibulatkan ke atas', () => {
    expect(durasiTunggu(1)).toBe('1 detik'); expect(durasiTunggu(45)).toBe('45 detik');
    expect(durasiTunggu(60)).toBe('±1 menit'); expect(durasiTunggu(61)).toBe('±2 menit'); expect(durasiTunggu(15 * 60)).toBe('±15 menit');
  });
  it('login terkunci setelah 5 gagal: pesan memuat durasi dan header Retry-After tetap ada', async () => {
    const w = authWorld();
    for (let i = 0; i < 5; i++) await code(login(w.deps, { phone: P.dani, password: 'salah-salah' }, '10.9.9.9'));
    let err: unknown;
    try { await login(w.deps, { phone: P.dani, password: 'salah-salah' }, '10.9.9.9'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AppError);
    const e = err as AppError;
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toMatch(/^Terlalu banyak percobaan\. Coba lagi dalam (±\d+ menit|\d+ detik)\.$/);
    expect(e.retryAfterSec).toBeGreaterThan(0);
    w.clock.advance(5 * 60_000);
    let e2: AppError | undefined;
    try { await login(w.deps, { phone: P.dani, password: 'salah-salah' }, '10.9.9.9'); } catch (x) { e2 = x as AppError; }
    expect(e2?.message).toMatch(/±(9|10) menit/);      // sisa ± 10 menit dari jendela 15 menit
  });
});

describe('F-12: cek link set-password saat halaman dibuka', () => {
  it('link valid -> {valid:true}; token TIDAK hangus, password tetap bisa diatur sesudahnya; nomor tidak bocor', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    const t = tokenOf(link);
    const r1 = await cekLinkSetPassword(w.deps, { token: t }, '10.0.0.1');
    const r2 = await cekLinkSetPassword(w.deps, { token: t }, '10.0.0.1');
    expect(r1).toEqual({ valid: true }); expect(r2).toEqual({ valid: true });
    expect(JSON.stringify(r1)).not.toMatch(/62812|budi/i);
    await setPasswordViaToken(w.deps, { token: t, password: 'Kopi-Manis-47' }, '10.0.0.1');   // masih bisa dipakai
    expect(await cekLinkSetPassword(w.deps, { token: t }, '10.0.0.1')).toEqual({ valid: false }); // sesudah dipakai -> mati
  });
  it('link kedaluwarsa (60 mnt) / palsu / sudah dipakai -> {valid:false}', async () => {
    const w = authWorld();
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    w.clock.advance(61 * 60_000);
    expect(await cekLinkSetPassword(w.deps, { token: tokenOf(link) }, '10.0.0.2')).toEqual({ valid: false });
    expect(await cekLinkSetPassword(w.deps, { token: 'x'.repeat(43) }, '10.0.0.2')).toEqual({ valid: false });
  });
  it('tidak bisa dipakai menebak token: 20 kegagalan per IP / 15 mnt lalu 429; IP lain tidak terdampak', async () => {
    const w = authWorld();
    for (let i = 0; i < 20; i++) expect(await cekLinkSetPassword(w.deps, { token: `${'y'.repeat(30)}${String(i).padStart(2, '0')}` }, '10.0.0.3')).toEqual({ valid: false });
    expect(await code(cekLinkSetPassword(w.deps, { token: 'z'.repeat(43) }, '10.0.0.3'))).toBe('RATE_LIMITED');
    expect(await cekLinkSetPassword(w.deps, { token: 'z'.repeat(43) }, '10.0.0.4')).toEqual({ valid: false }); // IP lain tidak terdampak
    w.clock.advance(16 * 60_000);
    expect(await cekLinkSetPassword(w.deps, { token: 'z'.repeat(43) }, '10.0.0.3')).toEqual({ valid: false });  // jendela lewat -> terbuka lagi
  });
  it('pembatas pemeriksaan TERPISAH dari pengiriman password: banyak link kedaluwarsa dibuka tidak mengunci set-password siapa pun', async () => {
    const w = authWorld();
    for (let i = 0; i < 20; i++) await cekLinkSetPassword(w.deps, { token: `${'q'.repeat(30)}${String(i).padStart(2, '0')}` }, '10.0.0.5');
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    await setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, '10.0.0.6');            // pengiriman normal tetap jalan
    const { link: l2 } = await issueSetPasswordLink(w.deps, P.citra);
    await setPasswordViaToken(w.deps, { token: tokenOf(l2), password: 'Teh-Pahit-99x' }, '10.0.0.5');              // bahkan dari IP yang kena batas cek
  });
  it('route: tanpa sesi tetap boleh; origin salah ditolak (CSRF); token terlalu pendek -> 400', async () => {
    const w = authWorld(); __setAuthDepsForTests(w.deps);
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    const ok = await cekRoute(post('/api/auth/set-password/cek', { token: tokenOf(link) }));
    expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ valid: true });
    expect((await cekRoute(post('/api/auth/set-password/cek', { token: tokenOf(link) }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await cekRoute(post('/api/auth/set-password/cek', { token: 'pendek' }))).status).toBe(400);
    const sp = await setPasswordRoute(post('/api/auth/set-password', { token: tokenOf(link), password: 'Kopi-Manis-47' }));
    expect(sp.status).toBe(200);                       // token tetap utuh sesudah dicek 1x
  });
});

describe('F-14: parser WA mengabaikan penanda format', () => {
  it('teks tebal/miring/coret hasil salin dari balasan bot tetap dikenali', () => {
    expect(parsePerintah('*SETUJU 2641*')).toEqual({ jenis: 'SETUJU', kode: '2641' });
    expect(parsePerintah('*SETUJU* *2641*')).toEqual({ jenis: 'SETUJU', kode: '2641' });
    expect(parsePerintah('_setuju 2641_')).toEqual({ jenis: 'SETUJU', kode: '2641' });
    expect(parsePerintah('~SETUJU 2641~')).toEqual({ jenis: 'SETUJU', kode: '2641' });
    expect(parsePerintah('  *approve 2641*  ')).toEqual({ jenis: 'SETUJU', kode: '2641' });
  });
  it('TOLAK: penanda di awal/akhir dibuang, isi alasan (termasuk _ di dalamnya) tetap', () => {
    expect(parsePerintah('*TOLAK 2641 harga tidak sesuai*')).toEqual({ jenis: 'TOLAK', kode: '2641', alasan: 'harga tidak sesuai' });
    expect(parsePerintah('*TOLAK* *2641* lampiran buram')).toEqual({ jenis: 'TOLAK', kode: '2641', alasan: 'lampiran buram' });
    expect(parsePerintah('TOLAK 2641 no_po salah')).toEqual({ jenis: 'TOLAK', kode: '2641', alasan: 'no_po salah' });
    expect(parsePerintah('*TOLAK 2641*')).toEqual({ jenis: 'TOLAK_TANPA_ALASAN', kode: '2641' });
  });
  it('tidak melonggarkan hal lain: kode harus tepat 4 digit, perintah harus di awal, tidak ada perintah tersembunyi', () => {
    expect(parsePerintah('*SETUJU 26411*')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('*SETUJU 264*')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('tolong *SETUJU 2641*')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('*SETUJU2641*')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('**')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('*123456*')).toEqual({ jenis: 'TIDAK_DIKENAL' });
  });
});

beforeEach(() => { __setAuthDepsForTests(authWorld().deps); });

describe('setpass: pembatas per IP, bukan global (temuan STATUS 2026-10-24)', () => {
  const bad = (i: number) => ({ token: `${'k'.repeat(30)}${String(i).padStart(3, '0')}`, password: 'Kopi-Manis-47' });
  it('10 link tak valid dari satu IP mengunci IP itu saja; orang lain (IP lain) tetap bisa menyimpan password', async () => {
    const w = authWorld();
    for (let i = 0; i < 10; i++) expect(await code(setPasswordViaToken(w.deps, bad(i), '10.9.0.1'))).toBe('VALIDATION');
    expect(await code(setPasswordViaToken(w.deps, bad(99), '10.9.0.1'))).toBe('RATE_LIMITED');
    const { link } = await issueSetPasswordLink(w.deps, P.budi);
    expect(await code(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Kopi-Manis-47' }, '10.9.0.2'))).toBe('OK');
  });
  it('serangan terdistribusi: banyak IP x 9 kegagalan tetap tidak mengunci pengguna sah sampai plafon global longgar tercapai', async () => {
    const w = authWorld();
    for (let ip = 0; ip < 20; ip++) for (let i = 0; i < 9; i++) await code(setPasswordViaToken(w.deps, bad(ip * 10 + i), `10.8.${ip}.1`)); // 180 gagal
    const { link } = await issueSetPasswordLink(w.deps, P.citra);
    expect(await code(setPasswordViaToken(w.deps, { token: tokenOf(link), password: 'Teh-Pahit-99x' }, '10.7.0.1'))).toBe('OK');
  });
});
