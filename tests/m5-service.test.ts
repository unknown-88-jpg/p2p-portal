import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { RawRow } from '@/ports/store';
import { createDraft, submitPengajuan, updateDraft } from '@/server/pengajuan';
import { approve, etagOf, inbox, reject } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { authWorld, USERS } from './auth-helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const CA = (k: string): number => colIndex(TRX_APPROVAL, k);
const CL = (k: string): number => colIndex(AUDIT_LOG, k);

const sess = (o: Partial<SessionData> & Pick<SessionData, 'email' | 'nama' | 'roles'>): SessionData => ({ phone: '6280000000000', jabatan: 'X', created: 0, ep: 0, ...o });
const citra = sess({ email: 'citra@x.id', nama: 'Citra', phone: '6281200000002', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND B', dept: 'DEPT Y', level: 1 }] });
const budi = sess({ email: 'budi@x.id', nama: 'Budi', jabatan: 'Manager', phone: '6281200000001', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
const fajar = sess({ email: 'fajar@x.id', nama: 'Fajar', jabatan: 'Manager', phone: '6281200000009', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
const dual = sess({ email: 'dual@x.id', nama: 'Dual', jabatan: 'Manager+PIC', phone: '6281200000010', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });
const mgrB = sess({ email: 'bb@x.id', nama: 'Bunga', phone: '6281200000011', roles: [{ brand: 'BRAND B', dept: 'DEPT Y', level: 2 }] });
const finance = sess({ email: 'dani@x.id', nama: 'Dani', phone: '6281200000003', roles: [{ brand: 'ALL', dept: 'ALL', level: 3 }] });

let w: ReturnType<typeof authWorld>;
let n = 0;
const key = (): string => `idem-m5-${String(++n).padStart(8, '0')}`;
const trx = (): RawRow[] => w.store.rowsOf(TRX_PENGAJUAN);
const rowOf = (id: string): RawRow => trx().find((r) => r[C('ID_TRX')] === id)!;
const aprs = (id?: string): RawRow[] => w.store.rowsOf(TRX_APPROVAL).filter((r) => !id || r[CA('ID_Trx')] === id);
const logs = (id: string): RawRow[] => w.store.rowsOf(AUDIT_LOG).filter((r) => r[CL('ID_Trx')] === id);
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'OK'; } catch (e) { return e instanceof AppError ? e.code : `ERR:${String(e)}`; } };
const setCell = (id: string, k: string, v: string | number): void => w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { if (r[C('ID_TRX')] === id) r[C(k)] = v; return r; }));

/** Buat dokumen berstatus Submitted lewat alur asli (create -> lampiran -> submit). */
async function submitted(by: SessionData = citra, amount = 1_000_000, inv = `INV-${++n}`, brand = 'BRAND A', dept = 'DEPT X'): Promise<string> {
  const r = await createDraft(w.deps, by, { tipe: 'Non-Trade', brand, departement: dept, description: 'Beli kertas', vendorKode: 'V3', noInvoice: inv, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  setCell(r.id, 'FILE_URL', 'https://drive.google.com/file/d/abc/view');
  await submitPengajuan(w.deps, by, r.id, key(), true);
  return r.id;
}
const etag = (id: string): string => etagOf(rowOf(id));
const withStepUp = async (s: SessionData): Promise<string> => { const t = await w.deps.sessions.create(s); await w.deps.sessions.markStepUp(t); return t; };
const noStepUp = async (s: SessionData): Promise<string> => w.deps.sessions.create(s);

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [
    ...USERS,
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Fajar', 'fajar@x.id', 'YES', '081200000009', null, null],
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ['BRAND B', 'DEPT Y', 2, 'Manager', 'Bunga', 'bb@x.id', 'YES', '081200000011', null, null],
    ['BRAND B', 'DEPT Y', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],
  ]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL'], ['PT B', 'BRAND B', '', '', 'HM']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('approve — jalur sah', () => {
  it('Submitted -> Manager Approved; baris Trx_Approval L2 + dua baris audit + penanda SoD; LAST_UPDATE berubah', async () => {
    const id = await submitted();
    const before = rowOf(id)[C('LAST_UPDATE')];
    const r = await approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id), notes: 'ok lanjut' }, key(), true);
    expect(r).toMatchObject({ id, status: 'Manager Approved', finalAmount: 1_000_000, perluCFO: false });
    expect(rowOf(id)[C('STATUS')]).toBe('Manager Approved');
    expect(rowOf(id)[C('LAST_UPDATE')]).not.toBe(before);
    const a = aprs(id).filter((x) => Number(x[CA('Level')]) === 2);
    expect(a).toHaveLength(1);
    expect(a[0]![CA('Action')]).toBe('APPROVED');
    expect(a[0]![CA('Role_Label')]).toBe('Diperiksa Oleh,');
    expect(a[0]![CA('Approver_Email')]).toBe('budi@x.id');
    expect(String(a[0]![CA('Notes')])).toContain('ok lanjut');
    expect(String(a[0]![CA('Notes')])).toContain('[Portal-HP]');
    const l = logs(id).filter((x) => ['STATUS_CHANGE', 'APPROVAL'].includes(String(x[CL('Action')])));
    expect(l.map((x) => String(x[CL('Action')]))).toEqual(expect.arrayContaining(['STATUS_CHANGE', 'APPROVAL']));
    expect(l.some((x) => String(x[CL('Notes')]).includes('SoD: approver bukan pembuat'))).toBe(true);
  });
  it('Manager divisi yang berwenang (ALL/ALL) boleh; nominal < 5 jt tidak butuh step-up', async () => {
    const id = await submitted(citra, 4_999_999);
    const boss = sess({ email: 'boss@x.id', nama: 'Boss', roles: [{ brand: 'ALL', dept: 'ALL', level: 2 }] });
    expect(await code(approve(w.deps, boss, await noStepUp(boss), id, { etag: etag(id) }, key(), true))).toBe('OK');
  });
});

