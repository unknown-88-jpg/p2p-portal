import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';
import { checkSheetAllowed } from '@/lib/trial-guard';
import { AppError, errorBody } from '@/lib/errors';

const base = {
  APP_ENV: 'trial', APP_BASE_URL: 'https://x.vercel.app', SHEET_ID: 'abcdefghij1234', DRIVE_ROOT_ID: 'drive12345',
  GOOGLE_SA_JSON: '{"client_email":"a@b","private_key":"-----BEGIN PRIVATE KEY-----xxxxxxxxxxxxxxxxxxxxxx"}',
  JWT_SECRET: 'x'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://r.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tokentokentoken',
  CRON_SECRET: 'c'.repeat(16), HEALTH_TOKEN: 'h'.repeat(16),
};

describe('env', () => {
  it('baris kosong pada variabel opsional = tidak diisi (bukan gagal validasi)', () => {
    const e = parseEnv({ ...base, WA_GATEWAY_URL: '', WA_WEBHOOK_SECRET: '  ', WA_API_KEY: '' });
    expect(e.WA_GATEWAY_URL).toBeUndefined(); expect(e.WA_WEBHOOK_SECRET).toBeUndefined();
  });
  it('baris kosong pada variabel WAJIB tetap gagal dan menyebut nama variabelnya', () => {
    expect(() => parseEnv({ ...base, DRIVE_ROOT_ID: '' })).toThrow(/DRIVE_ROOT_ID/);
  });
  it('valid', () => expect(parseEnv(base).APP_ENV).toBe('trial'));
  it('rahasia kurang -> gagal tanpa membocorkan nilai', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'pendek' })).toThrow(/JWT_SECRET/);
    try { parseEnv({ ...base, JWT_SECRET: 'rahasia-pendek' }); } catch (e) { expect(String(e)).not.toContain('rahasia-pendek'); }
  });
});

describe('D6 trial guard', () => {
  const ok = { appEnv: 'trial' as const, sheetId: 'S1', title: 'P2P DUMMY copy', prodSheetIds: 'PROD1, PROD2' };
  it('DUMMY lolos', () => expect(checkSheetAllowed(ok)).toBeNull());
  it('tanpa DUMMY ditolak', () => expect(checkSheetAllowed({ ...ok, title: 'P2P Finance' })).toMatch(/DUMMY/));
  it('ID produksi ditolak walau judul DUMMY', () => expect(checkSheetAllowed({ ...ok, sheetId: 'PROD2' })).toMatch(/PRODUKSI/));
  it('production tidak dibatasi guard ini', () => expect(checkSheetAllowed({ ...ok, appEnv: 'production', title: 'x' })).toBeNull());
});

describe('format error', () => {
  it('AppError -> status & kode', () => {
    const r = errorBody(new AppError('CONFLICT', 'sudah diproses'), 'rid');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: { code: 'CONFLICT', requestId: 'rid' } });
  });
  it('error tak dikenal tidak bocor', () => {
    const r = errorBody(new Error('secret db password=abc'), 'rid');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('abc');
  });
  it('retry-after untuk UPSTREAM_BUSY', () => {
    expect(errorBody(new AppError('UPSTREAM_BUSY', 'x', undefined, 3), 'r').headers['retry-after']).toBe('3');
  });
});
