import { beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_LOG, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { approve, etagOf } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { kirimDigestManager } from '@/server/wa-digest';
import { terbitkanKode } from '@/server/wa-kode';
import { notifPIC } from '@/server/wa-notif';
import { prosesPesan, type PesanMasuk } from '@/server/wa-approval';
import { authWorld, USERS } from './auth-helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);
const PH = { budi: '6281200000001', citra: '6281200000002', fajar: '6281200000009', dual: '6281200000010', eko: '6281200000004', asing: '6289900000000' };
const sess = (o: Partial<SessionData> & Pick<SessionData, 'email' | 'nama' | 'roles'>): SessionData => ({ phone: '6280000000000', jabatan: 'X', created: 0, ep: 0, ...o });
const citra = sess({ email: 'citra@x.id', nama: 'Citra', phone: PH.citra, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
const dual = sess({ email: 'dual@x.id', nama: 'Dual', phone: PH.dual, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
const budi = sess({ email: 'budi@x.id', nama: 'Budi', phone: PH.budi, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });

let w: ReturnType<typeof authWorld>;
let n = 0, mid = 0;
const trx = (): RawRow[] => w.store.rowsOf(TRX_PENGAJUAN);
const rowOf = (id: string): RawRow => trx().find((r) => r[C('ID_TRX')] === id)!;
const status = (id: string): string => String(rowOf(id)[C('STATUS')]);
const setCell = (id: string, k: string, v: string | number): void => w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { if (r[C('ID_TRX')] === id) r[C(k)] = v; return r; }));
const aprs = (id: string): RawRow[] => w.store.rowsOf(TRX_APPROVAL).filter((r) => r[CA('ID_Trx')] === id);
const logs = (id: string): RawRow[] => w.store.rowsOf(AUDIT_LOG).filter((r) => r[CL('ID_Trx')] === id);
const kodeDi = async (phone: string, id: string): Promise<string> => (await w.redis.get(`wa:d:${phone}:${id}`))!;
const to = (phone: string): string[] => w.wa.sent.filter((m) => m.to === phone).map((m) => m.text);
const lastTo = (phone: string): string => to(phone).at(-1) ?? '';

async function submitted(by: SessionData = citra, amount = 1_000_000): Promise<string> {
  const r = await createDraft(w.deps, by, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: `INV-${++n}`, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  setCell(r.id, 'FILE_URL', 'https://drive.google.com/file/d/abc/view');
  await submitPengajuan(w.deps, by, r.id, `idem-m6-${String(++n).padStart(8, '0')}`, true);
  return r.id;
}
const pesan = (nomor: string, teks: string, o: Partial<PesanMasuk> = {}): PesanMasuk => ({ id: `MSG${String(++mid).padStart(6, '0')}`, nomor, teks, tsMs: w.clock.now() - 1_000, ...o });
const kirim = (p: PesanMasuk): Promise<void> => prosesPesan(w.deps, p, true);

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [
    ...USERS,
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Fajar', 'fajar@x.id', 'YES', '081200000009', null, null],
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ['BRAND B', 'DEPT Y', 2, 'Manager', 'Bunga', 'bb@x.id', 'YES', '081200000011', null, null],
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],
  ]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL'], ['PT B', 'BRAND B', '', '', 'HM']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('digest manager', () => {
  it('tiap manager berwenang dapat satu ringkasan; < 5 jt ada kode, >= 5 jt TANPA kode; manager divisi lain tidak dapat', async () => {
    const kecil = await submitted(citra, 1_000_000), besar = await submitted(citra, 7_500_000);
    const r = await kirimDigestManager(w.deps, { sod: true });
    expect(r).toMatchObject({ dokumen: 2, manager: 3, terkirim: 3, gagal: 0 }); // budi, fajar, dual
    for (const p of [PH.budi, PH.fajar, PH.dual]) {
      expect(to(p)).toHaveLength(1);
      const t = lastTo(p);
      expect(t).toContain(kecil); expect(t).toContain(besar);
      expect(t.match(/SETUJU \d{4}/g)).toHaveLength(1);
      expect(await kodeDi(p, kecil)).toMatch(/^\d{4}$/);
      expect(await w.redis.get(`wa:d:${p}:${besar}`)).toBeNull(); // I14: tidak ada kode untuk >= 5 jt
    }
    expect(to('6281200000011')).toHaveLength(0);
  });
  it('SoD: pembuat yang juga manager tidak menerima kode untuk dokumennya sendiri', async () => {
    const own = await submitted(dual, 1_000_000);
    await kirimDigestManager(w.deps, { sod: true });
    expect(await w.redis.get(`wa:d:${PH.dual}:${own}`)).toBeNull();
    expect(lastTo(PH.dual)).toBe(''); // satu-satunya dokumen miliknya -> tak ada ringkasan
    expect(await kodeDi(PH.budi, own)).toMatch(/^\d{4}$/);
  });
  it('dijalankan ulang: kode dipakai ulang bila dokumen tak berubah; dokumen berubah -> kode baru & kode lama dicabut', async () => {
    const id = await submitted();
    await kirimDigestManager(w.deps, { sod: true, force: true });
    const k1 = await kodeDi(PH.budi, id);
    await kirimDigestManager(w.deps, { sod: true, force: true });
    expect(await kodeDi(PH.budi, id)).toBe(k1);
    setCell(id, 'INV_AMOUNT', 2_000_000);
    await kirimDigestManager(w.deps, { sod: true, force: true });
    const k2 = await kodeDi(PH.budi, id);
    expect(k2).not.toBe(k1);
    w.wa.sent.length = 0;
    await kirim(pesan(PH.budi, `SETUJU ${k1}`));
    expect(lastTo(PH.budi)).toContain('tidak ditemukan'); expect(status(id)).toBe('Submitted');
  });
  it('dua pemicu berdempetan: yang kedua dilewati (tak ada pesan ganda)', async () => {
    await submitted();
    await kirimDigestManager(w.deps, { sod: true });
    const n1 = w.wa.sent.length;
    const r2 = await kirimDigestManager(w.deps, { sod: true });
    expect(r2.dilewati).toBeTruthy(); expect(w.wa.sent).toHaveLength(n1);
  });
  it('gagal kirim WA tidak melempar (I15) dan dihitung; status dokumen tak berubah', async () => {
    const id = await submitted();
    w.wa.failNext = true;
    const r = await kirimDigestManager(w.deps, { sod: true });
    expect(r.gagal).toBe(1); expect(status(id)).toBe('Submitted');
  });
  it('tanpa dokumen menunggu: tidak mengirim apa pun', async () => {
    expect((await kirimDigestManager(w.deps, { sod: true })).dilewati).toBeTruthy(); expect(w.wa.sent).toHaveLength(0);
  });
});

describe('balasan SETUJU / TOLAK via WA', () => {
  const siap = async (amount = 1_000_000, by: SessionData = citra) => {
    const id = await submitted(by, amount);
    await kirimDigestManager(w.deps, { sod: true, force: true });
    w.wa.sent.length = 0;
    return id;
  };
  it('SETUJU: Manager Approved; Trx_Approval Method=WA; audit "Level 2 (WA)"; balasan ke manager; notif ke PIC; kode sekali pakai', async () => {
    const id = await siap();
    const k = await kodeDi(PH.budi, id);
    await kirim(pesan(PH.budi, `SETUJU ${k}`));
    expect(status(id)).toBe('Manager Approved');
    const a = aprs(id).filter((x) => Number(x[CA('Level')]) === 2);
    expect(a).toHaveLength(1);
    expect(a[0]![CA('Method')]).toBe('WA'); expect(String(a[0]![CA('Notes')])).toContain('[via WhatsApp]');
    expect(logs(id).some((x) => x[CL('Field')] === 'Level 2 (WA)' && x[CL('Action')] === 'APPROVAL')).toBe(true);
    expect(lastTo(PH.budi)).toContain('berhasil disetujui');
    expect(lastTo(PH.citra)).toContain('disetujui Manager');
    w.wa.sent.length = 0;
    await kirim(pesan(PH.budi, `SETUJU ${k}`));
    expect(lastTo(PH.budi)).toContain('sudah dipakai'); expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
  });
  it('TOLAK dengan alasan: Revision Needed, NOTES_FINANCE berawalan WA, PIC dikabari alasan', async () => {
    const id = await siap();
    await kirim(pesan(PH.budi, `TOLAK ${await kodeDi(PH.budi, id)} Lampiran buram`));
    expect(status(id)).toBe('Revision Needed');
    expect(rowOf(id)[C('NOTES_FINANCE')]).toBe('[DITOLAK MANAGER via WA] Lampiran buram');
    expect(aprs(id).find((x) => x[CA('Action')] === 'REJECTED')![CA('Method')]).toBe('WA');
    expect(lastTo(PH.citra)).toContain('Lampiran buram');
  });
  it('TOLAK tanpa alasan: dibalas petunjuk, dokumen & kode tak berubah (kode tetap bisa dipakai)', async () => {
    const id = await siap();
    const k = await kodeDi(PH.budi, id);
    await kirim(pesan(PH.budi, `TOLAK ${k}`));
    expect(lastTo(PH.budi)).toContain('sertakan alasan'); expect(status(id)).toBe('Submitted');
    await kirim(pesan(PH.budi, `SETUJU ${k}`)); expect(status(id)).toBe('Manager Approved');
  });
  it('I14: kode untuk dokumen >= 5 jt (dibuat paksa) TETAP ditolak di server; status tak berubah', async () => {
    const id = await submitted(citra, 7_500_000);
    const k = await terbitkanKode(w.deps, { phone: PH.budi, email: 'budi@x.id', idTrx: id, etag: etagOf(rowOf(id)) });
    await kirim(pesan(PH.budi, `SETUJU ${k}`));
    expect(lastTo(PH.budi)).toContain('harus disetujui lewat web'); expect(status(id)).toBe('Submitted'); expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(0);
  });
  it('batas tepat 5.000.000 juga ditolak (>=), 4.999.999 diterima', async () => {
    const a = await submitted(citra, 5_000_000), b = await submitted(citra, 4_999_999);
    const ka = await terbitkanKode(w.deps, { phone: PH.budi, email: 'budi@x.id', idTrx: a, etag: etagOf(rowOf(a)) });
    const kb = await terbitkanKode(w.deps, { phone: PH.budi, email: 'budi@x.id', idTrx: b, etag: etagOf(rowOf(b)) });
    await kirim(pesan(PH.budi, `SETUJU ${ka}`)); await kirim(pesan(PH.budi, `SETUJU ${kb}`));
    expect(status(a)).toBe('Submitted'); expect(status(b)).toBe('Manager Approved');
  });
  it('dokumen berubah setelah digest (etag basi): ditolak CONFLICT, tidak menyetujui versi lain', async () => {
    const id = await siap();
    const k = await kodeDi(PH.budi, id);
    setCell(id, 'INV_AMOUNT', 4_000_000); setCell(id, 'FINAL_AMOUNT', 4_000_000);
    await kirim(pesan(PH.budi, `SETUJU ${k}`));
    expect(lastTo(PH.budi)).toContain('sudah berubah'); expect(status(id)).toBe('Submitted');
  });
  it('sudah disetujui lewat web oleh manager lain: balasan "sudah diproses", tak ada approval ganda', async () => {
    const id = await siap();
    const kF = await kodeDi(PH.fajar, id);
    const fajar = sess({ email: 'fajar@x.id', nama: 'Fajar', phone: PH.fajar, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
    await approve(w.deps, budi, await w.deps.sessions.create(budi), id, { etag: etagOf(rowOf(id)) }, 'idem-web-00000001', true);
    await kirim(pesan(PH.fajar, `SETUJU ${kF}`));
    expect(lastTo(PH.fajar)).toContain('sudah berubah atau sudah diproses');
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
    void fajar;
  });
  it('dua manager membalas SETUJU bersamaan: tepat satu berhasil', async () => {
    const id = await siap();
    const [kb, kf] = [await kodeDi(PH.budi, id), await kodeDi(PH.fajar, id)];
    await Promise.all([kirim(pesan(PH.budi, `SETUJU ${kb}`)), kirim(pesan(PH.fajar, `SETUJU ${kf}`))]);
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
    expect(status(id)).toBe('Manager Approved');
  });
  it('SoD lewat WA: pembuat (juga manager) yang memegang kode untuk dokumennya sendiri ditolak', async () => {
    const id = await submitted(dual, 1_000_000);
    const k = await terbitkanKode(w.deps, { phone: PH.dual, email: 'dual@x.id', idTrx: id, etag: etagOf(rowOf(id)) });
    await kirim(pesan(PH.dual, `SETUJU ${k}`));
    expect(lastTo(PH.dual)).toContain('pembuat dokumen'); expect(status(id)).toBe('Submitted');
  });
  it('kode terikat nomor: manager lain memakai kode milik Budi -> "tidak ditemukan"; 10 salah -> terkunci', async () => {
    const id = await siap();
    const k = await kodeDi(PH.budi, id);
    await kirim(pesan(PH.fajar, `SETUJU ${k}`));
    expect(lastTo(PH.fajar)).toContain('tidak ditemukan'); expect(status(id)).toBe('Submitted');
    for (let i = 0; i < 9; i++) await kirim(pesan(PH.fajar, `SETUJU ${String(1000 + i)}`));
    w.wa.sent.length = 0;
    await kirim(pesan(PH.fajar, `SETUJU ${await kodeDi(PH.fajar, id)}`)); // kode benar pun ditahan saat terkunci
    expect(lastTo(PH.fajar)).toContain('Terlalu banyak'); expect(status(id)).toBe('Submitted');
  });
  it('pengirim bukan Manager (kode dibuat paksa) ditolak', async () => {
    const id = await submitted();
    const k = await terbitkanKode(w.deps, { phone: PH.citra, email: 'citra@x.id', idTrx: id, etag: etagOf(rowOf(id)) });
    await kirim(pesan(PH.citra, `SETUJU ${k}`));
    expect(lastTo(PH.citra)).toContain('bukan Manager'); expect(status(id)).toBe('Submitted');
  });
  it('replay: message id sama dua kali -> diproses sekali, satu balasan', async () => {
    const id = await siap();
    const p = pesan(PH.budi, `SETUJU ${await kodeDi(PH.budi, id)}`);
    await kirim(p); const n1 = w.wa.sent.length; await kirim(p);
    expect(w.wa.sent).toHaveLength(n1); expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
  });
  it('pesan kedaluwarsa (> 10 menit), tanpa timestamp, atau dari masa depan: diabaikan diam-diam', async () => {
    const id = await siap();
    const k = await kodeDi(PH.budi, id);
    for (const tsMs of [w.clock.now() - 11 * 60_000, NaN, w.clock.now() + 5 * 60_000]) await kirim(pesan(PH.budi, `SETUJU ${k}`, { tsMs }));
    expect(w.wa.sent).toHaveLength(0); expect(status(id)).toBe('Submitted');
  });
  it('nomor tak dikenal / akun nonaktif: diam (tidak membalas, tidak jadi oracle)', async () => {
    await siap();
    await kirim(pesan(PH.asing, 'SETUJU 1234')); await kirim(pesan(PH.eko, 'SETUJU 1234'));
    expect(w.wa.sent).toHaveLength(0);
  });
  it('format salah & OTP lama dibalas petunjuk', async () => {
    await kirim(pesan(PH.budi, 'halo bot')); expect(lastTo(PH.budi)).toContain('Format tidak dikenali');
    await kirim(pesan(PH.budi, '123456')); expect(lastTo(PH.budi)).toContain('OTP email sudah tidak dipakai');
  });
  it('gagal kirim balasan tidak mengubah hasil; galat tak terduga -> dead-letter + balasan umum', async () => {
    const id = await siap();
    w.wa.failNext = true;
    await kirim(pesan(PH.budi, `SETUJU ${await kodeDi(PH.budi, id)}`));
    expect(status(id)).toBe('Manager Approved');
    const rusak = { ...w.deps, store: new Proxy(w.deps.store, { get: (t, p) => (p === 'readRows' ? async () => { throw new Error('sheet meledak'); } : (t as never)[p as never]) }) } as typeof w.deps;
    const p = pesan(PH.budi, 'SETUJU 1234');
    await prosesPesan(rusak, p, true);
    expect(await w.redis.get(`wa:dlq:${p.id}`)).toContain('sheet meledak');
    expect(Number(await w.redis.get('wa:dlq:count'))).toBe(1);
    expect(lastTo(PH.budi)).toContain('kesalahan');
  });
});

describe('notifPIC', () => {
  it('dikirim sekali per transisi (dedup); gagal kirim / PIC tanpa akun tidak melempar', async () => {
    const id = await submitted();
    await approve(w.deps, budi, await w.deps.sessions.create(budi), id, { etag: etagOf(rowOf(id)) }, 'idem-web-00000002', true);
    await notifPIC(w.deps, { idTrx: id, jenis: 'disetujui', catatan: 'ok' });
    await notifPIC(w.deps, { idTrx: id, jenis: 'disetujui', catatan: 'ok' });
    expect(to(PH.citra)).toHaveLength(1);
    w.wa.failNext = true;
    await expect(notifPIC(w.deps, { idTrx: id, jenis: 'dikembalikan', catatan: 'x' })).resolves.toBeUndefined();
    await expect(notifPIC(w.deps, { idTrx: 'NTR-99999', jenis: 'disetujui' })).resolves.toBeUndefined();
  });
});
