import { beforeEach, describe, expect, it } from 'vitest';
import { POLA_NAMA_SERVER, urlFileDrive } from '@/domain/lampiran';
import type { SessionData } from '@/infra/session';
import { AppError } from '@/lib/errors';
import { AUDIT_LOG, MASTER_PPH, MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { bersihkanYatim, bukaLampiran, konfirmasiUnggah, mulaiUnggah } from '@/server/lampiran';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import { authWorld } from './auth-helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = (n = 100) => { const b = new Uint8Array(n).fill(0x20); b.set(enc('%PDF-1.7\n')); return b; };
const PNG = () => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const ORIGIN = 'http://localhost:3000';
const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);

const citra = { phone: '6281200000002', email: 'citra@x.id', nama: 'Citra', jabatan: 'PIC', created: 0, ep: 0, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND B', dept: 'DEPT Y', level: 1 }] } as SessionData;
const budi = { ...citra, phone: '6281200000001', email: 'budi@x.id', nama: 'Budi', jabatan: 'Manager', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }] } as SessionData;
const budiLain = { ...budi, roles: [{ brand: 'BRAND B', dept: 'DEPT Y', level: 2 }] } as SessionData;
const dani = { ...citra, phone: '6281200000003', email: 'dani@x.id', nama: 'Dani', jabatan: 'Fin Staff', roles: [{ brand: 'ALL', dept: 'ALL', level: 3 }] } as SessionData;
const lain = { ...citra, email: 'lain@x.id' } as SessionData;

let w: ReturnType<typeof authWorld>;
let id: string;
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'OK'; } catch (e) { return e instanceof AppError ? e.code : `ERR:${String(e)}`; } };
const trx = () => w.store.rowsOf(TRX_PENGAJUAN);
const fileUrl = (): string => String(trx()[0]![C('FILE_URL')] ?? '');
const audits = (a: string) => w.store.rowsOf(AUDIT_LOG).filter((r) => r[colIndex(AUDIT_LOG, 'Action')] === a);
const setCell = (k: string, v: string): void => w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { r[C(k)] = v; return r; }));
const urlOf = (r: { sessionUrl: string }): string => r.sessionUrl;

/** mulai -> (klien PUT ke Drive) -> kembalikan bahan konfirmasi. */
async function unggah(bytes: Uint8Array, o: { nama?: string; mime?: string; sizeDeklarasi?: number; s?: SessionData } = {}) {
  const mime = o.mime ?? 'application/pdf';
  const r = await mulaiUnggah(w.deps, o.s ?? citra, id, { namaAsli: o.nama ?? 'Faktur Juli.pdf', size: o.sizeDeklarasi ?? bytes.length, mimeType: mime }, ORIGIN);
  const fileId = w.drive.upload(urlOf(r), bytes);
  return { uploadId: r.uploadId, fileId, sessionUrl: r.sessionUrl };
}

beforeEach(async () => {
  w = authWorld();
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL']]);
  w.store.seed(MASTER_PPH, [['PPh 23', 0.02, 0.04]]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
  id = (await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-1', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000, statusPPN: 'Non PPN' })).id;
});

describe('mulai unggah', () => {
  it('membuat sesi; nama file dibuat server & aman; ukuran/tipe dikirim ke Drive', async () => {
    const r = await mulaiUnggah(w.deps, citra, id, { namaAsli: '../../etc/passwd.pdf', size: 500, mimeType: 'application/pdf' }, ORIGIN);
    const s = w.drive.sessions.get(r.sessionUrl)!;
    expect(POLA_NAMA_SERVER.test(s.name)).toBe(true);
    expect(s.name).toContain(`invoice_${id}_`);
    expect(s.name).not.toMatch(/etc|\.\.|\//);
    expect(s).toMatchObject({ size: 500, mimeType: 'application/pdf', origin: ORIGIN });
    expect(r.maxBytes).toBe(10 * 1024 * 1024);
  });
  it('bukan pemilik / ID tak ada => 404; status terkunci => 409', async () => {
    expect(await code(mulaiUnggah(w.deps, lain, id, { namaAsli: 'a.pdf', size: 5, mimeType: 'application/pdf' }, ORIGIN))).toBe('NOT_FOUND');
    expect(await code(mulaiUnggah(w.deps, citra, 'NTR-99999', { namaAsli: 'a.pdf', size: 5, mimeType: 'application/pdf' }, ORIGIN))).toBe('NOT_FOUND');
    setCell('STATUS', 'Submitted');
    expect(await code(mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 5, mimeType: 'application/pdf' }, ORIGIN))).toBe('CONFLICT');
  });
  it('tipe/ukuran ditolak SEBELUM menyentuh Drive', async () => {
    expect(await code(mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.exe', size: 5, mimeType: 'application/x-msdownload' }, ORIGIN))).toBe('RULE_VIOLATION');
    expect(await code(mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 11 * 1024 * 1024, mimeType: 'application/pdf' }, ORIGIN))).toBe('RULE_VIOLATION');
    expect(w.drive.calls).not.toContain('createUploadSession');
  });
  it('rate limit: permintaan ke-31 dalam 1 jam => 429', async () => {
    for (let i = 0; i < 30; i++) await mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 5, mimeType: 'application/pdf' }, ORIGIN);
    expect(await code(mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 5, mimeType: 'application/pdf' }, ORIGIN))).toBe('RATE_LIMITED');
  });
  it('Drive down => 503 dan tidak ada sesi tertinggal', async () => {
    w.drive.failOn.add('createUploadSession');
    expect(await code(mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 5, mimeType: 'application/pdf' }, ORIGIN))).toBe('UPSTREAM_BUSY');
  });
});

