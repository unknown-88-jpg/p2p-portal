// SMOKE lewat handler HTTP sungguhan (login -> cookie sesi -> cek Origin -> step-up -> rute Finance) di atas penyimpanan simulasi.
// Alur COO (2026-11-09): PIC GA mengajukan >= Rp 5 jt -> Manager GA -> COO -> verifikasi pajak -> Fin. Mgr -> CFO -> voucher.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    APP_ENV: 'trial', APP_BASE_URL: 'http://localhost:3000', SHEET_ID: 'sheet-id-1234567', DRIVE_ROOT_ID: 'drive-root', GOOGLE_SA_JSON: 'x'.repeat(60),
    JWT_SECRET: 'j'.repeat(40), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't'.repeat(20), CRON_SECRET: 'c'.repeat(20), HEALTH_TOKEN: 'h'.repeat(20),
    WA_WEBHOOK_SECRET: 'webhook-secret-0123456789',
  });
});
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(() => fn()).catch(() => undefined); } }));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as setPassword } from '@/app/api/auth/set-password/route';
import { POST as stepUp } from '@/app/api/auth/step-up/route';
import { POST as approvePost } from '@/app/api/approvals/[id]/approve/route';
import { GET as queues } from '@/app/api/finance/queues/route';
import { POST as verifPajak } from '@/app/api/finance/[id]/verifikasi-pajak/route';
import { POST as setujuiPost } from '@/app/api/finance/[id]/setujui/route';
import { __setScryptCostForTests } from '@/infra/password';
import { AUDIT_LOG, MASTER_PPH, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { issueSetPasswordLink } from '@/server/auth';
import { etagOf } from '@/server/approval';
import { voucher } from '@/server/dokumen';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { __setAuthDepsForTests } from '@/server/runtime';
import { authWorld, tokenOf } from './auth-helpers';

__setScryptCostForTests(1024);
const ORIGIN = 'http://localhost:3000';
const PW = 'Kopi-Manis-47';
const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const GA = 'GENERAL AFFAIRS';
const NOMOR = { naila: '081200000101', oki: '081200000102', dani: '081200000103', eko: '081200000104', rusli: '081200000105', gita: '081200000106' };
let w: ReturnType<typeof authWorld>;
let n = 0;
const idem = (): string => `idem-smoke-${String(++n).padStart(6, '0')}`;
const row = (id: string) => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;

async function masuk(nomor: string): Promise<string> {
  const { link } = await issueSetPasswordLink(w.deps, nomor.replace(/^0/, '62'));
  const sp = await setPassword(new Request(`${ORIGIN}/api/auth/set-password`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenOf(link), password: PW }) }));
  expect(sp.status).toBe(200);
  const r = await login(new Request(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '10.2.2.2' }, body: JSON.stringify({ phone: nomor, password: PW }) }));
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0]!;
}
const post = (handler: (r: Request) => Promise<Response>, path: string, ck: string, body: unknown, withOrigin = true): Promise<Response> =>
  handler(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { ...(withOrigin ? { origin: ORIGIN } : {}), cookie: ck, 'content-type': 'application/json', 'idempotency-key': idem() }, body: JSON.stringify(body) }));
const naikStepUp = async (ck: string): Promise<void> => { expect((await post(stepUp, '/api/auth/step-up', ck, { password: PW })).status).toBe(200); };
const antrean = async (ck: string) => (await (await queues(new Request(`${ORIGIN}/api/finance/queues`, { headers: { cookie: ck } }))).json()) as { items: { id: string; tahap: string; perluCOO: boolean; persetujuan?: { coo: string | null } }[]; peran: Record<string, boolean> };

beforeEach(() => {
  w = authWorld(); __setAuthDepsForTests(w.deps);
  w.store.seed(MASTER_USER_TTD, [
    ['BRAND A', GA, 1, 'GA Staff', 'Naila', 'naila@x.id', 'YES', NOMOR.naila, null, null], ['BRAND A', GA, 2, 'GA Manager', 'Oki', 'oki@x.id', 'YES', NOMOR.oki, null, null],
    ['ALL', 'ALL', 3, 'Fin Staff', 'Dani', 'dani@x.id', 'YES', NOMOR.dani, null, null], ['ALL', 'ALL', 4, 'FAT Manager', 'Eko', 'eko@x.id', 'YES', NOMOR.eko, null, null],
    ['ALL', 'ALL', 6, 'Chief Operation Officer', 'Rusli', 'rusli@x.id', 'YES', NOMOR.rusli, null, null], ['ALL', 'ALL', 5, 'CFO', 'Gita', 'gita@x.id', 'YES', NOMOR.gita, null, null],
  ]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []); w.store.seed(AUDIT_LOG, []);
});

