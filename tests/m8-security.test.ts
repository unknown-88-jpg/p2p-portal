import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { readCookie } from '@/app/api/_lib/handler';
import { AppError } from '@/lib/errors';
import { MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { cari } from '@/server/dokumen';
import { bukaLampiran } from '@/server/lampiran';
import { createDraft } from '@/server/pengajuan';
import { authWorld, USERS } from './auth-helpers';

const API = join(__dirname, '..', 'src', 'app', 'api');
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []; });
}
const files = routes(API).map((p) => ({ rel: relative(API, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

describe('M8 — inventaris route (pagar otomatis: route baru wajib lolos aturan ini)', () => {
  it('ada route yang ditemukan (jaga-jaga glob salah)', () => { expect(files.length).toBeGreaterThan(25); });

  it('semua route memakai pembungkus route() KECUALI health & webhook WA (punya autentikasi sendiri)', () => {
    const luar = files.filter((f) => !/\broute\(\s*\{/.test(f.src)).map((f) => f.rel).sort();
    expect(luar).toEqual(['health/route.ts', 'webhooks/wa/route.ts']);
  });

  it('session:"none" hanya untuk auth publik & cron; tiap cron memanggil bearerOk', () => {
    const none = files.filter((f) => /session:\s*'none'/.test(f.src)).map((f) => f.rel).sort();
    // Patch 2 (F-12): 'auth/set-password/cek' ditambahkan SENGAJA: hanya mengintip validitas link (benar/salah), tanpa data akun, dengan pembatas sendiri.
    expect(none).toEqual(['auth/forgot/route.ts', 'auth/login/route.ts', 'auth/logout/route.ts', 'auth/set-password/cek/route.ts', 'auth/set-password/route.ts', 'cron/backup/route.ts', 'cron/digest/route.ts', 'cron/lampiran-yatim/route.ts']);
    for (const f of files.filter((x) => x.rel.startsWith('cron/'))) expect(f.src).toContain('bearerOk(req)');
  });

  it('health memeriksa token, webhook memeriksa tanda tangan sebelum apa pun', () => {
    expect(files.find((f) => f.rel === 'health/route.ts')!.src).toContain('tokenOk(');
    const wa = files.find((f) => f.rel === 'webhooks/wa/route.ts')!.src;
    expect(wa).toContain('signatureWebhookValid');
    expect(wa.indexOf('signatureWebhookValid')).toBeLessThan(wa.indexOf('JSON.parse'));
  });

  it('tidak ada route yang membuka method selain GET/POST (mis. PUT/DELETE) tanpa CSRF', () => {
    for (const f of files) expect(f.src).not.toMatch(/export (const|async function) (PUT|PATCH|DELETE)\b/);
  });

  it('semua route mutasi (POST) lewat route() sehingga kena cek Origin', () => {
    for (const f of files.filter((x) => /export (const|async function) POST\b/.test(x.src) && !['webhooks/wa/route.ts'].includes(x.rel))) {
      expect(f.src, f.rel).toMatch(/method:\s*'POST'/);
    }
  });
});

describe('M8 — header & cookie', () => {
  const res = () => proxy(new NextRequest('http://localhost:3000/'));
  it('header isolasi & dasar terpasang', () => {
    const h = res().headers;
    expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(h.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('no-referrer');
    expect(h.get('strict-transport-security')).toContain('max-age=');
  });
  it('nonce CSP unik per respons', () => {
    const n = (): string => /nonce-([^']+)/.exec(res().headers.get('content-security-policy')!)![1]!;
    expect(n()).not.toBe(n());
  });
  it('cookie berisi % rusak = tidak ada sesi (bukan crash)', () => {
    const req = new Request('http://x/', { headers: { cookie: 'p2p_session=%E0%A4%A' } });
    expect(readCookie(req, 'p2p_session')).toBeUndefined();
    expect(readCookie(new Request('http://x/', { headers: { cookie: 'a=1; p2p_session=abc' } }), 'p2p_session')).toBe('abc');
  });
});

describe('M8 — pembatas pencarian & header lampiran', () => {
  const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
  const citra = { phone: '6281200000002', email: 'citra@x.id', nama: 'Citra', jabatan: 'PIC', created: 0, ep: 0, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] };
  function dunia() {
    const w = authWorld(0);
    w.store.seed(MASTER_USER_TTD, [...USERS, ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null], ['BRAND A', 'DEPT X', 2, 'Manager', 'Budi', 'budi@x.id', 'YES', '081200000001', null, null]]);
    w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
    w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', 'BCA', 'PT Gama', '1234567890', 'Approved']]);
    w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
    return w;
  }
  it('pencarian ke-41 dalam semenit = RATE_LIMITED; menit berikutnya normal', async () => {
    const w = dunia();
    for (let i = 0; i < 40; i++) await cari(w.deps, citra, 'kertas');
    await expect(cari(w.deps, citra, 'kertas')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    (w.clock as unknown as { advance(ms: number): void }).advance(61_000);
    await expect(cari(w.deps, citra, 'kertas')).resolves.toEqual([]);
  });
  it('lampiran gambar disajikan dengan CSP sandbox + nosniff; PDF tetap inline tanpa sandbox', async () => {
    const w = dunia();
    const r = await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'x', vendorKode: 'V3', noInvoice: 'INV-1', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN' });
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { x[C('FILE_URL')] = 'https://drive.google.com/file/d/FILEIMG123456/view'; return x; }));
    w.drive.put({ id: 'FILEIMG123456', name: 'a.png', mimeType: 'image/png' }, new Uint8Array([1, 2, 3]));
    const img = await bukaLampiran(w.deps, citra, r.id);
    expect(img.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    w.drive.put({ id: 'FILEIMG123456', name: 'a.pdf', mimeType: 'application/pdf' }, new Uint8Array([1, 2, 3]));
    expect((await bukaLampiran(w.deps, citra, r.id)).headers.get('content-security-policy')).toBeNull();
    expect(AppError).toBeDefined();
  });
});