describe('konfirmasi: jalur sah', () => {
  it('menempelkan file, audit UPLOAD, lalu pengajuan BISA disubmit (end-to-end)', async () => {
    const u = await unggah(PDF());
    const r = await konfirmasiUnggah(w.deps, citra, id, u);
    expect(r).toMatchObject({ punyaLampiran: true, namaFile: 'Faktur Juli.pdf', mimeType: 'application/pdf' });
    expect(fileUrl()).toBe(urlFileDrive(u.fileId));
    expect(audits('UPLOAD')).toHaveLength(1);
    const res = await submitPengajuan(w.deps, citra, id, 'idem-lampiran-01');
    expect(res.status).toBe('Submitted');
  });
  it('PNG juga lolos', async () => {
    const u = await unggah(PNG(), { mime: 'image/png', nama: 'foto.png' });
    expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('OK');
  });
  it('konfirmasi dua kali (klik ganda) => sukses, tetap satu audit', async () => {
    const u = await unggah(PDF());
    await konfirmasiUnggah(w.deps, citra, id, u);
    expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('OK');
    expect(audits('UPLOAD')).toHaveLength(1);
  });
  it('konfirmasi paralel => satu audit', async () => {
    const u = await unggah(PDF());
    const res = await Promise.all([konfirmasiUnggah(w.deps, citra, id, u), konfirmasiUnggah(w.deps, citra, id, u)].map(code));
    expect(res.filter((x) => x === 'OK').length).toBeGreaterThanOrEqual(1);
    expect(audits('UPLOAD')).toHaveLength(1);
  });
  it('dua unggahan berbeda dikonfirmasi bersamaan => lock menyerialkan: tepat satu file hidup, dan itu yang dirujuk', async () => {
    const a = await unggah(PDF(100), { nama: 'a.pdf' }); const b = await unggah(PDF(110), { nama: 'b.pdf' });
    await Promise.all([konfirmasiUnggah(w.deps, citra, id, a), konfirmasiUnggah(w.deps, citra, id, b)]);
    const hidup = [a, b].filter((x) => w.drive.alive(x.fileId));
    expect(hidup).toHaveLength(1);
    expect(fileUrl()).toBe(urlFileDrive(hidup[0]!.fileId));
    expect(audits('UPLOAD')).toHaveLength(2);
  });
  it('mengganti lampiran: file lama buatan server di-trash; file lama dari sistem lama TIDAK disentuh', async () => {
    const u1 = await unggah(PDF(100));
    await konfirmasiUnggah(w.deps, citra, id, u1);
    const u2 = await unggah(PDF(120), { nama: 'revisi.pdf' });
    await konfirmasiUnggah(w.deps, citra, id, u2);
    expect(w.drive.alive(u1.fileId)).toBe(false);
    expect(w.drive.alive(u2.fileId)).toBe(true);
    // lampiran warisan (nama bebas, bukan pola server)
    w.drive.put({ id: 'LEGACYFILE000000000001', name: 'faktur lama.pdf' }, PDF());
    setCell('FILE_URL', urlFileDrive('LEGACYFILE000000000001'));
    const u3 = await unggah(PDF(130), { nama: 'baru.pdf' });
    await konfirmasiUnggah(w.deps, citra, id, u3);
    expect(w.drive.alive('LEGACYFILE000000000001')).toBe(true);
  });
});