describe('approve — penolakan', () => {
  it('wajib Idempotency-Key (aksi uang)', async () => {
    const id = await submitted();
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, undefined, true))).toBe('VALIDATION');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
  });
  it('bukan Manager (PIC / Finance) => FORBIDDEN; Manager divisi lain => NOT_FOUND (tidak bocor)', async () => {
    const id = await submitted();
    expect(await code(approve(w.deps, citra, await noStepUp(citra), id, { etag: etag(id) }, key(), true))).toBe('FORBIDDEN');
    expect(await code(approve(w.deps, finance, await noStepUp(finance), id, { etag: etag(id) }, key(), true))).toBe('FORBIDDEN');
    expect(await code(approve(w.deps, mgrB, await noStepUp(mgrB), id, { etag: etag(id) }, key(), true))).toBe('NOT_FOUND');
    expect(await code(approve(w.deps, budi, await noStepUp(budi), 'NTR-99999', { etag: 'x'.repeat(22) }, key(), true))).toBe('NOT_FOUND');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(0);
  });
  it('I3: status selain Submitted (Draft, Manager Approved, Revision) => CONFLICT, tidak ada baris baru', async () => {
    const draft = (await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'x', vendorKode: 'V3', noInvoice: 'DRAFT-1', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1000, statusPPN: 'Non PPN' })).id;
    expect(await code(approve(w.deps, budi, await noStepUp(budi), draft, { etag: etag(draft) }, key(), true))).toBe('CONFLICT');
    const id = await submitted();
    await approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, key(), true);
    const apr = aprs().length;
    expect(await code(approve(w.deps, fajar, await noStepUp(fajar), id, { etag: etag(id) }, key(), true))).toBe('CONFLICT');
    expect(await code(reject(w.deps, fajar, id, { etag: etag(id), alasan: 'terlambat' }, key()))).toBe('CONFLICT');
    expect(aprs()).toHaveLength(apr);
    setCell(id, 'STATUS', 'Revision Needed');
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, key(), true))).toBe('CONFLICT');
  });
  it('etag usang / ngawur => CONFLICT; dokumen yang diubah setelah dilihat tidak bisa di-approve versi lama', async () => {
    const id = await submitted();
    const lama = etag(id);
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: 'A'.repeat(22) }, key(), true))).toBe('CONFLICT');
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: '' }, key(), true))).toBe('CONFLICT');
    // skenario TOCTOU: ditolak -> PIC ubah nominal -> submit ulang; manager lain masih memegang tampilan lama
    await reject(w.deps, fajar, id, { etag: lama, alasan: 'nominal salah' }, key());
    await updateDraft(w.deps, citra, id, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-X', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 4_900_000, statusPPN: 'Non PPN' });
    await submitPengajuan(w.deps, citra, id, key(), true);
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    expect(etag(id)).not.toBe(lama);
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: lama }, key(), true))).toBe('CONFLICT');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, key(), true))).toBe('OK');
  });
});

