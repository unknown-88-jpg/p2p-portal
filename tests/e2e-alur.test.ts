/**
 * E2E alur P2P lewat service layer ASLI (store/Redis/Drive/WA in-memory, tanpa I/O sungguhan, data dummy).
 * Tidak ada baris transaksi yang ditanam manual: semua lewat fungsi produk (admin -> set password -> login -> vendor -> draft ->
 * unggah lampiran -> submit -> Manager (WA / web) -> pajak -> e-approve -> jurnal -> bayar -> laporan / export / voucher).
 * Satu `describe` per skenario; `it` di dalamnya berurutan dan berbagi state (langkah berikut bergantung pada langkah sebelumnya).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cekBolehDibayar, statusPersetujuan } from '@/domain/finance';
import { AppError } from '@/lib/errors';
import { legacyHash } from '@/infra/password';
import type { RawRow } from '@/ports/store';
import {
  AUDIT_LOG, MASTER_COA, MASTER_PPH, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex,
} from '@/repo/schema';
import { kirimLinkPassword, simpanUser } from '@/server/admin';
import { approve, etagOf, inbox, reject } from '@/server/approval';
import { getSession, login, setPasswordViaToken, stepUp, type SessionData } from '@/server/auth';
import { detail, voucher } from '@/server/dokumen';
import { exportOdoo } from '@/server/export-odoo';
import { bayar, jurnalCoa, kembalikanFinance, setujuiFinance, verifikasiPajak } from '@/server/finance-aksi';
import { bayarSchema, jurnalSchema, setujuiFinanceSchema, verifikasiPajakSchema } from '@/server/finance-schema';
import { konfirmasiUnggah, mulaiUnggah } from '@/server/lampiran';
import { laporanAging, laporanPembayaran, laporanRekap } from '@/server/laporan';
import { notifikasiSaya } from '@/server/notifikasi';
import { createDraft, submitPengajuan, updateDraft } from '@/server/pengajuan';
import { daftarVendor, putuskanVendor } from '@/server/vendor';
import { prosesPesan } from '@/server/wa-approval';
import { kirimDigestManager } from '@/server/wa-digest';
import { terbitkanKode } from '@/server/wa-kode';
import { authWorld, LEGACY_PW, tokenOf } from './auth-helpers';

// ------------------------------------------------------------------ util kolom
const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const CY = (k: string): number => colIndex(TRX_PAYMENT_LOG, k);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : `ERR:${String(e)}`));
const galat = async (p: Promise<unknown>): Promise<AppError> => p.then(() => { throw new Error('seharusnya gagal'); }, (e: unknown) => e as AppError);

// ------------------------------------------------------------------ orang (semua dummy)
const IP = '127.0.0.1';
const PW_ADMIN = LEGACY_PW;
const PW = 'Kopi-Pagi-Dummy-77';
const ADMIN_HP = '081300000009';
interface Orang { key: string; brand: string; dept: string; level: number; jabatan: string; nama: string; email: string; noHp: string }
const ORANG: Orang[] = [
  { key: 'citra', brand: 'BRAND A', dept: 'DEPT X', level: 1, jabatan: 'PIC', nama: 'Citra', email: 'citra@contoh.id', noHp: '081300000001' },
  { key: 'budi', brand: 'BRAND A', dept: 'DEPT X', level: 2, jabatan: 'Manager', nama: 'Budi', email: 'budi@contoh.id', noHp: '081300000002' },
  { key: 'dani', brand: 'ALL', dept: 'ALL', level: 3, jabatan: 'Finance Staff', nama: 'Dani', email: 'dani@contoh.id', noHp: '081300000003' },
  { key: 'fina', brand: 'ALL', dept: 'ALL', level: 3, jabatan: 'Finance Staff', nama: 'Fina', email: 'fina@contoh.id', noHp: '081300000004' },
  { key: 'eko', brand: 'ALL', dept: 'ALL', level: 4, jabatan: 'Fin. Mgr', nama: 'Eko', email: 'eko@contoh.id', noHp: '081300000005' },
  { key: 'gita', brand: 'ALL', dept: 'ALL', level: 5, jabatan: 'CFO', nama: 'Gita', email: 'gita@contoh.id', noHp: '081300000006' },
  // satu orang dengan dua peran (dua baris, nomor sama): PIC + Manager -> uji SoD
  { key: 'dual', brand: 'BRAND A', dept: 'DEPT X', level: 1, jabatan: 'PIC', nama: 'Dual', email: 'dual@contoh.id', noHp: '081300000007' },
  { key: 'dual', brand: 'BRAND A', dept: 'DEPT X', level: 2, jabatan: 'Manager', nama: 'Dual', email: 'dual@contoh.id', noHp: '081300000007' },
  // Fin. Mgr yang juga CFO -> uji "Fin. Mgr dan CFO harus orang berbeda"
  { key: 'rangkap', brand: 'ALL', dept: 'ALL', level: 4, jabatan: 'Fin. Mgr', nama: 'Rangkap', email: 'rangkap@contoh.id', noHp: '081300000008' },
  { key: 'rangkap', brand: 'ALL', dept: 'ALL', level: 5, jabatan: 'CFO', nama: 'Rangkap', email: 'rangkap@contoh.id', noHp: '081300000008' },
];
const hp62 = (noHp: string): string => `62${noHp.slice(1)}`;
const KAS = 'BCA 123';
const COA = [
  ['ASET', 'KAS DAN SETARA KAS', 'BANK', KAS, '-'],
  ['BEBAN', 'BEBAN OPERASIONAL', 'ATK', 'KERTAS', 'KERTAS A4'],
];

// ------------------------------------------------------------------ dunia + aktor dengan sesi ASLI (login & step-up password)
interface Aktor { s: SessionData; token: string; phone: string }
type Dunia = Awaited<ReturnType<typeof bangunDunia>>;

async function bangunDunia() {
  const w = authWorld();
  w.store.seed(MASTER_USER_TTD, [['ALL', 'ALL', 9, 'Admin', 'Adm', 'adm@contoh.id', 'YES', ADMIN_HP, legacyHash(PW_ADMIN, 'salt-adm'), 'salt-adm']]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(MASTER_COA, COA.map((c) => [...c]));
  w.store.seed(MASTER_VENDOR, []);
  for (const t of [TRX_PENGAJUAN, TRX_APPROVAL, TRX_PAYMENT_LOG, AUDIT_LOG]) w.store.seed(t, []);

  let n = 0;
  const key = (p = 'e2e'): string => `idem-${p}-${String(++n).padStart(8, '0')}`;

  const masuk = async (noHp: string, password: string): Promise<Aktor> => {
    const r = await login(w.deps, { phone: noHp, password }, IP);
    const s = (await getSession(w.deps, r.token))!;
    return { s, token: r.token, phone: s.phone };
  };
  /** Konfirmasi password (step-up) lewat jalur asli. */
  const konfirmasi = async (a: Aktor, password = PW): Promise<void> => stepUp(w.deps, a.token, a.s, { password }, IP);

  const admin = await masuk(ADMIN_HP, PW_ADMIN);
  const A: Record<string, Aktor> = {};
  const onboarding = async (): Promise<void> => {
    for (const o of ORANG) {
      await konfirmasi(admin, PW_ADMIN);
      await simpanUser(w.deps, admin.s, admin.token, { brand: o.brand, dept: o.dept, level: o.level, jabatan: o.jabatan, nama: o.nama, email: o.email, aktif: true, noHp: o.noHp }, key('usr'));
    }
    for (const hp of [...new Set(ORANG.map((o) => o.noHp))]) {
      await kirimLinkPassword(w.deps, admin.s, hp);
      const link = w.sender.sent.find((x) => x.phone === hp62(hp))!.link;
      await setPasswordViaToken(w.deps, { token: tokenOf(link), password: PW }, IP);
    }
    for (const o of ORANG) if (!A[o.key]) A[o.key] = await masuk(o.noHp, PW);
  };

  // --- pembacaan state
  const row = (id: string): RawRow => w.store.rowsOf(TRX_PENGAJUAN).find((r) => r[C('ID_TRX')] === id)!;
  const status = (id: string): string => String(row(id)[C('STATUS')]);
  const etag = (id: string): string => etagOf(row(id));
  const aprs = (id: string): RawRow[] => w.store.rowsOf(TRX_APPROVAL).filter((r) => r[CA('ID_Trx')] === id);
  const logs = (id: string): string[] => w.store.rowsOf(AUDIT_LOG).filter((r) => r[CL('ID_Trx')] === id).map((r) => String(r[CL('Action')]));
  const bayarLog = (id: string): RawRow[] => w.store.rowsOf(TRX_PAYMENT_LOG).filter((r) => r[CY('ID_Trx')] === id);
  const lonceng = async (a: Aktor): Promise<Record<string, number>> => Object.fromEntries((await notifikasiSaya(w.deps, a.s)).butir.map((b) => [b.kunci, b.jumlah]));
  const hariIni = (): string => new Date(w.clock.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  // --- langkah alur (fungsi produk asli)
  const enc = new TextEncoder();
  const pdf = (): Uint8Array => { const b = new Uint8Array(200).fill(0x20); b.set(enc.encode('%PDF-1.7\n')); return b; };
  const unggah = async (a: Aktor, id: string): Promise<void> => {
    const bytes = pdf();
    const m = await mulaiUnggah(w.deps, a.s, id, { namaAsli: `Invoice ${id}.pdf`, size: bytes.length, mimeType: 'application/pdf' }, 'http://localhost:3000');
    const fileId = w.drive.upload(m.sessionUrl, bytes);
    await konfirmasiUnggah(w.deps, a.s, id, { uploadId: m.uploadId, fileId });
  };
  let inv = 0;
  const isian = (vendorKode: string, amount: number, o: Record<string, unknown> = {}) => ({
    tipe: 'Non-Trade' as const, brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas (dummy)', vendorKode, noInvoice: `INV-E2E-${++inv}`,
    dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN', ...o,
  });
  /** draft + lampiran + submit (jalur asli). */
  const ajukan = async (a: Aktor, vendorKode: string, amount: number, o: Record<string, unknown> = {}): Promise<string> => {
    const { id } = await createDraft(w.deps, a.s, isian(vendorKode, amount, o), key('drf'));
    await unggah(a, id);
    await submitPengajuan(w.deps, a.s, id, key('sub'), true);
    return id;
  };
  const kodeWa = async (phone: string, id: string): Promise<string | null> => w.redis.get(`wa:d:${phone}:${id}`);
  let mid = 0;
  const balasWa = async (phone: string, teks: string): Promise<void> => prosesPesan(w.deps, { id: `MSGE2E${String(++mid).padStart(6, '0')}`, nomor: phone, teks, tsMs: w.clock.now() - 1_000 }, true);
  const lastWa = (phone: string): string => w.wa.sent.filter((m) => m.to === phone).at(-1)?.text ?? '';

  const managerWeb = async (a: Aktor, id: string, o: { stepUp?: boolean; etag?: string; kk?: string } = {}) => {
    if (o.stepUp) await konfirmasi(a);
    return approve(w.deps, a.s, a.token, id, { etag: o.etag ?? etag(id), notes: 'ok (e2e)' }, o.kk ?? key('apv'), true);
  };
  const verifPajak = (a: Aktor, id: string, o: Partial<{ invAmount: number; statusPPN: 'Include PPN' | 'Exclude PPN' | 'Non PPN'; jenisPPh: string; etag: string }> = {}) =>
    verifikasiPajak(w.deps, a.s, id, verifikasiPajakSchema.parse({ etag: o.etag ?? etag(id), invAmount: o.invAmount ?? Number(row(id)[C('INV_AMOUNT')]), statusPPN: o.statusPPN ?? 'Non PPN', jenisPPh: o.jenisPPh ?? '-' }), key('tax'));
  const eApprove = async (a: Aktor, id: string, sebagai: 'finmgr' | 'cfo', o: { stepUp?: boolean } = {}) => {
    if (o.stepUp ?? true) await konfirmasi(a);
    return setujuiFinance(w.deps, a.s, a.token, id, setujuiFinanceSchema.parse({ etag: etag(id), sebagai }), key('eap'));
  };
  const jurnal = (a: Aktor, id: string) =>
    jurnalCoa(w.deps, a.s, jurnalSchema.parse({ items: [{ id, etag: etag(id), lvl1: 'BEBAN', lvl2: 'BEBAN OPERASIONAL', lvl3: 'ATK', lvl4: 'KERTAS', lvl5: 'KERTAS A4' }] }), key('jrn'));
  const inputBayar = (id: string, nominal: number, o: { etag?: string; ref?: string; dup?: boolean } = {}) =>
    bayarSchema.parse({ items: [{ id, etag: o.etag ?? etag(id), nominal }], tglBayar: hariIni(), sumberRekening: KAS, ...(o.ref ? { refNo: o.ref } : {}), ...(o.dup ? { konfirmasiDuplikat: true } : {}) });
  const bayarkan = async (a: Aktor, id: string, nominal: number, o: { etag?: string; ref?: string; kk?: string; dup?: boolean } = {}) => {
    await konfirmasi(a);
    return bayar(w.deps, a.s, a.token, inputBayar(id, nominal, o), o.kk ?? key('pay'));
  };
  /** Vendor lewat maker-checker asli: PIC mendaftar, Finance Staff (bukan pendaftar) mengesahkan. */
  const vendorSah = async (pendaftar: Aktor, pengesah: Aktor, o: { nama: string; noRekening: string; npwp?: string }) => {
    const v = await daftarVendor(w.deps, pendaftar.s, { namaVendor: o.nama, tipeVendor: 'Non-Trade', npwp: o.npwp ?? '', bank: 'BCA', namaRekening: o.nama, noRekening: o.noRekening }, key('vnd'));
    await putuskanVendor(w.deps, pengesah.s, v.kode, 'approve', { bank: 'BCA', noRekening: o.noRekening }, key('vnd'));
    return v.kode;
  };
  /** Rantai cepat sampai COA Posted (< 5 jt: Manager web tanpa step-up; Fin. Mgr Eko). */
  const sampaiCoaPosted = async (vendorKode: string, amount: number): Promise<string> => {
    const id = await ajukan(A.citra!, vendorKode, amount);
    await managerWeb(A.budi!, id);
    await verifPajak(A.dani!, id);
    await eApprove(A.eko!, id, 'finmgr');
    await jurnal(A.dani!, id);
    return id;
  };

  return {
    w, key, A, admin, onboarding, konfirmasi, row, status, etag, aprs, logs, bayarLog, lonceng, hariIni, ajukan, unggah, isian, kodeWa, balasWa, lastWa,
    managerWeb, verifPajak, eApprove, jurnal, inputBayar, bayarkan, vendorSah, sampaiCoaPosted,
  };
}

