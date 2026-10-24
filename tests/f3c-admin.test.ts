import { beforeEach, describe, expect, it } from 'vitest';
import { auditIntegritas, nolDepanHilang, rencanaNolRekening, rencanaRekonsiliasi, validasiMaster, validasiUser } from '@/domain/admin';
import { AppError } from '@/lib/errors';
import type { RawRow } from '@/ports/store';
import { AUDIT_LOG, MASTER_COA, MASTER_PPH, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex, type TabSchema } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import {
  cekIntegritas, cekKoneksi, cekMaster, daftarUser, jalankanRepair, kirimLinkPassword, paksaLogout, pratinjauRepair, simpanUser,
} from '@/server/admin';
import { authWorld, P, USERS } from './auth-helpers';

const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const baris = (schema: TabSchema, o: Record<string, unknown>): RawRow => schema.cols.map((c) => (o[c.key] ?? null) as RawRow[number]);
const CU = (k: string): number => colIndex(MASTER_USER_TTD, k);
const CP = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const ADMIN_HP = '081200000009';
const adm: SessionData = { phone: '6281200000009', email: 'adm@x.id', nama: 'Adm', jabatan: 'Admin', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level: 9 }] };
const dani: SessionData = { phone: P.dani, email: 'dani@x.id', nama: 'Dani', jabatan: 'Fin', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level: 3 }] };

let w: ReturnType<typeof authWorld>;
const tok = async (s: SessionData, stepUp = true): Promise<string> => { const t = await w.deps.sessions.create(s); if (stepUp) await w.deps.sessions.markStepUp(t); return t; };
const user = { brand: 'brand a', dept: 'dept x', level: 1, jabatan: 'PIC', nama: 'Fajar', email: 'Fajar@X.id', aktif: true, noHp: '0812 0000 0010' };

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [...USERS, ['ALL', 'ALL', 9, 'Admin', 'Adm', 'adm@x.id', 'YES', ADMIN_HP, null, null]]);
});