describe('I14 sisi web — step-up password', () => {
  it('>= Rp 5 jt tanpa step-up => FORBIDDEN {stepUp:required}, status & approval tak berubah; setelah step-up => OK', async () => {
    const id = await submitted(citra, 5_000_000);
    const t = await noStepUp(budi);
    const e = await approve(w.deps, budi, t, id, { etag: etag(id) }, key(), true).catch((x: unknown) => x as AppError);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('FORBIDDEN');
    expect(JSON.stringify((e as AppError).fields ?? {})).toContain('stepUp');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(0);
    await w.deps.sessions.markStepUp(t);
    expect(await code(approve(w.deps, budi, t, id, { etag: etag(id) }, key(), true))).toBe('OK');
  });
  it('tepat 5.000.000 wajib step-up; 4.999.999 tidak (batas dari nominal tersimpan)', async () => {
    const a = await submitted(citra, 4_999_999);
    expect(await code(approve(w.deps, budi, await noStepUp(budi), a, { etag: etag(a) }, key(), true))).toBe('OK');
    const b = await submitted(citra, 5_000_000);
    expect(await code(approve(w.deps, budi, await noStepUp(budi), b, { etag: etag(b) }, key(), true))).toBe('FORBIDDEN');
    expect(await code(approve(w.deps, budi, await withStepUp(budi), b, { etag: etag(b) }, key(), true))).toBe('OK');
  });
  it('step-up milik sesi lain tidak berlaku untuk sesi ini', async () => {
    const id = await submitted(citra, 9_000_000);
    await withStepUp(fajar);
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, key(), true))).toBe('FORBIDDEN');
  });
  it('nominal dibaca dari server: dokumen CFO tanpa step-up ditolak walau klien tidak mengirim nominal apa pun', async () => {
    const id = await submitted(citra, 12_000_000);
    expect(rowOf(id)[C('REQUIRE_CFO')]).toBe('YES');
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id), notes: 'nominal 1000' }, key(), true))).toBe('FORBIDDEN');
  });
  it('tolak (Revision) tidak butuh step-up walau nominal besar', async () => {
    const id = await submitted(citra, 12_000_000);
    expect(await code(reject(w.deps, budi, id, { etag: etag(id), alasan: 'lampiran buram' }, key()))).toBe('OK');
  });
});

