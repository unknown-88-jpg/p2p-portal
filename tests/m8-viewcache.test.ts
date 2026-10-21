import { beforeEach, describe, expect, it } from 'vitest';
import { MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { inbox } from '@/server/approval';
import { cari, dashboard, detail } from '@/server/dokumen';
import { createDraft, listMine, submitPengajuan } from '@/server/pengajuan';
import { bacaTampilan, VIEW_STALE_MAX_MS, VIEW_TTL_MS } from '@/server/view-cache';
import { authWorld, USERS } from './auth-helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const sess = (o: Partial<SessionData> & Pick<SessionData, 'email' | 'nama' | 'roles'>): SessionData => ({ phone: '6280000000000', jabatan: 'X', created: 0, ep: 0, ...o });
const citra = sess({ email: 'citra@x.id', nama: 'Citra', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
const budi = sess({ email: 'budi@x.id', nama: 'Budi', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });

let w: ReturnType<typeof authWorld>;
let n = 0;
async function buat(): Promise<string> {
  const r = await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: `INV-${++n}`, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN' });
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === r.id) x[C('FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return x; }));
  return r.id;
}
const fakeClock = () => w.clock as unknown as { advance(ms: number): void };

beforeEach(() => {
  w = authWorld(0);
  w.store.seed(MASTER_USER_TTD, [...USERS,
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Budi', 'budi@x.id', 'YES', '081200000001', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Fajar', 'fajar@x.id', 'YES', '081200000009', null, null]]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', 'BCA', 'PT Gama', '1234567890', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('M8 — cache baca tampilan', () => {
  it('beranda Manager (dashboard + listMine + inbox) = 1 baca Trx_Pengajuan, bukan 3', async () => {
    await buat();
    const r0 = w.store.reads;
    await Promise.all([dashboard(w.deps, budi), listMine(w.deps, budi), inbox(w.deps, budi)]);
    expect(w.store.reads - r0).toBe(1);
    const r1 = w.store.reads;
    await Promise.all([dashboard(w.deps, budi), listMine(w.deps, budi), inbox(w.deps, budi), cari(w.deps, budi, 'kertas')]);
    expect(w.store.reads - r1).toBe(0); // masih segar
  });
  it('detail dua kali berturut-turut: pembacaan kedua tidak menyentuh Sheets (selain verifikasi indeks baris)', async () => {
    const id = await buat();
    await detail(w.deps, citra, id);
    const r = w.store.reads;
    await detail(w.deps, citra, id);
    expect(w.store.reads - r).toBeLessThanOrEqual(1);
  });
  it('single-flight: 10 pemanggil paralel pada cache dingin = 1 baca', async () => {
    const r = w.store.reads;
    await Promise.all(Array.from({ length: 10 }, () => bacaTampilan(w.deps, TRX_PENGAJUAN)));
    expect(w.store.reads - r).toBe(1);
  });
  it('tulis menaikkan versi: status baru langsung terlihat (tanpa menunggu TTL)', async () => {
    const id = await buat();
    expect((await listMine(w.deps, citra))[0]!.status).toBe('Draft');
    await submitPengajuan(w.deps, citra, id, 'idem-m8-000001', true);
    expect((await listMine(w.deps, citra))[0]!.status).toBe('Submitted');
    expect((await inbox(w.deps, budi)).map((x) => x.id)).toEqual([id]);
  });
  it('perubahan di luar aplikasi baru terlihat setelah TTL (batas kesegaran terdokumentasi)', async () => {
    const id = await buat();
    await listMine(w.deps, citra);
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === id) x[C('DESCRIPTION')] = 'Diubah manual'; return x; }));
    expect((await listMine(w.deps, citra))[0]!.description).toBe('Beli kertas');
    fakeClock().advance(VIEW_TTL_MS + 1);
    expect((await listMine(w.deps, citra))[0]!.description).toBe('Diubah manual');
  });
  it('Redis mati: cache dilewati (baca segar), tidak error', async () => {
    await buat();
    w.redis.down = true;
    const r = w.store.reads;
    await bacaTampilan(w.deps, TRX_PENGAJUAN); await bacaTampilan(w.deps, TRX_PENGAJUAN);
    expect(w.store.reads - r).toBe(2);
  });
  it('stale-if-error: Google gagal, salinan < 5 mnt dipakai; lebih tua = error', async () => {
    await buat();
    await bacaTampilan(w.deps, TRX_PENGAJUAN);
    const asli = w.store.readRows.bind(w.store);
    w.store.readRows = (async () => { throw new Error('429'); }) as typeof w.store.readRows;
    fakeClock().advance(VIEW_TTL_MS + 1);
    expect(await bacaTampilan(w.deps, TRX_PENGAJUAN)).toHaveLength(1);
    fakeClock().advance(VIEW_STALE_MAX_MS);
    await expect(bacaTampilan(w.deps, TRX_PENGAJUAN)).rejects.toThrow('429');
    w.store.readRows = asli;
  });
  it('cache terpisah per store (tak bocor antar dunia/uji)', async () => {
    await buat();
    await bacaTampilan(w.deps, TRX_PENGAJUAN);
    const w2 = authWorld(0);
    w2.store.seed(TRX_PENGAJUAN, []);
    expect(await bacaTampilan(w2.deps, TRX_PENGAJUAN)).toHaveLength(0);
  });
});