describe('F3-C domain', () => {
  it('auditIntegritas: port auditDataIntegrity (rekening nol hilang, lebih bayar, ringkasan, log yatim, PO/SJ, vendor kembar, user)', () => {
    const t = auditIntegritas({
      pengajuan: [
        { ID_TRX: 'TRD-00001', VENDOR_NAME: 'PT A', NO_REKENING: '12345', FINAL_AMOUNT: 1000, TOTAL_PAID: 0, OS_BALANCE: 1000, TIPE: 'Trade', PO_NUMBER: 'PO-XX-1' },
        { ID_TRX: 'NTR-00002', VENDOR_NAME: 'PT B', NO_REKENING: '999', FINAL_AMOUNT: 10_000, TOTAL_PAID: 5000, OS_BALANCE: 5000, TIPE: 'Non-Trade' },
        { ID_TRX: 'NTR-00003', VENDOR_NAME: 'PT HILANG', NO_REKENING: '1', FINAL_AMOUNT: 0 },
      ],
      vendor: [
        { 'Kode Vendor': 'VND-0001', 'Nama Vendor': 'PT A', Bank: 'BCA', 'No Rekening': '0012345' },
        { 'Kode Vendor': 'VND-0002', 'Nama Vendor': 'PT B', Bank: 'BCA', 'No Rekening': '0012345' },
        { 'Kode Vendor': 'VND-0003', 'Nama Vendor': 'PT C', Bank: 'BNI', 'No Rekening': '' },
      ],
      pembayaran: [{ Log_ID: 'PAY-1', ID_Trx: 'TRD-00001', Nominal: 5000 }, { Log_ID: 'PAY-2', ID_Trx: 'TRX-YATIM', Nominal: 1 }],
      poIds: ['PO-HL-1', 'PO-XX-2'], sjPoRefs: ['PO-HL-1', 'PO-HILANG', 'PO-HILANG'], prefixes: ['HL'],
      users: [{ Nama: 'Tanpa Email', Email: '', Level: 3, Aktif: 'YES', No_HP: '0812000001' }, { Nama: 'Placeholder', Email: 'a@domain.com', Level: 1, No_HP: '' }],
    });
    const s = t.map((x) => `${x.level}|${x.kategori}|${x.id}|${x.masalah}`).join('\n');
    expect(t[0]!.level).toBe('KRITIS');
    expect(s).toMatch(/KRITIS\|REKENING\|TRD-00001\|.*NOL DI DEPAN HILANG/);
    expect(s).toMatch(/TINGGI\|REKENING\|NTR-00002/);
    expect(s).toMatch(/TINGGI\|VENDOR\|NTR-00003\|Vendor "PT HILANG" tidak ada/);
    expect(s).toMatch(/KRITIS\|PEMBAYARAN\|TRD-00001\|KELEBIHAN BAYAR/);
    expect(s).toMatch(/TINGGI\|PEMBAYARAN\|NTR-00002\|Ringkasan tidak sinkron/);
    expect(s).toMatch(/TINGGI\|PEMBAYARAN\|PAY-2\|.*TRX-YATIM/);
    expect(s).toMatch(/TINGGI\|PURCHASE ORDER\|PO-XX-2\|.*prefix/);
    expect(s).toMatch(/KRITIS\|SURAT JALAN\|PO-HILANG\|2 baris SJ/);
    expect(s).toMatch(/TINGGI\|PURCHASE ORDER\|TRD-00001\|.*PO-XX-1/);
    expect(s).toMatch(/KRITIS\|VENDOR\|VND-0001 \/ VND-0002/);
    expect(s).toMatch(/TINGGI\|VENDOR\|VND-0003\|.*tidak punya nomor rekening/);
    expect(s).toMatch(/KRITIS\|USER\|Baris 2\|.*email valid/);
    expect(s).toMatch(/KRITIS\|USER\|Baris 3\|.*placeholder/);
    expect(s).toMatch(/TINGGI\|USER\|Baris 3\|.*nomor HP/);
    expect(s).toMatch(/KRITIS\|USER\|-\|.*Level 4/);
    expect(s).toMatch(/TINGGI\|USER\|-\|.*Level 5/);
  });

  it('rekonsiliasi: dari Payment Log; hanya baris yang beda; lebih bayar ditandai Paid + dilaporkan; dokumen belum dibayar tidak disentuh', () => {
    const r = rencanaRekonsiliasi([
      { _row: 2, ID_TRX: 'A', FINAL_AMOUNT: 1000, TOTAL_PAID: 0, OS_BALANCE: 1000, PAY_STATUS: '' },
      { _row: 3, ID_TRX: 'B', FINAL_AMOUNT: 10_000, TOTAL_PAID: 4000, OS_BALANCE: 6000, PAY_STATUS: 'Partially Paid' },
      { _row: 4, ID_TRX: 'C', FINAL_AMOUNT: 10_000, TOTAL_PAID: 10_000, OS_BALANCE: 0, PAY_STATUS: 'Paid' },
      { _row: 5, ID_TRX: 'D', FINAL_AMOUNT: 5000, TOTAL_PAID: 0, OS_BALANCE: '', PAY_STATUS: '' },
      { _row: 6, ID_TRX: '', FINAL_AMOUNT: 0 },
    ], [{ ID_Trx: 'a', Nominal: 3000 }, { ID_Trx: 'B', Nominal: 9500 }, { ID_Trx: 'C', Nominal: 10_000 }]);
    expect(r.ubah).toEqual([
      { row: 2, id: 'A', cells: { TOTAL_PAID: 3000, OS_BALANCE: 0, PAY_STATUS: 'Paid' }, sebelum: { TOTAL_PAID: 0, OS_BALANCE: 1000, PAY_STATUS: '' } },
      { row: 3, id: 'B', cells: { TOTAL_PAID: 9500, OS_BALANCE: 0, PAY_STATUS: 'Paid' }, sebelum: { TOTAL_PAID: 4000, OS_BALANCE: 6000, PAY_STATUS: 'Partially Paid' } },
    ]);
    expect(r.lebihBayar).toEqual(['A (lebih Rp 2.000)']);
  });

  it('repair rekening dipersempit: hanya nol di depan yang hilang', () => {
    expect([nolDepanHilang('12345', '0012345'), nolDepanHilang('12345', '12345'), nolDepanHilang('99', '0012345'), nolDepanHilang('', '0')]).toEqual([true, false, false, false]);
    const r = rencanaNolRekening([
      { _row: 2, ID_TRX: 'A', VENDOR_NAME: 'pt a', NO_REKENING: '12345' },
      { _row: 3, ID_TRX: 'B', VENDOR_NAME: 'PT A', NO_REKENING: '77777' },
    ], [{ 'Kode Vendor': 'VND-1', 'Nama Vendor': 'PT A', Bank: 'BCA', 'No Rekening': "'0012345" }]);
    expect(r.ubah).toEqual([{ row: 2, id: 'A', cells: { NO_REKENING: '0012345' }, sebelum: { NO_REKENING: '12345' } }]);
  });

  it('validator master: prefix ganda, COA bolong/ganda, tarif PPh bukan desimal 0–1', () => {
    const t = validasiMaster({
      setting: [['PT X', 'HL', '', '', 'HL'], ['PT Y', 'HM', '', '', 'hl'], ['', 'ZZ', '', '', '']],
      coa: [['BEBAN', 'OPS', 'SEWA', '-', '-'], ['BEBAN', 'OPS', 'SEWA', '-', '-'], ['', 'X', '', '', ''], ['ASET', '-', 'BANK', '', '']],
      pph: [['PPh 23', 0.02, 0.04], ['PPh 21', 2, 'x'], ['pph 23', 0.02, 0.04]],
    }).map((x) => `${x.level}|${x.id}|${x.masalah}`).join('\n');
    expect(t).toMatch(/KRITIS\|Master_Setting baris 3\|Prefix PO "HL" ganda/);
    expect(t).toMatch(/SEDANG\|Master_Setting baris 4\|Brand ZZ tanpa Company/);
    expect(t).toMatch(/SEDANG\|Master_COA baris 3\|Akun ganda/);
    expect(t).toMatch(/TINGGI\|Master_COA baris 4\|Level 1 kosong/);
    expect(t).toMatch(/SEDANG\|Master_COA baris 5\|Level 2 kosong di antara/);
    expect(t).toMatch(/KRITIS\|Master_PPh baris 3\|PPh 21: Tarif NPWP "2"/);
    expect(t).toMatch(/KRITIS\|Master_PPh baris 3\|PPh 21: Tarif non-NPWP "x"/);
    expect(t).toMatch(/SEDANG\|Master_PPh baris 4\|Jenis PPh "pph 23" ganda/);
  });

  it('validasi user: nomor, level sah, email, brand/dept; normalisasi', () => {
    expect(validasiUser(user)).toMatchObject({ ok: true, v: { phone: '6281200000010', brand: 'BRAND A', email: 'fajar@x.id' } });
    expect(validasiUser({ ...user, level: 7, noHp: '12', email: 'x@domain.com', brand: ' ' })).toMatchObject({ ok: false, galat: { level: expect.any(String), noHp: expect.any(String), email: expect.any(String), brand: expect.any(String) } });
  });
});