describe('O5a — approver != pembuat', () => {
  it('pembuat yang juga Manager: approve ditolak FORBIDDEN, dicatat APPROVAL_BLOCKED_SOD, status tetap Submitted', async () => {
    const id = await submitted(dual);
    expect(await code(approve(w.deps, dual, await noStepUp(dual), id, { etag: etag(id) }, key(), true))).toBe('FORBIDDEN');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(0);
    expect(logs(id).some((x) => x[CL('Action')] === 'APPROVAL_BLOCKED_SOD')).toBe(true);
    // Manager lain tetap bisa
    expect(await code(approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, key(), true))).toBe('OK');
  });
  it('flag OFF: self-approval jalan, tetapi Audit_Log memuat penanda SELF-APPROVAL', async () => {
    const id = await submitted(dual);
    expect(await code(approve(w.deps, dual, await noStepUp(dual), id, { etag: etag(id) }, key(), false))).toBe('OK');
    expect(logs(id).some((x) => String(x[CL('Notes')]).includes('SELF-APPROVAL'))).toBe(true);
  });
  it('submit: divisi tanpa Manager selain pembuat => RULE_VIOLATION saat flag ON; OFF => boleh', async () => {
    w.store.seed(MASTER_USER_TTD, [
      ['BRAND A', 'DEPT X', 1, 'PIC', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
      ['BRAND A', 'DEPT X', 2, 'Manager', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ]);
    const mk = async (inv: string) => { const r = await createDraft(w.deps, dual, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'x', vendorKode: 'V3', noInvoice: inv, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1000, statusPPN: 'Non PPN' }); setCell(r.id, 'FILE_URL', 'https://drive.google.com/file/d/abc/view'); return r.id; };
    const a = await mk('S-1');
    expect(await code(submitPengajuan(w.deps, dual, a, key(), true))).toBe('RULE_VIOLATION');
    expect(rowOf(a)[C('STATUS')]).toBe('Draft');
    const b = await mk('S-2');
    expect(await code(submitPengajuan(w.deps, dual, b, key(), false))).toBe('OK');
  });
  it('Manager nonaktif tidak dihitung sebagai "Manager lain" saat submit', async () => {
    w.store.seed(MASTER_USER_TTD, [
      ['BRAND A', 'DEPT X', 1, 'PIC', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
      ['BRAND A', 'DEPT X', 2, 'Manager', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
      ['BRAND A', 'DEPT X', 2, 'Manager', 'Budi', 'budi@x.id', 'NO', '081200000001', null, null],
    ]);
    const r = await createDraft(w.deps, dual, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'x', vendorKode: 'V3', noInvoice: 'N-1', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1000, statusPPN: 'Non PPN' });
    setCell(r.id, 'FILE_URL', 'https://drive.google.com/file/d/abc/view');
    expect(await code(submitPengajuan(w.deps, dual, r.id, key(), true))).toBe('RULE_VIOLATION');
  });
});

describe('reject (kembalikan ke PIC)', () => {
  it('alasan wajib; hasil: Revision Needed + NOTES_FINANCE + approval REJECTED + audit; PIC bisa edit & ajukan ulang', async () => {
    const id = await submitted();
    expect(await code(reject(w.deps, budi, id, { etag: etag(id), alasan: '   ' }, key()))).toBe('VALIDATION');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    const r = await reject(w.deps, budi, id, { etag: etag(id), alasan: 'Lampiran buram' }, key());
    expect(r).toMatchObject({ id, status: 'Revision Needed' });
    expect(rowOf(id)[C('STATUS')]).toBe('Revision Needed');
    expect(rowOf(id)[C('NOTES_FINANCE')]).toBe('[DITOLAK MANAGER] Lampiran buram');
    const a = aprs(id).filter((x) => Number(x[CA('Level')]) === 2);
    expect(a).toHaveLength(1);
    expect(a[0]![CA('Action')]).toBe('REJECTED');
    expect(logs(id).filter((x) => x[CL('Action')] === 'APPROVAL' && x[CL('New_Value')] === 'REJECTED')).toHaveLength(1);
    // PIC memperbaiki lalu mengajukan lagi (siklus revisi tetap utuh)
    await updateDraft(w.deps, citra, id, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-REV', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN' });
    expect(await code(submitPengajuan(w.deps, citra, id, key(), true))).toBe('OK');
  });
  it('bukan Manager / divisi lain ditolak; PIC pembuat tak bisa menolak dokumennya sendiri lewat jalur ini', async () => {
    const id = await submitted();
    expect(await code(reject(w.deps, citra, id, { etag: etag(id), alasan: 'x ' }, key()))).toBe('FORBIDDEN');
    expect(await code(reject(w.deps, mgrB, id, { etag: etag(id), alasan: 'x x' }, key()))).toBe('NOT_FOUND');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
  });
});

describe('inbox', () => {
  it('hanya Submitted milik divisi berwenang, tertua dulu; ada etag, butuhStepUp, terkunci; email pembuat tidak bocor', async () => {
    const a = await submitted(citra, 1_000_000, 'I-A');
    const b = await submitted(dual, 6_000_000, 'I-B');
    await submitted(citra, 2_000_000, 'I-C', 'BRAND B', 'DEPT Y'); // divisi lain
    const draft = await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'x', vendorKode: 'V3', noInvoice: 'I-D', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1, statusPPN: 'Non PPN' });
    const items = await inbox(w.deps, budi, true);
    expect(items.map((i) => i.id)).toEqual([a, b]);
    expect(items.map((i) => i.id)).not.toContain(draft.id);
    expect(items[0]).toMatchObject({ etag: etag(a), butuhStepUp: false, terkunci: null, perluCFO: false, punyaLampiran: true });
    expect(items[1]).toMatchObject({ butuhStepUp: true, perluCFO: true });
    const forDual = await inbox(w.deps, dual, true);
    expect(forDual.find((i) => i.id === b)).toBeUndefined(); // M8 F-05: dokumen buatan sendiri tidak masuk antrean
    expect(forDual.find((i) => i.id === a)!.terkunci).toBeNull();
    expect(JSON.stringify(items)).not.toContain('citra@x.id');
    expect(JSON.stringify(items)).not.toContain('FILE_URL');
    expect(JSON.stringify(items)).not.toContain('drive.google.com');
  });
  it('non-Manager => FORBIDDEN; Manager divisi lain tak melihat dokumen ini', async () => {
    await submitted();
    expect(await code(inbox(w.deps, citra))).toBe('FORBIDDEN');
    expect(await inbox(w.deps, mgrB, true)).toHaveLength(0);
  });
  it('dokumen yang sudah di-approve hilang dari inbox', async () => {
    const id = await submitted();
    await approve(w.deps, budi, await noStepUp(budi), id, { etag: etag(id) }, key(), true);
    expect(await inbox(w.deps, budi, true)).toHaveLength(0);
  });
});