describe('konfirmasi: klien nakal (klien tidak tepercaya)', () => {
  it('ukuran sebenarnya beda dari deklarasi => ditolak & file di-trash', async () => {
    const u = await unggah(PDF(50), { sizeDeklarasi: 100 });
    expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('RULE_VIOLATION');
    expect(w.drive.alive(u.fileId)).toBe(false);
    expect(fileUrl()).toBe('');
  });
  it('isi bukan PDF walau berlabel PDF (exe/HTML menyamar) => ditolak & di-trash', async () => {
    for (const isi of ['MZ\x90\x00\x03', '<html><script>alert(1)</script></html>']) {
      const u = await unggah(enc(isi.padEnd(40, ' ')));
      expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('RULE_VIOLATION');
      expect(w.drive.alive(u.fileId)).toBe(false);
    }
    expect(fileUrl()).toBe('');
  });
  it('tipe tersimpan di Drive beda dari yang dideklarasikan => ditolak', async () => {
    const r = await mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 100, mimeType: 'application/pdf' }, ORIGIN);
    const fileId = w.drive.upload(r.sessionUrl, PDF(100), { mimeType: 'text/html' });
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { uploadId: r.uploadId, fileId }))).toBe('RULE_VIOLATION');
    expect(w.drive.alive(fileId)).toBe(false);
  });
  it('fileId milik file lain (nama beda) => ditolak dan file orang lain TIDAK di-trash', async () => {
    const r = await mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 100, mimeType: 'application/pdf' }, ORIGIN);
    w.drive.put({ id: 'KORBANFILE00000000001', name: 'invoice_NTR-00009_20261001-000000_abcdef_milik-orang.pdf' }, PDF(100));
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { uploadId: r.uploadId, fileId: 'KORBANFILE00000000001' }))).toBe('RULE_VIOLATION');
    expect(w.drive.alive('KORBANFILE00000000001')).toBe(true);
    expect(fileUrl()).toBe('');
  });
  it('Drive mencatat tipe lain yang juga di-whitelist (PNG) padahal dideklarasikan PDF => ditolak', async () => {
    const r = await mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 100, mimeType: 'application/pdf' }, ORIGIN);
    const fileId = w.drive.upload(r.sessionUrl, PDF(100), { mimeType: 'image/png' });
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { uploadId: r.uploadId, fileId }))).toBe('RULE_VIOLATION');
    expect(fileUrl()).toBe('');
  });
  it('uploadId dokumen A dipakai untuk dokumen B milik pemilik yang sama => 404, tidak menempel', async () => {
    const id2 = (await createDraft(w.deps, citra, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Lain', vendorKode: 'V3', noInvoice: 'INV-2', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1000, statusPPN: 'Non PPN' })).id;
    const u = await unggah(PDF());
    expect(await code(konfirmasiUnggah(w.deps, citra, id2, u))).toBe('NOT_FOUND');
    expect(trx().every((r) => !r[C('FILE_URL')])).toBe(true);
  });
  it('fileId tak ada => ditolak', async () => {
    const r = await mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 100, mimeType: 'application/pdf' }, ORIGIN);
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { uploadId: r.uploadId, fileId: 'TIDAKADA00000000000001' }))).toBe('RULE_VIOLATION');
  });
  it('file di folder lain => ditolak & di-trash', async () => {
    const r = await mulaiUnggah(w.deps, citra, id, { namaAsli: 'a.pdf', size: 100, mimeType: 'application/pdf' }, ORIGIN);
    const fileId = w.drive.upload(r.sessionUrl, PDF(100));
    w.drive.files.get(fileId)!.meta.parents = ['FOLDER-LAIN-0000000000'];
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { uploadId: r.uploadId, fileId }))).toBe('RULE_VIOLATION');
  });
  it('uploadId milik pengguna lain / dokumen lain / ngawur => 404; file tidak menempel', async () => {
    const u = await unggah(PDF());
    expect(await code(konfirmasiUnggah(w.deps, lain, id, u))).toBe('NOT_FOUND');
    expect(await code(konfirmasiUnggah(w.deps, citra, 'NTR-00002', u))).toBe('NOT_FOUND');
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { ...u, uploadId: 'x'.repeat(30) }))).toBe('NOT_FOUND');
    expect(await code(konfirmasiUnggah(w.deps, citra, id, { ...u, uploadId: 'pendek' }))).toBe('VALIDATION');
    expect(fileUrl()).toBe('');
  });
  it('dokumen terkunci (Submitted) sebelum konfirmasi => 409 dan lampiran tidak berubah', async () => {
    const u = await unggah(PDF());
    setCell('STATUS', 'Submitted');
    expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('CONFLICT');
    expect(fileUrl()).toBe('');
  });
  it('Drive down saat verifikasi => 503, sesi tetap valid untuk retry', async () => {
    const u = await unggah(PDF());
    w.drive.failOn.add('getMeta');
    expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('UPSTREAM_BUSY');
    w.drive.failOn.clear();
    expect(await code(konfirmasiUnggah(w.deps, citra, id, u))).toBe('OK');
  });
});

