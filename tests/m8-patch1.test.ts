// M8 patch 1: F-01 teks catatan, F-05 antrean/hitungan tanpa dokumen sendiri, F-06 hitungan divisi hanya yang diajukan, F-09 cache daftar vendor.
import { beforeEach, describe, expect, it } from 'vitest';
import { catatanTampil, milikSendiri, PREFIX_TOLAK, PREFIX_TOLAK_WA } from '@/domain/approval';
import { MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { inbox } from '@/server/approval';
import { dashboard } from '@/server/dokumen';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { authWorld, USERS } from './auth-helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const sess = (o: Partial<SessionData> & Pick<SessionData, 'email' | 'nama' | 'roles'>): SessionData => ({ phone: '6280000000000', jabatan: 'X', created: 0, ep: 0, ...o });
const citra = sess({ email: 'citra@x.id', nama: 'Citra', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
const budi = sess({ email: 'budi@x.id', nama: 'Budi', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
// Budi juga membuat dokumen (PIC + Manager), seperti Dummy 002/003 di UAT.
const budiPic = sess({ email: 'budi@x.id', nama: 'Budi', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });

let w: ReturnType<typeof authWorld>;
let n = 0;
async function buat(by: SessionData, ajukan: boolean): Promise<string> {
  const r = await createDraft(w.deps, by, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: `INV-${++n}`, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN' });
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === r.id) x[C('FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return x; }));
  if (ajukan) await submitPengajuan(w.deps, by, r.id, `idem-p1-${String(n).padStart(8, '0')}`, true);
  return r.id;
}

beforeEach(() => {
  w = authWorld(0);
  w.store.seed(MASTER_USER_TTD, [...USERS,
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Budi', 'budi@x.id', 'YES', '081200000001', null, null],
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Budi', 'budi@x.id', 'YES', '081200000001', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Fajar', 'fajar@x.id', 'YES', '081200000009', null, null]]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', 'BCA', 'PT Gama', '1234567890', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('F-01 catatanTampil', () => {
  it('awalan teknis dibuang, alasan dipertahankan; teks lain tak berubah', () => {
    expect(catatanTampil(`${PREFIX_TOLAK}Nominal salah`)).toBe('Dikembalikan Manager: Nominal salah');
    expect(catatanTampil(`${PREFIX_TOLAK_WA}Nominal salah`)).toBe('Dikembalikan Manager (via WA): Nominal salah');
    expect(catatanTampil('Lengkapi NPWP')).toBe('Lengkapi NPWP');
    expect(catatanTampil(`${PREFIX_TOLAK}x`)).not.toContain('[');
  });
});

describe('F-05 milikSendiri & antrean', () => {
  it('milikSendiri: beda huruf/spasi sama; kosong tidak pernah cocok', () => {
    expect(milikSendiri(' Budi@X.id ', 'budi@x.id')).toBe(true);
    expect(milikSendiri('', '')).toBe(false);
    expect(milikSendiri('a@x.id', 'b@x.id')).toBe(false);
  });
  it('dokumen buatan Manager sendiri tak muncul di inbox & antrean dashboard; dokumen orang lain tetap', async () => {
    const milikBudi = await buat(budiPic, true);
    const milikCitra = await buat(citra, true);
    expect((await inbox(w.deps, budi)).map((i) => i.id)).toEqual([milikCitra]);
    expect((await dashboard(w.deps, budi)).manager).toMatchObject({ antrean: 1 });
    expect((await inbox(w.deps, sess({ email: 'fajar@x.id', nama: 'Fajar', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] }))).map((i) => i.id)).toEqual([milikCitra, milikBudi]); // terbaru dulu
  });
});

describe('F-06 hitungan divisi bulan ini = hanya yang diajukan', () => {
  it('Draft & Revision Needed tidak dihitung; Submitted dihitung', async () => {
    await buat(citra, false); // Draft
    const rev = await buat(citra, true);
    w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === rev) x[C('STATUS')] = 'Revision Needed'; return x; }));
    await buat(citra, true); // Submitted
    const dm = (await dashboard(w.deps, budi)).manager!;
    expect(dm.divisi).toEqual([{ nama: 'BRAND A / DEPT X', jumlah: 1, nominal: 1_000_000 }]);
  });
});