// =================================================================== A. happy path < Rp 5 jt (tanpa CFO)
describe('E2E A — alur bahagia < Rp 5 jt (tanpa CFO)', () => {
  let D: Dunia;
  let vendor = '';
  let id = '';
  let final = 0;
  beforeAll(async () => { D = await bangunDunia(); });

  it('A1 Admin menambah user (PIC, Manager, Finance Staff x2, Fin. Mgr, CFO), user set password lewat link, lalu login', async () => {
    await D.onboarding();
    const kunci = Object.keys(D.A).sort();
    expect(kunci).toEqual(['budi', 'citra', 'dani', 'dual', 'eko', 'fina', 'gita', 'rangkap']);
    expect(D.A.dual!.s.roles.map((r) => r.level).sort()).toEqual([1, 2]);
    expect(D.A.rangkap!.s.roles.map((r) => r.level).sort()).toEqual([4, 5]);
    const aksi = D.w.store.rowsOf(AUDIT_LOG).map((r) => String(r[CL('Action')]));
    expect(aksi.filter((a) => a === 'USER_CREATE')).toHaveLength(ORANG.length);
    expect(aksi.filter((a) => a === 'SET_PASSWORD')).toHaveLength(new Set(ORANG.map((o) => o.noHp)).size);
    // Hash password tidak pernah ikut dalam audit
    expect(JSON.stringify(D.w.store.rowsOf(AUDIT_LOG))).not.toMatch(/scrypt|\$s\d/);
  });

  it('A2 PIC mendaftarkan vendor; lonceng Finance Staff menyala; Finance Staff lain mengesahkan (maker-checker)', async () => {
    const v = await daftarVendor(D.w.deps, D.A.citra!.s, { namaVendor: 'pt kertas dummy', tipeVendor: 'Non-Trade', npwp: '01.234.567.8-901.000', bank: 'bca', namaRekening: 'pt kertas dummy', noRekening: '1111 2222 33' }, D.key());
    expect(v).toMatchObject({ status: 'Pending' });
    vendor = v.kode;
    expect((await D.lonceng(D.A.dani!)).vendor).toBe(1);
    // vendor Pending belum bisa dipakai (I8)
    expect(await kode(createDraft(D.w.deps, D.A.citra!.s, D.isian(vendor, 1_000_000)))).toBe('RULE_VIOLATION');
    await putuskanVendor(D.w.deps, D.A.dani!.s, vendor, 'approve', { bank: 'BCA', noRekening: '1111222233' }, D.key());
    expect((await D.lonceng(D.A.dani!)).vendor).toBeUndefined();
  });

  it('A3 PIC membuat draft, mengunggah lampiran, submit -> Submitted; lonceng Manager = 1', async () => {
    const r = await createDraft(D.w.deps, D.A.citra!.s, D.isian(vendor, 1_000_000, { statusPPN: 'Exclude PPN' }), D.key());
    id = r.id;
    expect(D.status(id)).toBe('Draft');
    expect((await D.lonceng(D.A.citra!))['pic-draft']).toBe(1);
    expect(await kode(submitPengajuan(D.w.deps, D.A.citra!.s, id, D.key(), true))).toBe('RULE_VIOLATION'); // belum ada lampiran
    await D.unggah(D.A.citra!, id);
    expect(String(D.row(id)[C('FILE_URL')])).toMatch(/drive\.google\.com/);
    const s = await submitPengajuan(D.w.deps, D.A.citra!.s, id, D.key(), true);
    expect(s).toMatchObject({ status: 'Submitted', perluCFO: false });
    expect(String(D.row(id)[C('NPWP_VENDOR')])).toContain('01.234');
    expect((await D.lonceng(D.A.budi!)).manager).toBe(1);
    expect((await inbox(D.w.deps, D.A.budi!.s, true)).map((x) => x.id)).toEqual([id]);
    expect(D.logs(id)).toEqual(['CREATE', 'UPLOAD', 'STATUS_CHANGE', 'APPROVAL']);
  });

  it('A4 digest WA ke Manager memuat kode; Manager membalas SETUJU <kode> -> Manager Approved (Method WA); PIC dikabari', async () => {
    const r = await kirimDigestManager(D.w.deps, { sod: true, force: true });
    expect(r.terkirim).toBeGreaterThanOrEqual(1);
    const budiHp = D.A.budi!.phone;
    const k = await D.kodeWa(budiHp, id);
    expect(k).toMatch(/^\d{4}$/);
    expect(await D.kodeWa(D.A.dual!.phone, id)).toMatch(/^\d{4}$/); // Manager lain di divisi sama juga dapat
    await D.balasWa(budiHp, `SETUJU ${k}`);
    expect(D.status(id)).toBe('Manager Approved');
    const l2 = D.aprs(id).filter((x) => Number(x[CA('Level')]) === 2);
    expect(l2.map((x) => [x[CA('Method')], x[CA('Action')], x[CA('Approver_Email')]])).toEqual([['WA', 'APPROVED', 'budi@contoh.id']]);
    expect(D.lastWa(budiHp)).toContain('berhasil disetujui');
    expect(D.lastWa(D.A.citra!.phone)).toContain('disetujui Manager');
    // kode orang lain untuk dokumen yang sama tidak lagi berlaku (status sudah berubah)
    const kd = (await D.kodeWa(D.A.dual!.phone, id))!;
    await D.balasWa(D.A.dual!.phone, `SETUJU ${kd}`);
    expect(D.aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
    expect((await D.lonceng(D.A.budi!)).manager).toBeUndefined();
    expect((await D.lonceng(D.A.dani!))['fin-pajak']).toBe(1);
  });

  it('A5 Finance Staff verifikasi pajak (Exclude PPN + PPh 23 NPWP 2%) -> Tax Verified; nominal dihitung ulang server', async () => {
    const r = await D.verifPajak(D.A.dani!, id, { statusPPN: 'Exclude PPN', jenisPPh: 'PPh 23' });
    // DPP 1.000.000 + PPN 11% 110.000 - PPh 23 2% 20.000
    expect(r).toMatchObject({ status: 'Tax Verified', finalAmount: 1_090_000, perluCFO: false });
    final = r.finalAmount;
    expect(D.row(id)[C('OS_BALANCE')]).toBe(final);
    expect((await D.lonceng(D.A.eko!))['fin-finmgr']).toBe(1);
    expect((await D.lonceng(D.A.gita!))['fin-cfo']).toBeUndefined(); // dokumen tidak butuh CFO
  });

  it('A6 Fin. Mgr e-approve: tanpa step-up ditolak; dengan step-up -> Wet Signed (menunggu jurnal); CFO tidak diperlukan', async () => {
    const e = await galat(D.eApprove(D.A.eko!, id, 'finmgr', { stepUp: false }));
    expect(e).toMatchObject({ code: 'FORBIDDEN', fields: { stepUp: 'required' } });
    expect(await kode(D.eApprove(D.A.gita!, id, 'cfo'))).toBe('RULE_VIOLATION');
    const r = await D.eApprove(D.A.eko!, id, 'finmgr');
    expect(r).toMatchObject({ status: 'Wet Signed', menungguCFO: false });
    expect((await D.lonceng(D.A.dani!))['fin-jurnal']).toBe(1);
  });

  it('A7 Finance Staff posting jurnal COA -> COA Posted; lonceng bayar = 1', async () => {
    const r = await D.jurnal(D.A.dani!, id);
    expect(r).toEqual({ berhasil: [{ id, akun: 'KERTAS A4' }], gagal: [] });
    expect(D.status(id)).toBe('COA Posted');
    expect([D.row(id)[C('CATEGORY_COA')], D.row(id)[C('HEAD_COA')], D.row(id)[C('SUB_COA')]]).toEqual(['BEBAN', 'BEBAN OPERASIONAL', 'KERTAS A4']);
    const l = await D.lonceng(D.A.dani!);
    expect([l['fin-jurnal'], l['fin-bayar']]).toEqual([undefined, 1]);
  });

  it('A8 bayar sebagian -> Partially Paid; aging menunjukkan sisa; bayar sisa -> Paid; Trx_Payment_Log 2 baris', async () => {
    const r1 = await D.bayarkan(D.A.fina!, id, 400_000, { ref: 'TRF-001' });
    expect(r1.berhasil[0]).toMatchObject({ id, nominal: 400_000, lunas: false, sisa: final - 400_000 });
    expect(D.status(id)).toBe('Partially Paid');
    const ag = await laporanAging(D.w.deps, D.A.eko!.s);
    expect(ag.baris.find((b) => b.id === id)).toMatchObject({ total: final, dibayar: 400_000, sisa: final - 400_000 });
    expect(ag.totalSisa).toBe(final - 400_000);

    const r2 = await D.bayarkan(D.A.fina!, id, final - 400_000, { ref: 'TRF-002' });
    expect(r2.berhasil[0]).toMatchObject({ lunas: true, sisa: 0 });
    expect(D.status(id)).toBe('Paid');
    const x = D.row(id);
    expect([x[C('TOTAL_PAID')], x[C('OS_BALANCE')], x[C('PAY_STATUS')]]).toEqual([final, 0, 'Paid']);
    const log = D.bayarLog(id);
    expect(log.map((y) => [y[CY('Nominal')], y[CY('Sumber_Rekening')], y[CY('Ref_No')], y[CY('Created_By')]])).toEqual([
      [400_000, KAS, 'TRF-001', 'fina@contoh.id'], [final - 400_000, KAS, 'TRF-002', 'fina@contoh.id'],
    ]);
    const l = await D.lonceng(D.A.dani!);
    expect([l['fin-pajak'], l['fin-jurnal'], l['fin-bayar']]).toEqual([undefined, undefined, undefined]);
  });

  it('A9 Audit_Log lengkap per langkah dan urut', async () => {
    expect(D.logs(id)).toEqual([
      'CREATE', 'UPLOAD', 'STATUS_CHANGE', 'APPROVAL', // submit + e-sign L1
      'STATUS_CHANGE', 'APPROVAL', // Manager via WA
      'STATUS_CHANGE', 'TAX_ADJUST', // verifikasi pajak (nominal berubah)
      'APPROVAL', 'STATUS_CHANGE', // Fin. Mgr
      'STATUS_CHANGE', 'COA_POST', // jurnal
      'STATUS_CHANGE', 'PAYMENT', 'STATUS_CHANGE', 'PAYMENT', // dua pembayaran
    ]);
    expect(D.aprs(id).map((x) => `${String(x[CA('Level')])}:${String(x[CA('Action')])}`)).toEqual(['1:APPROVED', '2:APPROVED', '3:APPROVED', '4:APPROVED']);
  });

  it('A10 laporan konsisten: rekap & log pembayaran = Payment Log; aging tidak memuat dokumen lunas', async () => {
    const ag = await laporanAging(D.w.deps, D.A.dani!.s);
    expect(ag.baris.find((b) => b.id === id)).toBeUndefined();
    const rk = await laporanRekap(D.w.deps, D.A.eko!.s, { dari: '2026-10-01', sampai: '2026-10-31', dimensi: 'coa' });
    expect(rk.total).toMatchObject({ jumlah: 1, total: final, dibayar: final, sisa: 0 });
    expect(rk.baris[0]).toMatchObject({ kunci: 'KERTAS A4' });
    const lp = await laporanPembayaran(D.w.deps, D.A.gita!.s, { dari: D.hariIni(), sampai: D.hariIni() });
    expect(lp.total).toBe(final);
    expect(lp.baris.every((b) => b.idTrx === id)).toBe(true);
  });

  it('A11 export Odoo memuat dokumen (pembelian) dan kedua pembayaran', async () => {
    const h = await exportOdoo(D.w.deps, D.A.dani!.s, { dari: '2026-10-01', sampai: '2026-10-31', jenis: 'keduanya' });
    expect([h.jumlahPembelian, h.jumlahPembayaran]).toEqual([1, 2]);
    expect(h.csv).toContain(id);
    expect(h.csv).toContain(`${final}.00`);
    expect(D.w.audit().at(-1)).toMatchObject({ action: 'EXPORT_ODOO', actor: 'dani@contoh.id' });
  });

  it('A12 voucher: kotak TTD L1–L4 tertanda (E-Signed), tanpa kotak CFO & Admin; rekening penuh di voucher, disamarkan di detail', async () => {
    const v = await voucher(D.w.deps, D.A.dani!.s, id);
    expect(v.ttd.map((t) => [t.level, t.isSigned, t.nama])).toEqual([[1, true, 'Citra'], [2, true, 'Budi'], [3, true, 'Dani'], [4, true, 'Eko']]);
    expect(v.ttd.every((t) => t.label === 'E-Signed')).toBe(true);
    expect(v.ttd.some((t) => t.level === 9 || /adm/i.test(t.nama))).toBe(false);
    expect(v.noRekening).toBe('1111222233');
    expect(v.pembayaran.reduce((t, p) => t + p.nominal, 0)).toBe(final);
    const d = await detail(D.w.deps, D.A.citra!.s, id);
    expect(d.noRekening).not.toContain('1111222233');
    expect(d.pembayaran).toMatchObject({ total: final, sisa: 0 });
    expect(d.status).toBe('Paid');
  });
});

// =================================================================== B. >= Rp 5 jt: wajib CFO
describe('E2E B — >= Rp 5 jt: step-up Manager, tanpa kode WA, wajib CFO sebelum bayar', () => {
  let D: Dunia;
  let vendor = '';
  let id = '';
  beforeAll(async () => {
    D = await bangunDunia();
    await D.onboarding();
    vendor = await D.vendorSah(D.A.citra!, D.A.dani!, { nama: 'pt besar dummy', noRekening: '4444555566' });
  });

  it('B1 submit 6 jt -> REQUIRE_CFO=YES; digest WA TIDAK memberi kode; kode paksaan pun ditolak server', async () => {
    id = await D.ajukan(D.A.citra!, vendor, 6_000_000);
    expect(D.row(id)[C('REQUIRE_CFO')]).toBe('YES');
    await kirimDigestManager(D.w.deps, { sod: true, force: true });
    expect(await D.kodeWa(D.A.budi!.phone, id)).toBeNull();
    const paksa = await terbitkanKode(D.w.deps, { phone: D.A.budi!.phone, email: 'budi@contoh.id', idTrx: id, etag: D.etag(id) });
    await D.balasWa(D.A.budi!.phone, `SETUJU ${paksa}`);
    expect(D.lastWa(D.A.budi!.phone)).toContain('harus disetujui lewat web');
    expect(D.status(id)).toBe('Submitted');
  });

  it('B2 Manager approve web tanpa step-up = 403 stepUp; dengan password -> Manager Approved', async () => {
    const e = await galat(D.managerWeb(D.A.budi!, id));
    expect(e).toMatchObject({ code: 'FORBIDDEN', fields: { stepUp: 'required' } });
    expect(D.status(id)).toBe('Submitted');
    expect(await kode(stepUp(D.w.deps, D.A.budi!.token, D.A.budi!.s, { password: 'salah-password-1' }, IP))).toBe('UNAUTHENTICATED');
    expect((await D.managerWeb(D.A.budi!, id, { stepUp: true })).status).toBe('Manager Approved');
  });

  it('B3 verifikasi pajak tetap >= 5 jt -> perluCFO; CFO sebelum Fin. Mgr ditolak', async () => {
    const r = await D.verifPajak(D.A.dani!, id);
    expect(r).toMatchObject({ finalAmount: 6_000_000, perluCFO: true });
    expect(await kode(D.eApprove(D.A.gita!, id, 'cfo'))).toBe('RULE_VIOLATION');
  });

  it('B4 Fin. Mgr (yang juga CFO) menyetujui -> tetap Tax Verified menunggu CFO; orang yang sama tidak bisa jadi CFO', async () => {
    const r = await D.eApprove(D.A.rangkap!, id, 'finmgr');
    expect(r).toMatchObject({ status: 'Tax Verified', menungguCFO: true });
    expect(await kode(D.eApprove(D.A.rangkap!, id, 'cfo'))).toBe('RULE_VIOLATION');
    expect((await D.lonceng(D.A.gita!))['fin-cfo']).toBe(1);
    expect((await D.lonceng(D.A.rangkap!))['fin-cfo']).toBeUndefined(); // tidak ditawari menyetujui dua kali
  });

  it('B5 sebelum CFO: jurnal & bayar diblokir; gerbang I4 (cekBolehDibayar) menyebut CFO', async () => {
    expect(await kode(D.jurnal(D.A.dani!, id))).toBe('RULE_VIOLATION');
    const e = await galat(D.bayarkan(D.A.fina!, id, 6_000_000));
    expect(e.code).toBe('RULE_VIOLATION');
    expect(e.message).toMatch(/Pembayaran diblokir/);
    const st = statusPersetujuan(D.aprs(id).map((x) => ({ level: x[CA('Level')], action: x[CA('Action')], nama: x[CA('Approver_Name')], email: x[CA('Approver_Email')], timestamp: x[CA('Timestamp')] })));
    // seandainya status sudah COA Posted (mis. data diubah manual), gerbang tetap menahan karena CFO belum ada
    expect(cekBolehDibayar({ status: 'COA Posted', perluCFO: true, subCoa: 'KERTAS A4', manager: true, st })).toMatch(/CFO/);
    expect(D.bayarLog(id)).toHaveLength(0);
  });

  it('B6 CFO menyetujui -> Wet Signed -> jurnal -> bayar penuh -> Paid; voucher memuat kotak CFO tertanda', async () => {
    expect((await D.eApprove(D.A.gita!, id, 'cfo')).status).toBe('Wet Signed');
    await D.jurnal(D.A.dani!, id);
    const r = await D.bayarkan(D.A.fina!, id, 6_000_000);
    expect(r.berhasil[0]).toMatchObject({ lunas: true });
    expect(D.status(id)).toBe('Paid');
    const v = await voucher(D.w.deps, D.A.gita!.s, id);
    expect(v.ttd.map((t) => [t.level, t.isSigned])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, true]]);
    expect(v.ttd.find((t) => t.level === 4)!.nama).toBe('Rangkap');
    expect(v.ttd.find((t) => t.level === 5)!.nama).toBe('Gita');
  });
});

