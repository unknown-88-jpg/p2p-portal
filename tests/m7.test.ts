import { beforeEach, describe, expect, it } from 'vitest';
import { bangunKotakTTD, bersihkanCatatan, cocokCari, maskRekening, petaPersetujuan, posisiAlur, susunTimeline, umurHari } from '@/domain/dokumen';
import { AppError } from '@/lib/errors';
import { fmtTanggal, fmtWaktu } from '@/lib/time';
import { MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { approve, etagOf } from '@/server/approval';
import { cari, dashboard, detail, voucher } from '@/server/dokumen';
import { bukaLampiran } from '@/server/lampiran';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { authWorld, USERS } from './auth-helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const sess = (o: Partial<SessionData> & Pick<SessionData, 'email' | 'nama' | 'roles'>): SessionData => ({ phone: '6280000000000', jabatan: 'X', created: 0, ep: 0, ...o });
const citra = sess({ email: 'citra@x.id', nama: 'Citra', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
const budi = sess({ email: 'budi@x.id', nama: 'Budi', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
const mgrB = sess({ email: 'bb@x.id', nama: 'Bunga', roles: [{ brand: 'BRAND B', dept: 'DEPT Y', level: 2 }] });
const picLain = sess({ email: 'lain@x.id', nama: 'Lain', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
const finance = sess({ email: 'dani@x.id', nama: 'Dani', roles: [{ brand: 'ALL', dept: 'ALL', level: 3 }] });
const cfo = sess({ email: 'cfo@x.id', nama: 'CFO', roles: [{ brand: 'ALL', dept: 'ALL', level: 5 }] });
const lv99 = sess({ email: 'x99@x.id', nama: 'X', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 99 }] });
const tanpaRole = sess({ email: 'none@x.id', nama: 'N', roles: [] });

let w: ReturnType<typeof authWorld>;
let n = 0;
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'OK'; } catch (e) { return e instanceof AppError ? e.code : `ERR:${String(e)}`; } };
const rowOf = (id: string) => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;

async function buat(amount = 1_000_000, brand = 'BRAND A', dept = 'DEPT X'): Promise<string> {
  const r = await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand, departement: dept, description: 'Beli kertas', vendorKode: 'V3', noInvoice: `INV-${++n}`, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((x) => { if (x[C('ID_TRX')] === r.id) x[C('FILE_URL')] = 'https://drive.google.com/file/d/abc/view'; return x; }));
  return r.id;
}

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [
    ...USERS,
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Budi', 'budi@x.id', 'YES', '081200000001', null, null],
    ['BRAND B', 'DEPT Y', 2, 'Manager', 'Bunga', 'bb@x.id', 'YES', '081200000011', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Fajar', 'fajar@x.id', 'YES', '081200000009', null, null],
  ]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', 'BCA', 'PT Gama', '1234567890', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('I13 — detail & voucher: matriks akses', () => {
  const matriks: [string, () => SessionData, boolean][] = [
    ['pemilik', () => citra, true], ['Manager berwenang', () => budi, true], ['Finance (L3)', () => finance, true], ['CFO (L5)', () => cfo, true],
    ['Manager divisi lain', () => mgrB, false], ['PIC lain', () => picLain, false], ['level 99', () => lv99, false], ['tanpa role', () => tanpaRole, false],
  ];
  for (const [nama, sesi, boleh] of matriks) {
    it(`${nama}: ${boleh ? 'boleh' : '404'} (detail, voucher, lampiran)`, async () => {
      const id = await buat();
      const s = sesi();
      expect(await code(detail(w.deps, s, id))).toBe(boleh ? 'OK' : 'NOT_FOUND');
      expect(await code(voucher(w.deps, s, id))).toBe(boleh ? 'OK' : 'NOT_FOUND');
      if (!boleh) expect(await code(bukaLampiran({ ...w.deps, drive: undefined as never }, s, id))).toBe('NOT_FOUND');
    });
  }
  it('ID tak ada = 404, sama dengan tak berhak (tak membocorkan keberadaan)', async () => {
    expect(await code(detail(w.deps, finance, 'TRD-99999'))).toBe('NOT_FOUND');
    expect(await code(voucher(w.deps, citra, 'TRD-99999'))).toBe('NOT_FOUND');
  });
  it('detail menyamarkan rekening, voucher memuat nomor penuh', async () => {
    const id = await buat();
    expect((await detail(w.deps, budi, id)).noRekening).not.toContain('1234567890');
    expect((await detail(w.deps, budi, id)).noRekening.endsWith('7890')).toBe(true);
    expect((await voucher(w.deps, budi, id)).noRekening).toBe('1234567890');
  });
  it('detail tidak membocorkan link Drive mentah maupun email pembuat', async () => {
    const id = await buat();
    const j = JSON.stringify(await detail(w.deps, finance, id));
    expect(j).not.toContain('drive.google.com');
    expect(j).not.toContain('citra@x.id');
  });
});

describe('timeline & alur', () => {
  it('submit lalu approve: timeline berurutan, nama dari email, catatan tanpa sufiks channel', async () => {
    const id = await buat();
    await submitPengajuan(w.deps, citra, id, 'idem-m7-000001', true);
    const t = await w.deps.sessions.create(budi);
    await approve(w.deps, budi, t, id, { etag: etagOf(rowOf(id)), notes: 'ok' }, 'idem-m7-000002', true);
    const d = await detail(w.deps, citra, id);
    const judul = d.timeline.map((x) => x.judul);
    expect(judul.some((j) => j.startsWith('Disetujui'))).toBe(true);
    expect(d.timeline.every((x, i, a) => i === 0 || a[i - 1]!.ts <= x.ts)).toBe(true);
    expect(d.timeline.find((x) => x.judul.includes('Diperiksa'))!.catatan).toBe('ok');
    expect(d.timeline.some((x) => x.oleh === 'Citra')).toBe(true);
    expect(d.alur.find((a) => a.state === 'sekarang')!.status).toBe('Manager Approved');
  });
  it('posisiAlur: Revision = kembali ke PIC; Rejected tak punya langkah aktif; Paid semua selesai', () => {
    expect(posisiAlur('Revision Needed')[0]).toMatchObject({ state: 'sekarang', label: 'Perlu Revisi' });
    expect(posisiAlur('Rejected').some((a) => a.state === 'sekarang')).toBe(false);
    expect(posisiAlur('Paid').every((a) => a.state === 'selesai')).toBe(true);
    expect(posisiAlur('Partially Paid').find((a) => a.state === 'sekarang')!.status).toBe('COA Posted');
  });
  it('susunTimeline: hanya STATUS_CHANGE; bersihkanCatatan; umurHari', () => {
    const t = susunTimeline(
      [{ ts: 2, waktu: 'w', email: 'a@x', action: 'STATUS_CHANGE', field: 'Status', oldV: 'Draft', newV: 'Submitted' }, { ts: 1, waktu: 'w', email: 'a@x', action: 'CREATE', field: 'Pengajuan', oldV: '', newV: '1' }],
      [], (e) => e.toUpperCase());
    expect(t).toHaveLength(1);
    expect(t[0]!.oleh).toBe('A@X');
    expect(bersihkanCatatan('oke [via WhatsApp]')).toBe('oke');
    expect(umurHari(0, 3 * 86_400_000 + 5)).toBe(3);
    expect(umurHari(null, 1)).toBeNull();
  });
  it('maskRekening & format tanggal WIB', () => {
    expect(maskRekening('1234567890')).toBe('••••••7890');
    expect(maskRekening('')).toBe('-');
    expect(maskRekening('12')).toBe('****');
    expect(fmtTanggal(46296)).toBe('01/10/2026');
    expect(fmtTanggal('')).toBe('-');
    expect(fmtWaktu(46296.5)).toMatch(/^01\/10\/2026 \d\d:\d\d$/);
  });
});

describe('buildSignatureBlocks — paritas', () => {
  const users = [
    { brand: 'BRAND A', dept: 'DEPT X', level: 1, jabatan: 'PIC', nama: 'Citra', aktif: 'YES' },
    { brand: 'BRAND A', dept: 'DEPT X', level: 2, jabatan: 'Mgr', nama: 'Budi', aktif: 'YES' },
    { brand: 'BRAND A', dept: 'DEPT X', level: 2, jabatan: 'Mgr', nama: 'Fajar', aktif: 'YES' },
    { brand: 'ALL', dept: 'ALL', level: 3, jabatan: 'Fin', nama: 'Dani', aktif: 'YES' },
    { brand: 'ALL', dept: 'ALL', level: 4, jabatan: 'FinMgr', nama: 'Eko', aktif: 'YES' },
    { brand: 'ALL', dept: 'ALL', level: 5, jabatan: 'CFO', nama: 'Cici', aktif: 'YES' },
    { brand: 'BRAND A', dept: 'DEPT X', level: 3, jabatan: 'Fin2', nama: '-', aktif: 'YES' },
    { brand: 'BRAND A', dept: 'DEPT X', level: 1, jabatan: 'PIC', nama: 'Mati', aktif: 'NO' },
    { brand: 'BRAND B', dept: 'DEPT Y', level: 1, jabatan: 'PIC', nama: 'Lain', aktif: 'YES' },
    { brand: 'ALL', dept: 'ALL', level: 9, jabatan: 'System Admin', nama: 'Admin', aktif: 'YES' },
  ];
  const f = (x: unknown): string => `T${String(x)}`;
  it('tanpa CFO: level 1-4, satu orang pertama per level, CFO dilewati, nama "-"/nonaktif/divisi lain dilewati', () => {
    const k = bangunKotakTTD(users, new Map(), 'brand a', 'dept x', false, f);
    expect(k.map((x) => [x.level, x.nama])).toEqual([[1, 'CITRA'], [2, 'BUDI'], [3, 'DANI'], [4, 'EKO']]);
  });
  it('perluCFO: ikut level 5; label & metode sesuai level', () => {
    const k = bangunKotakTTD(users, new Map(), 'BRAND A', 'DEPT X', true, f);
    expect(k.map((x) => x.level)).toEqual([1, 2, 3, 4, 5]);
    expect(k.map((x) => x.role)).toEqual(['Dibuat Oleh,', 'Diperiksa Oleh,', 'Diverifikasi Oleh,', 'Disetujui Oleh,', 'Disetujui Oleh,']);
    expect(k.map((x) => x.method)).toEqual(['E-SIGN', 'E-SIGN', 'E-SIGN', 'E-SIGN', 'E-SIGN']); // O4: tanpa TTD basah
    expect(k[0]!.label).toBe('( Menunggu )'); expect(k[3]!.label).toBe('( Menunggu )');
  });
  it('Admin (L9, ALL/ALL) bukan penandatangan: tidak muncul sebagai kotak "Mengetahui" (keputusan user, beda dari lama)', () => {
    const k = bangunKotakTTD(users, new Map(), 'BRAND A', 'DEPT X', true, f);
    expect(k.some((x) => x.level === 9 || x.nama === 'ADMIN')).toBe(false);
    expect(k.map((x) => x.role)).not.toContain('Mengetahui,');
  });
  it('approval nyata menimpa nama/jabatan dan menandai tertanda; catatan lama Method WET = "TTD Basah — Terverifikasi", e-approve = E-Signed; yang terakhir menang', () => {
    const peta = petaPersetujuan([
      { level: 2, action: 'APPROVED', nama: 'Pengganti', jabatan: 'Plt', timestamp: 1 },
      { level: 2, action: 'APPROVED', nama: 'Fajar', jabatan: 'Mgr', timestamp: 2 },
      { level: 3, action: 'REJECTED', nama: 'Dani', jabatan: 'Fin', timestamp: 3 },
      { level: 4, action: 'approved', nama: 'Eko', jabatan: 'FinMgr', timestamp: 4, method: 'WET' },
      { level: 5, action: 'APPROVED', nama: 'Gita', jabatan: 'CFO', timestamp: 5, method: 'E-SIGN' },
    ]);
    const k = bangunKotakTTD(users, peta, 'BRAND A', 'DEPT X', false, f);
    expect(k[1]).toMatchObject({ nama: 'Fajar', isSigned: true, label: 'E-Signed', signedAt: 'T2' });
    expect(k[2]!.isSigned).toBe(false);
    expect(k[3]).toMatchObject({ isSigned: true, label: 'TTD Basah — Terverifikasi', method: 'WET' });
    expect(bangunKotakTTD(users, peta, 'BRAND A', 'DEPT X', true, f)[4]).toMatchObject({ isSigned: true, label: 'E-Signed', method: 'E-SIGN' });
  });
  it('voucher end-to-end: kotak TTD dari Master_User_TTD + riwayat bayar + ambang CFO', async () => {
    const id = await buat(6_000_000);
    w.store.seed(TRX_PAYMENT_LOG, [['LOG-1', id, 46296, 2_000_000, 'BCA', 'REF1', 'dani@x.id', 46296]]);
    const v = await voucher(w.deps, finance, id);
    expect(v.perluCFO).toBe(true);
    expect(v.pembayaran).toEqual([{ tgl: '01/10/2026', nominal: 2_000_000, sumber: 'BCA', ref: 'REF1' }]);
    expect(v.ttd.map((x) => x.level)).toContain(1);
    expect(v.ambangCFO).toBe(5_000_000);
  });
});

describe('Ctrl+K & dashboard', () => {
  it('pencarian hanya mengembalikan dokumen yang boleh dilihat', async () => {
    const a = await buat(1_000_000, 'BRAND A', 'DEPT X');
    expect((await cari(w.deps, citra, 'kertas')).map((x) => x.id)).toEqual([a]);
    expect((await cari(w.deps, budi, a.toLowerCase())).map((x) => x.id)).toEqual([a]);
    expect((await cari(w.deps, finance, 'gama')).map((x) => x.id)).toEqual([a]);
    expect(await cari(w.deps, mgrB, 'kertas')).toEqual([]);
    expect(await cari(w.deps, picLain, 'kertas')).toEqual([]);
    expect(await cari(w.deps, lv99, 'kertas')).toEqual([]);
    expect(await cari(w.deps, citra, 'k')).toEqual([]);
  });
  it('cocokCari: semua kata harus ada; query < 2 huruf = tidak cocok', () => {
    const r = { id: 'TRD-00001', vendor: 'Gama Sejahtera', noInvoice: 'INV-9', poNumber: '-', description: 'Beli kertas', createdBy: 'c@x', brand: 'a', dept: 'x' };
    const roles = [{ brand: 'ALL', dept: 'ALL', level: 3 }];
    expect(cocokCari(roles, 'q@x', 'gama kertas', r)).toBe(true);
    expect(cocokCari(roles, 'q@x', 'gama pensil', r)).toBe(false);
    expect(cocokCari(roles, 'q@x', 'g', r)).toBe(false);
  });
  it('dashboard PIC & Manager; Manager divisi lain tidak melihat antrean ini', async () => {
    const id = await buat(2_500_000);
    await submitPengajuan(w.deps, citra, id, 'idem-m7-000010', true);
    const dp = await dashboard(w.deps, citra);
    expect(dp.pic.menunggu).toBe(1); expect(dp.pic.terbaru[0]!.id).toBe(id); expect(dp.manager).toBeNull();
    const dm = await dashboard(w.deps, budi);
    expect(dm.manager).toMatchObject({ antrean: 1, totalNominal: 2_500_000 });
    expect((await dashboard(w.deps, mgrB)).manager).toMatchObject({ antrean: 0, totalNominal: 0, tertuaHari: null });
  });
});