async function ajukan(amount: number, inv: string): Promise<string> {
  const s = { phone: NOMOR.naila.replace(/^0/, '62'), email: 'naila@x.id', nama: 'Naila', jabatan: 'GA Staff', created: 0, ep: 0, roles: [{ brand: 'BRAND A', dept: GA, level: 1 }] };
  const r = await createDraft(w.deps, s, { tipe: 'Non-Trade', brand: 'BRAND A', departement: GA, description: 'Smoke', vendorKode: 'V3', noInvoice: inv, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === r.id) x[C('FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return x; }));
  await submitPengajuan(w.deps, s, r.id, `idem-ajukan-${inv}-01`, true);
  return r.id;
}

describe('SMOKE HTTP: alur COO dokumen GA >= Rp 5 jt', () => {
  it('Manager -> COO -> pajak -> Fin. Mgr -> CFO -> Wet Signed, voucher memuat COO; semua lewat handler sungguhan', async () => {
    const id = await ajukan(6_000_000, 'GA-SMOKE-1');
    expect(row(id)[C('REQUIRE_COO')]).toBe('YES');
    const [ckOki, ckDani, ckEko, ckRusli, ckGita] = [await masuk(NOMOR.oki), await masuk(NOMOR.dani), await masuk(NOMOR.eko), await masuk(NOMOR.rusli), await masuk(NOMOR.gita)];

    // Manager GA (>= 5 jt: wajib step-up)
    expect((await post(approvePost, `/api/approvals/${id}/approve`, ckOki, { etag: etagOf(row(id)) })).status).toBe(403);
    await naikStepUp(ckOki);
    expect((await post(approvePost, `/api/approvals/${id}/approve`, ckOki, { etag: etagOf(row(id)) })).status).toBe(200);
    expect(row(id)[C('STATUS')]).toBe('Manager Approved');

    // Antrean: Finance Staff melihat dokumen menunggu COO; COO melihat dokumen yang menunggunya
    const qs = await antrean(ckDani);
    expect(qs.items.find((i) => i.id === id)).toMatchObject({ tahap: 'pajak', perluCOO: true, persetujuan: { coo: null } });
    const qc = await antrean(ckRusli);
    expect(qc.peran).toMatchObject({ coo: true, staff: false });
    expect(qc.items.find((i) => i.id === id)).toBeTruthy();

    // Verifikasi pajak ditahan sampai COO setuju
    await naikStepUp(ckDani);
    const body = () => ({ etag: etagOf(row(id)), invAmount: 6_000_000, statusPPN: 'Non PPN', jenisPPh: '-' });
    const ditahan = await post(verifPajak, `/api/finance/${id}/verifikasi-pajak`, ckDani, body());
    expect(ditahan.status).toBe(422);
    expect(JSON.stringify(await ditahan.json())).toMatch(/COO/);

    // COO: tanpa step-up ditolak, Fin. Mgr tidak boleh bertindak sebagai COO, lalu COO setuju
    expect((await post(setujuiPost, `/api/finance/${id}/setujui`, ckRusli, { etag: etagOf(row(id)), sebagai: 'coo' })).status).toBe(403);
    await naikStepUp(ckEko);
    expect((await post(setujuiPost, `/api/finance/${id}/setujui`, ckEko, { etag: etagOf(row(id)), sebagai: 'coo' })).status).toBe(403);
    await naikStepUp(ckRusli);
    const coo = await post(setujuiPost, `/api/finance/${id}/setujui`, ckRusli, { etag: etagOf(row(id)), sebagai: 'coo' });
    expect(coo.status).toBe(200);
    expect(row(id)[C('STATUS')]).toBe('Manager Approved');

    // Pajak terbuka -> Fin. Mgr -> CFO
    expect((await post(verifPajak, `/api/finance/${id}/verifikasi-pajak`, ckDani, body())).status).toBe(200);
    expect(row(id)[C('STATUS')]).toBe('Tax Verified');
    expect((await post(setujuiPost, `/api/finance/${id}/setujui`, ckEko, { etag: etagOf(row(id)), sebagai: 'finmgr' })).status).toBe(200);
    await naikStepUp(ckGita);
    expect((await post(setujuiPost, `/api/finance/${id}/setujui`, ckGita, { etag: etagOf(row(id)), sebagai: 'cfo' })).status).toBe(200);
    expect(row(id)[C('STATUS')]).toBe('Wet Signed');

    // Voucher memuat kotak TTD COO yang sudah E-Signed, di antara Manager dan verifikator pajak
    const v = await voucher(w.deps, { phone: NOMOR.gita.replace(/^0/, '62'), email: 'gita@x.id', nama: 'Gita', jabatan: 'CFO', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level: 5 }] }, id);
    expect(v.ttd.map((x) => x.level)).toEqual([1, 2, 6, 3, 4, 5]);
    expect(v.ttd.find((x) => x.level === 6)).toMatchObject({ nama: 'Rusli', isSigned: true, label: 'E-Signed' });
  });

  it('cek Origin (CSRF) tetap berlaku untuk e-approve COO; dokumen GA < Rp 5 jt tidak meminta COO', async () => {
    const id = await ajukan(6_000_000, 'GA-SMOKE-2');
    const ckRusli = await masuk(NOMOR.rusli);
    await naikStepUp(ckRusli);
    expect((await post(setujuiPost, `/api/finance/${id}/setujui`, ckRusli, { etag: etagOf(row(id)), sebagai: 'coo' }, false)).status).toBeGreaterThanOrEqual(400);
    expect(w.store.rowsOf(TRX_APPROVAL).some((r) => r[colIndex(TRX_APPROVAL, 'Level')] === 6)).toBe(false);
    const kecil = await ajukan(1_000_000, 'GA-SMOKE-3');
    expect(row(kecil)[C('REQUIRE_COO')]).toBe('NO');
  });
});