// =================================================================== C. tolak / kembalikan
describe('E2E C — jalur tolak & kembalikan', () => {
  let D: Dunia;
  let vendor = '';
  let id = '';
  beforeAll(async () => {
    D = await bangunDunia();
    await D.onboarding();
    vendor = await D.vendorSah(D.A.citra!, D.A.dani!, { nama: 'pt revisi dummy', noRekening: '7777888899' });
  });

  it('C1 Manager menolak (web) -> Revision Needed; PIC melihat lonceng revisi', async () => {
    id = await D.ajukan(D.A.citra!, vendor, 1_000_000);
    expect(await kode(reject(D.w.deps, D.A.budi!.s, id, { etag: D.etag(id), alasan: '' }, D.key()))).toBe('VALIDATION');
    await reject(D.w.deps, D.A.budi!.s, id, { etag: D.etag(id), alasan: 'Nominal tidak sesuai PO' }, D.key());
    expect(D.status(id)).toBe('Revision Needed');
    expect(String(D.row(id)[C('NOTES_FINANCE')])).toContain('Nominal tidak sesuai PO');
    expect((await D.lonceng(D.A.citra!))['pic-revisi']).toBe(1);
  });

  it('C2 PIC mengedit & submit ulang; etag lama Manager ditolak; approve dengan etag baru -> Manager Approved', async () => {
    const lama = D.etag(id);
    await updateDraft(D.w.deps, D.A.citra!.s, id, D.isian(vendor, 1_200_000, { noInvoice: String(D.row(id)[C('NO_INVOICE')]) }));
    await submitPengajuan(D.w.deps, D.A.citra!.s, id, D.key(), true);
    expect(D.status(id)).toBe('Submitted');
    expect(D.row(id)[C('FINAL_AMOUNT')]).toBe(1_200_000);
    expect(await kode(D.managerWeb(D.A.budi!, id, { etag: lama }))).toBe('CONFLICT');
    expect((await D.managerWeb(D.A.budi!, id)).status).toBe('Manager Approved');
    expect((await D.lonceng(D.A.citra!))['pic-revisi']).toBeUndefined();
  });

  it('C3 Finance Staff mengembalikan ke PIC -> Revision Needed; PIC submit ulang -> Manager menyetujui lagi', async () => {
    await kembalikanFinance(D.w.deps, D.A.dani!.s, id, { etag: D.etag(id), alasan: 'Faktur pajak belum dilampirkan' }, D.key());
    expect(D.status(id)).toBe('Revision Needed');
    expect(String(D.row(id)[C('NOTES_FINANCE')])).toMatch(/^\[DITOLAK FINANCE\] Faktur pajak/);
    await D.unggah(D.A.citra!, id); // lampiran pengganti
    await submitPengajuan(D.w.deps, D.A.citra!.s, id, D.key(), true);
    await D.managerWeb(D.A.budi!, id);
    expect(D.status(id)).toBe('Manager Approved');
  });

  it('C4 Fin. Mgr mengembalikan di tahap persetujuan; siklus berikut butuh persetujuan Fin. Mgr BARU (yang lama tidak terbawa)', async () => {
    await D.verifPajak(D.A.dani!, id);
    await kembalikanFinance(D.w.deps, D.A.eko!.s, id, { etag: D.etag(id), alasan: 'Perlu cek ulang' }, D.key());
    expect(D.status(id)).toBe('Revision Needed');
    await submitPengajuan(D.w.deps, D.A.citra!.s, id, D.key(), true);
    await D.managerWeb(D.A.budi!, id);
    await D.verifPajak(D.A.dani!, id);
    expect(D.status(id)).toBe('Tax Verified');
    expect((await D.lonceng(D.A.eko!))['fin-finmgr']).toBe(1);
    expect((await D.eApprove(D.A.eko!, id, 'finmgr')).status).toBe('Wet Signed');
  });

  it('C5 lanjut sampai Paid; voucher memakai persetujuan terakhir tiap level', async () => {
    await D.jurnal(D.A.dani!, id);
    await D.bayarkan(D.A.fina!, id, 1_200_000);
    expect(D.status(id)).toBe('Paid');
    const v = await voucher(D.w.deps, D.A.citra!.s, id);
    expect(v.ttd.map((t) => [t.level, t.isSigned])).toEqual([[1, true], [2, true], [3, true], [4, true]]);
    const aksi = D.aprs(id).map((x) => `${String(x[CA('Level')])}:${String(x[CA('Action')])}`);
    expect(aksi).toEqual(expect.arrayContaining(['2:REJECTED', '3:REJECTED', '4:REJECTED']));
  });

  it('C6 dikembalikan dari Wet Signed lalu diajukan ulang: server menuntut Fin. Mgr menyetujui ULANG (siklus tidak terbawa)', async () => {
    const x = await D.ajukan(D.A.citra!, vendor, 1_000_000);
    await D.managerWeb(D.A.budi!, x); await D.verifPajak(D.A.dani!, x); await D.eApprove(D.A.eko!, x, 'finmgr');
    await kembalikanFinance(D.w.deps, D.A.dani!.s, x, { etag: D.etag(x), alasan: 'Salah COA' }, D.key());
    await submitPengajuan(D.w.deps, D.A.citra!.s, x, D.key(), true);
    await D.managerWeb(D.A.budi!, x); await D.verifPajak(D.A.dani!, x);
    expect(D.status(x)).toBe('Tax Verified');
    expect((await D.lonceng(D.A.eko!))['fin-finmgr']).toBe(1); // Fin. Mgr diminta lagi
    expect(await kode(D.bayarkan(D.A.fina!, x, 1_000_000))).toBe('RULE_VIOLATION');
  });

  /**
   * TEMUAN (defect, bukan kesalahan tes): voucher/kotak TTD memakai `petaPersetujuan` (src/domain/dokumen.ts:53, dipanggil di
   * src/server/dokumen.ts:105) = "APPROVED terakhir per level" TANPA memperhatikan siklus. Setelah dikembalikan & diajukan ulang,
   * kotak Fin. Mgr (L4) tetap "E-Signed" atas nama Eko dari siklus lama, padahal gerbang server (statusPersetujuan, F2-C) menganggapnya
   * batal dan lonceng meminta Fin. Mgr menyetujui ulang. Voucher cetak bisa memperlihatkan tanda tangan yang sudah tidak berlaku.
   * `it.fails` = lulus selama defect masih ada; bila diperbaiki, tes ini merah -> ubah jadi `it` biasa.
   */
  it.fails('C7 [DEFECT] voucher saat menunggu Fin. Mgr ulang tidak boleh menampilkan kotak L4 sebagai sudah ditandatangani', async () => {
    const x = D.w.store.rowsOf(TRX_PENGAJUAN).map((r) => String(r[C('ID_TRX')])).find((i) => D.status(i) === 'Tax Verified')!;
    const v = await voucher(D.w.deps, D.A.citra!.s, x);
    expect(v.ttd.find((t) => t.level === 4)!.isSigned).toBe(false);
  });
});