describe('F3-C admin user', () => {
  it('semua aksi admin = System Admin (Level 9) saja', async () => {
    const t = await tok(dani);
    expect(await kode(daftarUser(w.deps, dani))).toBe('FORBIDDEN');
    expect(await kode(simpanUser(w.deps, dani, t, user))).toBe('FORBIDDEN');
    expect(await kode(kirimLinkPassword(w.deps, dani, P.budi))).toBe('FORBIDDEN');
    expect(await kode(paksaLogout(w.deps, dani, P.budi))).toBe('FORBIDDEN');
    expect(await kode(cekMaster(w.deps, dani))).toBe('FORBIDDEN');
    expect(await kode(cekIntegritas(w.deps, dani))).toBe('FORBIDDEN');
    expect(await kode(pratinjauRepair(w.deps, dani, 'rekonsiliasi'))).toBe('FORBIDDEN');
    expect(await kode(cekKoneksi(w.deps, dani, { waTerkonfigurasi: false }))).toBe('FORBIDDEN');
  });

  it('daftar user tidak pernah membawa hash/salt; hanya penanda punya password', async () => {
    const l = await daftarUser(w.deps, adm);
    expect(JSON.stringify(l)).not.toMatch(/salt123|Password_Hash/);
    expect(l.find((u) => u.nama === 'Dani')).toMatchObject({ row: 5, punyaPassword: true, noHp: P.dani, level: 3 });
    expect(l.find((u) => u.nama === 'Eko')).toMatchObject({ aktif: false, punyaPassword: false });
  });

  it('tambah user: wajib step-up; nomor dinormalisasi; tanpa password; audit tanpa nomor penuh', async () => {
    expect(await kode(simpanUser(w.deps, adm, await tok(adm, false), user))).toBe('FORBIDDEN');
    const r = await simpanUser(w.deps, adm, await tok(adm), user);
    expect(r).toEqual({ ok: true, perluPassword: true, phone: '6281200000010' });
    const x = w.store.rowsOf(MASTER_USER_TTD).at(-1)!;
    expect([x[CU('Brand')], x[CU('Level')], x[CU('Email')], x[CU('Aktif')], x[CU('No_HP')], x[CU('Password_Hash')]]).toEqual(['BRAND A', 1, 'fajar@x.id', 'YES', '6281200000010', '']);
    const a = w.audit().at(-1)!;
    expect(a.action).toBe('USER_CREATE');
    expect(JSON.stringify(w.store.rowsOf(AUDIT_LOG).at(-1))).not.toContain('6281200000010');
  });

  it('peran tambahan untuk nomor yang sudah punya password: hash & salt disalin (aturan lama identik per nomor)', async () => {
    await simpanUser(w.deps, adm, await tok(adm), { ...user, noHp: '081200000003', nama: 'Dani', brand: 'BRAND C', dept: 'D', level: 1 });
    const x = w.store.rowsOf(MASTER_USER_TTD).at(-1)!;
    expect(x[CU('Password_Salt')]).toBe('salt123');
    expect(await kode(simpanUser(w.deps, adm, await tok(adm), { ...user, noHp: '081200000003', nama: 'Dani', brand: 'BRAND C', dept: 'D', level: 1 }))).toBe('RULE_VIOLATION');
  });

  it('ubah user: etag dari daftar; basi -> 409; sesi nomor itu dicabut', async () => {
    const budiTok = await w.deps.sessions.create({ phone: P.budi, email: 'budi@x.id', nama: 'Budi', jabatan: 'M', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
    const b = (await daftarUser(w.deps, adm)).find((u) => u.nama === 'Budi')!;
    const isi = { brand: b.brand, dept: b.dept, level: 2, jabatan: 'Manager', nama: 'Budi', email: 'budi@x.id', aktif: false, noHp: b.noHp };
    expect(await kode(simpanUser(w.deps, adm, await tok(adm), { ...isi, row: b.row, etag: 'x'.repeat(22) }))).toBe('CONFLICT');
    expect(await kode(simpanUser(w.deps, adm, await tok(adm), { ...isi, row: 3, etag: b.etag }))).toBe('CONFLICT'); // baris lain
    await simpanUser(w.deps, adm, await tok(adm), { ...isi, row: b.row, etag: b.etag });
    expect(w.store.rowsOf(MASTER_USER_TTD)[0]![CU('Aktif')]).toBe('NO');
    expect(await w.deps.sessions.load(budiTok)).toBeNull();
    expect(await kode(simpanUser(w.deps, adm, await tok(adm), { ...isi, row: b.row, etag: b.etag }))).toBe('CONFLICT'); // etag sudah basi
  });

  it('tidak boleh menyisakan nol System Admin aktif', async () => {
    const a = (await daftarUser(w.deps, adm)).find((u) => u.level === 9)!;
    const isi = { brand: 'ALL', dept: 'ALL', level: 9, jabatan: 'Admin', nama: 'Adm', email: 'adm@x.id', aktif: false, noHp: a.noHp };
    expect(await kode(simpanUser(w.deps, adm, await tok(adm), { ...isi, row: a.row, etag: a.etag }))).toBe('RULE_VIOLATION');
    expect(await kode(simpanUser(w.deps, adm, await tok(adm), { ...isi, level: 3, aktif: true, row: a.row, etag: a.etag }))).toBe('RULE_VIOLATION');
  });

  it('kirim link set-password lewat WA (link tidak dikembalikan ke admin); nonaktif ditolak; paksa logout mencabut sesi', async () => {
    const r = await kirimLinkPassword(w.deps, adm, '0812-0000-0001');
    expect(r).toEqual({ terkirim: true, nama: 'Budi' });
    expect(JSON.stringify(r)).not.toContain('set-password');
    expect(w.sender.sent[0]).toMatchObject({ phone: P.budi, link: expect.stringContaining('/set-password?t=') });
    expect(await kode(kirimLinkPassword(w.deps, adm, '081200000004'))).toBe('RULE_VIOLATION');
    expect(await kode(kirimLinkPassword(w.deps, adm, '081299999999'))).toBe('NOT_FOUND');
    const t = await w.deps.sessions.create({ phone: P.citra, email: 'citra@x.id', nama: 'Citra', jabatan: 'PIC', roles: [] });
    await paksaLogout(w.deps, adm, '081200000002');
    expect(await w.deps.sessions.load(t)).toBeNull();
    expect(w.audit().map((a) => a.action)).toEqual(expect.arrayContaining(['ISSUE_SETPASS_LINK', 'FORCE_LOGOUT']));
  });
});

describe('F3-C master, integritas, kesehatan', () => {
  it('cekMaster menghitung baris & menjalankan validator; integritas membaca semua tab', async () => {
    w.store.seed(MASTER_SETTING, [['PT X', 'HL', '', '', 'HL']]);
    w.store.seed(MASTER_COA, [['BEBAN', 'OPS', '-', '-', '-']]);
    w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
    expect(await cekMaster(w.deps, adm)).toEqual({ jumlah: { Master_Setting: 1, Master_COA: 1, Master_PPh: 1 }, temuan: [] });
    const t = await cekIntegritas(w.deps, adm);
    expect(t.map((x) => x.masalah).join(' ')).toMatch(/Level 4/);
  });

  it('kesehatan: Redis & Sheets diuji, WA belum dikonfigurasi dilaporkan, cron belum pernah jalan', async () => {
    const k = await cekKoneksi(w.deps, adm, { waTerkonfigurasi: false });
    expect(k.koneksi.map((x) => [x.nama, x.ok])).toEqual([['Redis', true], ['Sheets', true], ['Drive', false], ['WhatsApp', false]]);
    expect(k.cron.find((c) => c.nama === 'digest')).toEqual({ nama: 'digest', at: null, hasil: 'belum pernah' });
  });
});

describe('F3-C repair: snapshot -> konfirmasi -> eksekusi -> laporan', () => {
  const doc = (id: string, o: Record<string, unknown>) => baris(TRX_PENGAJUAN, { ID_TRX: id, STATUS: 'Partially Paid', FINAL_AMOUNT: 10_000, ...o });
  beforeEach(() => {
    w.store.seed(TRX_PENGAJUAN, [doc('NTR-00001', { TOTAL_PAID: 4000, OS_BALANCE: 6000, PAY_STATUS: 'Partially Paid' }), doc('NTR-00002', { TOTAL_PAID: 0 })]);
    w.store.seed(TRX_PAYMENT_LOG, [baris(TRX_PAYMENT_LOG, { Log_ID: 'PAY-1', ID_Trx: 'NTR-00001', Nominal: 7000 })]);
    w.store.seed(MASTER_VENDOR, []);
  });

  it('pratinjau tidak menulis; eksekusi = rencana yang sama + audit per baris (nilai sebelum/sesudah)', async () => {
    const n0 = w.store.batches.length;
    const p = await pratinjauRepair(w.deps, adm, 'rekonsiliasi');
    expect(w.store.batches.length).toBe(n0);
    expect(p).toMatchObject({ total: 1, dibatasi: false, ubah: [{ id: 'NTR-00001', cells: { TOTAL_PAID: 7000, OS_BALANCE: 3000, PAY_STATUS: 'Partially Paid' } }] });
    expect(await kode(jalankanRepair(w.deps, adm, await tok(adm, false), p.token, 'idem-repair-0001'))).toBe('FORBIDDEN'); // step-up
    expect(await kode(jalankanRepair(w.deps, adm, await tok(adm), p.token))).toBe('VALIDATION'); // aksi uang: Idempotency-Key wajib
    const h = await jalankanRepair(w.deps, adm, await tok(adm), p.token, 'idem-repair-0002');
    expect(h).toMatchObject({ jenis: 'rekonsiliasi', diperbaiki: 1, sisa: 0, ids: ['NTR-00001'] });
    const r = w.store.rowsOf(TRX_PENGAJUAN)[0]!;
    expect([r[CP('TOTAL_PAID')], r[CP('OS_BALANCE')], r[CP('PAY_STATUS')], r[CP('STATUS')]]).toEqual([7000, 3000, 'Partially Paid', 'Partially Paid']);
    const au = w.store.rowsOf(AUDIT_LOG).map((x) => [x[4], x[3], x[6], x[7]]);
    expect(au).toContainEqual(['REPAIR_ROW', 'NTR-00001', JSON.stringify({ TOTAL_PAID: 4000, OS_BALANCE: 6000, PAY_STATUS: 'Partially Paid' }), JSON.stringify({ TOTAL_PAID: 7000, OS_BALANCE: 3000, PAY_STATUS: 'Partially Paid' })]);
    expect(au.some((x) => x[0] === 'REPAIR')).toBe(true);
    expect(await kode(jalankanRepair(w.deps, adm, await tok(adm), p.token, 'idem-repair-0003'))).toBe('CONFLICT'); // token sekali pakai
  });

  it('data berubah setelah pratinjau -> 409, tidak ada yang ditulis', async () => {
    const p = await pratinjauRepair(w.deps, adm, 'rekonsiliasi');
    w.store.seed(TRX_PAYMENT_LOG, [baris(TRX_PAYMENT_LOG, { Log_ID: 'PAY-1', ID_Trx: 'NTR-00001', Nominal: 7000 }), baris(TRX_PAYMENT_LOG, { Log_ID: 'PAY-2', ID_Trx: 'NTR-00001', Nominal: 1000 })]);
    expect(await kode(jalankanRepair(w.deps, adm, await tok(adm), p.token, 'idem-repair-0004'))).toBe('CONFLICT');
    expect(w.store.rowsOf(TRX_PENGAJUAN)[0]![CP('TOTAL_PAID')]).toBe(4000);
  });

  it('pratinjau milik admin lain tidak bisa dieksekusi; tidak ada yang diperbaiki -> 422', async () => {
    const p = await pratinjauRepair(w.deps, adm, 'rekonsiliasi');
    const adm2 = { ...adm, email: 'adm2@x.id', phone: '6281200000011' };
    expect(await kode(jalankanRepair(w.deps, adm2, await tok(adm2), p.token, 'idem-repair-0005'))).toBe('FORBIDDEN');
    const q = await pratinjauRepair(w.deps, adm, 'nol-rekening');
    expect(q.total).toBe(0);
    expect(await kode(jalankanRepair(w.deps, adm, await tok(adm), q.token, 'idem-repair-0006'))).toBe('RULE_VIOLATION');
  });
});