describe('konkurensi & idempotensi (exit M5)', () => {
  it('dua Manager approve dokumen yang sama bersamaan => tepat satu berhasil, satu CONFLICT; hanya SATU baris approval L2', async () => {
    const id = await submitted();
    const e = etag(id);
    const [t1, t2] = [await noStepUp(budi), await noStepUp(fajar)];
    const res = await Promise.all([
      code(approve(w.deps, budi, t1, id, { etag: e }, key(), true)),
      code(approve(w.deps, fajar, t2, id, { etag: e }, key(), true)),
    ]);
    expect(res.filter((x) => x === 'OK')).toHaveLength(1);
    expect(res.filter((x) => x === 'CONFLICT')).toHaveLength(1);
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2 && x[CA('Action')] === 'APPROVED')).toHaveLength(1);
    expect(rowOf(id)[C('STATUS')]).toBe('Manager Approved');
  });
  it('approve vs tolak bersamaan => tepat satu menang; status konsisten dengan baris approval', async () => {
    const id = await submitted();
    const e = etag(id);
    const res = await Promise.all([
      code(approve(w.deps, budi, await noStepUp(budi), id, { etag: e }, key(), true)),
      code(reject(w.deps, fajar, id, { etag: e, alasan: 'salah vendor' }, key())),
    ]);
    expect(res.filter((x) => x === 'OK')).toHaveLength(1);
    const l2 = aprs(id).filter((x) => Number(x[CA('Level')]) === 2);
    expect(l2).toHaveLength(1);
    expect(rowOf(id)[C('STATUS')]).toBe(l2[0]![CA('Action')] === 'APPROVED' ? 'Manager Approved' : 'Revision Needed');
  });
  it('20 klik paralel dengan Idempotency-Key yang SAMA => tepat satu approval tertulis', async () => {
    const id = await submitted();
    const e = etag(id); const t = await noStepUp(budi); const k = key();
    const res = await Promise.all(Array.from({ length: 20 }, () => approve(w.deps, budi, t, id, { etag: e }, k, true).then(() => 'OK', (x: unknown) => (x instanceof AppError ? x.code : 'ERR'))));
    expect(res.filter((x) => x === 'OK').length).toBeGreaterThanOrEqual(1);
    expect(res.every((x) => x === 'OK' || x === 'CONFLICT')).toBe(true);
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
  });
  it('ulang dengan key yang sama setelah sukses => hasil sama (replay), tanpa baris baru', async () => {
    const id = await submitted();
    const e = etag(id); const t = await noStepUp(budi); const k = key();
    const r1 = await approve(w.deps, budi, t, id, { etag: e }, k, true);
    const n1 = aprs().length;
    const r2 = await approve(w.deps, budi, t, id, { etag: e }, k, true);
    expect(r2).toEqual(r1);
    expect(aprs()).toHaveLength(n1);
  });
  it('gagal tulis tegas (beforeApply) => tidak ada yang berubah; ulang dengan key yang sama berhasil', async () => {
    const id = await submitted();
    const e = etag(id); const t = await noStepUp(budi); const k = key();
    w.store.inject({ kind: 'beforeApply' });
    expect(await code(approve(w.deps, budi, t, id, { etag: e }, k, true))).not.toBe('OK');
    expect(rowOf(id)[C('STATUS')]).toBe('Submitted');
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(0);
    expect(await code(approve(w.deps, budi, t, id, { etag: e }, k, true))).toBe('OK');
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
  });
  it('timeout ambigu setelah batch berlaku => ulang dengan key sama TIDAK menggandakan approval', async () => {
    const id = await submitted();
    const e = etag(id); const t = await noStepUp(budi); const k = key();
    w.store.inject({ kind: 'afterApply' });
    expect(await code(approve(w.deps, budi, t, id, { etag: e }, k, true))).toBe('UPSTREAM_BUSY');
    w.clock.t += 60_000; // lewati masa tenang
    await code(approve(w.deps, budi, t, id, { etag: e }, k, true));
    expect(aprs(id).filter((x) => Number(x[CA('Level')]) === 2)).toHaveLength(1);
    expect(rowOf(id)[C('STATUS')]).toBe('Manager Approved');
  });
});