describe('proxy baca (I13)', () => {
  beforeEach(async () => { await konfirmasiUnggah(w.deps, citra, id, await unggah(PDF(100))); });
  it('pemilik, Manager berwenang, dan Finance boleh; isi byte sama; header aman', async () => {
    for (const s of [citra, budi, dani]) {
      const r = await bukaLampiran(w.deps, s, id);
      expect(r.status).toBe(200);
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF(100));
    }
    const h = (await bukaLampiran(w.deps, citra, id)).headers;
    expect(h.get('content-type')).toBe('application/pdf');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('cache-control')).toMatch(/private/);
    expect(h.get('content-disposition')).toBe(`inline; filename="lampiran-${id}.pdf"`);
  });
  it('PIC lain, Manager divisi lain, dan ID ngawur => 404 (bukan 403)', async () => {
    for (const s of [lain, budiLain]) expect(await code(bukaLampiran(w.deps, s, id))).toBe('NOT_FOUND');
    expect(await code(bukaLampiran(w.deps, citra, 'NTR-99999'))).toBe('NOT_FOUND');
  });
  it('tanpa lampiran => 404', async () => {
    setCell('FILE_URL', '');
    expect(await code(bukaLampiran(w.deps, citra, id))).toBe('NOT_FOUND');
  });
  it('file lama bertipe di luar whitelist dipaksa unduh (tidak pernah dirender)', async () => {
    w.drive.put({ id: 'LEGACYHTML00000000001', name: 'x.html', mimeType: 'text/html' }, enc('<script>1</script>'));
    setCell('FILE_URL', urlFileDrive('LEGACYHTML00000000001'));
    const r = await bukaLampiran(w.deps, citra, id);
    expect(r.headers.get('content-type')).toBe('application/octet-stream');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment/);
  });
  it('Drive down => 503; file hilang di Drive => 404', async () => {
    w.drive.failOn.add('open');
    expect(await code(bukaLampiran(w.deps, citra, id))).toBe('UPSTREAM_BUSY');
    w.drive.failOn.clear();
    w.drive.files.clear();
    expect(await code(bukaLampiran(w.deps, citra, id))).toBe('NOT_FOUND');
  });
});

describe('housekeeping file yatim', () => {
  const HARI = 24 * 3_600_000;
  it('trash yatim > 24 jam; pertahankan yang dirujuk, yang baru, dan yang bukan buatan server', async () => {
    const u = await unggah(PDF()); await konfirmasiUnggah(w.deps, citra, id, u);          // dirujuk
    const yatimTua = await unggah(PDF(90)); // tidak dikonfirmasi
    w.clock.advance(2 * HARI);
    const yatimBaru = await unggah(PDF(80));
    w.drive.put({ id: 'LEGACYFILE000000000002', name: 'faktur lama.pdf', createdMs: w.clock.now() - 5 * HARI }, PDF());
    const r = await bersihkanYatim(w.deps);
    expect(r.ditrash).toBe(2 - 1); // hanya yatimTua (yang dirujuk & yang baru aman)
    expect(w.drive.alive(yatimTua.fileId)).toBe(false);
    expect(w.drive.alive(u.fileId)).toBe(true);
    expect(w.drive.alive(yatimBaru.fileId)).toBe(true);
    expect(w.drive.alive('LEGACYFILE000000000002')).toBe(true);
  });
  it('file berawalan invoice_ yang bukan buatan server (mis. unggahan manual admin) TIDAK disentuh', async () => {
    w.drive.put({ id: 'MANUALFILE0000000001', name: 'invoice_manual_dari_admin.pdf', createdMs: w.clock.now() - 9 * HARI }, PDF());
    expect((await bersihkanYatim(w.deps)).ditrash).toBe(0);
    expect(w.drive.alive('MANUALFILE0000000001')).toBe(true);
  });
  it('gagal membaca sheet => TIDAK ada yang di-trash', async () => {
    const yatim = await unggah(PDF(90));
    w.clock.advance(2 * HARI);
    w.store.readRows = async () => { throw new AppError('UPSTREAM_BUSY', 'sheet down'); };
    expect(await code(bersihkanYatim(w.deps))).toBe('UPSTREAM_BUSY');
    expect(w.drive.alive(yatim.fileId)).toBe(true);
  });
  it('batas maxTrash dihormati', async () => {
    const a = await unggah(PDF(90)); const b = await unggah(PDF(91)); const c = await unggah(PDF(92));
    w.clock.advance(2 * HARI);
    expect((await bersihkanYatim(w.deps, 2)).ditrash).toBe(2);
    expect([a, b, c].filter((x) => w.drive.alive(x.fileId))).toHaveLength(1);
  });
});