// =================================================================== D. penjaga
describe('E2E D — penjaga: SoD, lebih bayar, idempotensi, etag basi', () => {
  let D: Dunia;
  let vendor = '';
  beforeAll(async () => {
    D = await bangunDunia();
    await D.onboarding();
    vendor = await D.vendorSah(D.A.citra!, D.A.fina!, { nama: 'pt penjaga dummy', noRekening: '1212343456' });
  });

  it('D1 SoD: pembuat (PIC+Manager) tidak bisa menyetujui dokumennya sendiri (web & WA); Manager lain bisa', async () => {
    const id = await D.ajukan(D.A.dual!, vendor, 1_000_000);
    expect((await inbox(D.w.deps, D.A.dual!.s, true)).map((x) => x.id)).not.toContain(id);
    expect(await kode(D.managerWeb(D.A.dual!, id))).toBe('FORBIDDEN'); // SoD = 403 (sama dengan m5-service)
    expect(D.logs(id)).toContain('APPROVAL_BLOCKED_SOD');
    await kirimDigestManager(D.w.deps, { sod: true, force: true });
    expect(await D.kodeWa(D.A.dual!.phone, id)).toBeNull();
    const paksa = await terbitkanKode(D.w.deps, { phone: D.A.dual!.phone, email: 'dual@contoh.id', idTrx: id, etag: D.etag(id) });
    await D.balasWa(D.A.dual!.phone, `SETUJU ${paksa}`);
    expect(D.status(id)).toBe('Submitted');
    expect((await D.managerWeb(D.A.budi!, id)).status).toBe('Manager Approved');
  });

  it('D2 SoD vendor: pendaftar Finance tidak bisa mengesahkan vendornya sendiri', async () => {
    const v = await daftarVendor(D.w.deps, D.A.dani!.s, { namaVendor: 'pt sendiri dummy', tipeVendor: 'Non-Trade', npwp: '', bank: 'BCA', namaRekening: 'x', noRekening: '5656787890' }, D.key());
    expect(await kode(putuskanVendor(D.w.deps, D.A.dani!.s, v.kode, 'approve', { bank: 'BCA', noRekening: '5656787890' }))).toBe('RULE_VIOLATION');
  });

  it('D3 I5: lebih bayar ditolak (di atas toleransi Rp 1.000), baik sekaligus maupun setelah cicilan', async () => {
    const id = await D.sampaiCoaPosted(vendor, 1_000_000);
    const e = await galat(D.bayarkan(D.A.fina!, id, 1_001_001));
    expect(e.code).toBe('RULE_VIOLATION');
    await D.bayarkan(D.A.fina!, id, 600_000);
    expect(await kode(D.bayarkan(D.A.fina!, id, 401_001))).toBe('RULE_VIOLATION');
    expect(D.bayarLog(id)).toHaveLength(1);
    expect(D.row(id)[C('TOTAL_PAID')]).toBe(600_000);
  });

  it('D4 idempotensi: Idempotency-Key sama dua kali -> satu pembayaran; key berbeda + data kembar -> minta konfirmasi', async () => {
    const id = await D.sampaiCoaPosted(vendor, 2_000_000);
    await D.konfirmasi(D.A.fina!);
    const kk = D.key('dbl');
    const inp = D.inputBayar(id, 500_000, { ref: 'TRF-DBL' });
    const a = await bayar(D.w.deps, D.A.fina!.s, D.A.fina!.token, inp, kk);
    const b = await bayar(D.w.deps, D.A.fina!.s, D.A.fina!.token, inp, kk);
    expect(b).toEqual(a);
    expect(D.bayarLog(id)).toHaveLength(1);
    expect(D.row(id)[C('TOTAL_PAID')]).toBe(500_000);
    // key baru, tanggal+nominal+ref sama dalam 10 menit -> 409 duplikat (R-04), lalu boleh bila dikonfirmasi
    const e = await galat(D.bayarkan(D.A.fina!, id, 500_000, { ref: 'TRF-DBL' }));
    expect(e).toMatchObject({ code: 'CONFLICT', fields: { duplikat: 'konfirmasi' } });
    await D.bayarkan(D.A.fina!, id, 500_000, { ref: 'TRF-DBL', dup: true });
    expect(D.bayarLog(id)).toHaveLength(2);
  });

  it('D5 etag basi ditolak di tiap tahap (approve, pajak, e-approve, jurnal, bayar)', async () => {
    const id = await D.ajukan(D.A.citra!, vendor, 1_500_000);
    const basi = 'A'.repeat(22);
    expect(await kode(D.managerWeb(D.A.budi!, id, { etag: basi }))).toBe('CONFLICT');
    await D.managerWeb(D.A.budi!, id);
    expect(await kode(D.verifPajak(D.A.dani!, id, { etag: basi }))).toBe('CONFLICT');
    await D.verifPajak(D.A.dani!, id);
    await D.konfirmasi(D.A.eko!);
    expect(await kode(setujuiFinance(D.w.deps, D.A.eko!.s, D.A.eko!.token, id, { etag: basi, sebagai: 'finmgr' }, D.key()))).toBe('CONFLICT');
    await D.eApprove(D.A.eko!, id, 'finmgr');
    const lamaJurnal = D.etag(id);
    expect(await kode(jurnalCoa(D.w.deps, D.A.dani!.s, jurnalSchema.parse({ items: [{ id, etag: basi, lvl1: 'BEBAN', lvl2: 'BEBAN OPERASIONAL' }] }), D.key()))).toBe('RULE_VIOLATION');
    expect(D.etag(id)).toBe(lamaJurnal);
    await D.jurnal(D.A.dani!, id);
    // etag yang dipegang sebelum pembayaran pertama sudah basi setelah pembayaran itu
    const sebelum = D.etag(id);
    await D.bayarkan(D.A.fina!, id, 500_000);
    expect(await kode(D.bayarkan(D.A.fina!, id, 500_000, { etag: sebelum, ref: 'X2' }))).toBe('RULE_VIOLATION');
    expect(D.bayarLog(id)).toHaveLength(1);
  });

  it('D6 PIC / Manager tidak bisa memakai jalur Finance; Finance Staff tidak bisa e-approve; tanpa step-up bayar ditolak', async () => {
    const id = await D.sampaiCoaPosted(vendor, 1_100_000);
    expect(await kode(D.bayarkan(D.A.citra!, id, 100_000))).toBe('FORBIDDEN');
    expect(await kode(D.bayarkan(D.A.budi!, id, 100_000))).toBe('FORBIDDEN');
    const t = D.A.dani!;
    expect(await kode(bayar(D.w.deps, t.s, (await D.w.deps.sessions.create(t.s)), D.inputBayar(id, 100_000), D.key()))).toBe('FORBIDDEN'); // sesi baru tanpa step-up
    expect(D.bayarLog(id)).toHaveLength(0);
  });
});
