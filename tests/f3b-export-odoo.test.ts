import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { amankanSel, keCsv, namaFileOdoo, susunJurnalOdoo, tglYmd } from '@/domain/odoo';
import { AppError } from '@/lib/errors';
import type { RawRow } from '@/ports/store';
import { AUDIT_LOG, TRX_PAYMENT_LOG, TRX_PENGAJUAN, type TabSchema } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { exportOdoo, riwayatExport, unduhExport } from '@/server/export-odoo';
import { authWorld } from './auth-helpers';

interface Golden { dari: string; sampai: string; pengajuan: Record<string, unknown>[]; pembayaran: Record<string, unknown>[]; expected: { jumlahPembelian: number; jumlahPembayaran: number; rows: string[][] } }
const G = JSON.parse(readFileSync(new URL('./golden/odoo.json', import.meta.url), 'utf8')) as Golden;
const keBaris = (schema: TabSchema, o: Record<string, unknown>): RawRow => schema.cols.map((c) => (o[c.key] ?? null) as RawRow[number]);
const sess = (email: string, ...levels: number[]): SessionData => ({ phone: '62800', email, nama: email, jabatan: 'X', created: 0, ep: 0, roles: levels.map((level) => ({ brand: 'ALL', dept: 'ALL', level })) });
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const fs = sess('fs@x.id', 3), fm = sess('fm@x.id', 4), adm = sess('adm@x.id', 9);

describe('F3-B domain (I16)', () => {
  it('golden: identik dengan rumus Export_Odoo.gs untuk set dokumen contoh', () => {
    const h = susunJurnalOdoo({ pengajuan: G.pengajuan, pembayaran: G.pembayaran, dari: G.dari, sampai: G.sampai, jenis: 'keduanya' });
    expect(h.rows).toEqual(G.expected.rows);
    expect([h.jumlahPembelian, h.jumlahPembayaran]).toEqual([G.expected.jumlahPembelian, G.expected.jumlahPembayaran]);
    // kutip CSV persis format lama
    expect(keCsv(h.rows).split('\n')[7]).toBe('"TRX-0005","2026-10-20","Purchase","Toko Dummy Lima","INV-05","Banner ""besar""","6-30100 Beban Promosi","","200000.00","0.00"');
    expect(h.peringatan.join(' | ')).toMatch(/TRX-0002: tanggal invoice kosong.*PAY-B: pembayaran tanpa akun kas/);
  });

  it('jenis memisahkan dua jurnal; nama file sama format lama', () => {
    const beli = susunJurnalOdoo({ pengajuan: G.pengajuan, pembayaran: G.pembayaran, dari: G.dari, sampai: G.sampai, jenis: 'pembelian' });
    const bayar = susunJurnalOdoo({ pengajuan: G.pengajuan, pembayaran: G.pembayaran, dari: G.dari, sampai: G.sampai, jenis: 'pembayaran' });
    expect([beli.jumlahPembelian, beli.jumlahPembayaran, bayar.jumlahPembelian, bayar.jumlahPembayaran]).toEqual([3, 0, 0, 3]);
    expect(beli.rows.length + bayar.rows.length - 1).toBe(G.expected.rows.length);
    expect(namaFileOdoo('pembelian', '2026-10-01', '2026-10-31')).toBe('Odoo_pembelian_20261001_20261031.csv');
  });

  it('batas hari WIB, bukan UTC: 31 Okt 23:30 WIB masuk, 1 Nov 00:15 WIB tidak', () => {
    const base = { STATUS: 'Paid', DATE_INVOICE: '', DPP: 1, FINAL_AMOUNT: 1, VENDOR_NAME: 'V' };
    const h = susunJurnalOdoo({
      pengajuan: [{ ...base, ID_TRX: 'TRX-A', TIMESTAMP: 46326.979166666664 }, { ...base, ID_TRX: 'TRX-B', TIMESTAMP: 46327.010416666664 }],
      pembayaran: [{ Log_ID: 'P1', ID_Trx: 'TRX-A', Tgl_Bayar: 46326.99, Nominal: 1, Sumber_Rekening: 'Kas' }, { Log_ID: 'P2', ID_Trx: 'TRX-A', Tgl_Bayar: 46327.001, Nominal: 1, Sumber_Rekening: 'Kas' }],
      dari: '2026-10-01', sampai: '2026-10-31', jenis: 'keduanya',
    });
    expect(h.rows.map((r) => r[0]).filter(Boolean).slice(1)).toEqual(['TRX-A', 'P1']);
    expect(tglYmd(46326.999)).toBe('2026-10-31');
    expect(tglYmd('2026-10-05')).toBe('2026-10-05');
    expect(tglYmd('abc')).toBe('');
  });

  it('anti formula injection: sel teks pemicu rumus diberi apostrof; angka tidak disentuh', () => {
    expect(['=1+1', '+62', '-x', '@SUM(A1)', '\tx', 'Aman'].map(amankanSel)).toEqual(["'=1+1", "'+62", "'-x", "'@SUM(A1)", "'\tx", 'Aman']);
    const h = susunJurnalOdoo({
      pengajuan: [{ ID_TRX: 'TRX-X', STATUS: 'COA Posted', DATE_INVOICE: 46300, VENDOR_NAME: '=HYPERLINK("http://evil")', DESCRIPTION: '@cmd', NO_INVOICE: '+1', DPP: 100, BIAYA_LAIN: 0, DISKON: 200, FINAL_AMOUNT: -100 }],
      pembayaran: [], dari: '2026-10-01', sampai: '2026-10-31', jenis: 'pembelian',
    });
    expect(h.rows[1]!.slice(3, 6)).toEqual(['\'=HYPERLINK("http://evil")', "'+1", "'@cmd"]);
    expect(h.rows[1]![8]).toBe('-100.00'); // angka negatif tetap angka
  });

  it('entry tak seimbang (pembulatan / data manual) diberi peringatan, CSV tetap sama dengan sistem lama', () => {
    const h = susunJurnalOdoo({ pengajuan: [{ ID_TRX: 'TRX-S', STATUS: 'Paid', DATE_INVOICE: 46300, DPP: 1000, PPN_AMOUNT: 110, FINAL_AMOUNT: 1111 }], pembayaran: [], dari: '2026-10-01', sampai: '2026-10-31', jenis: 'pembelian' });
    expect(h.peringatan).toEqual(['TRX-S: debit ≠ kredit (selisih -1); periksa sebelum impor.']);
    expect(h.rows.at(-1)![9]).toBe('1111.00');
  });
});

describe('F3-B service', () => {
  let w: ReturnType<typeof authWorld>;
  beforeEach(() => {
    w = authWorld();
    w.store.seed(TRX_PENGAJUAN, G.pengajuan.map((o) => keBaris(TRX_PENGAJUAN, o)));
    w.store.seed(TRX_PAYMENT_LOG, G.pembayaran.map((o) => keBaris(TRX_PAYMENT_LOG, o)));
    w.store.seed(AUDIT_LOG, []);
  });
  const inp = { dari: G.dari, sampai: G.sampai, jenis: 'keduanya' as const };

  it('capability export.odoo: Finance Staff, Fin. Mgr, Admin saja', async () => {
    expect(await kode(exportOdoo(w.deps, sess('p@x.id', 1), inp))).toBe('FORBIDDEN');
    expect(await kode(exportOdoo(w.deps, sess('m@x.id', 2), inp))).toBe('FORBIDDEN');
    expect(await kode(exportOdoo(w.deps, sess('c@x.id', 5), inp))).toBe('FORBIDDEN');
    expect(await kode(riwayatExport(w.deps, sess('c@x.id', 5)))).toBe('FORBIDDEN');
    for (const s of [fs, fm, adm]) expect(await kode(exportOdoo(w.deps, s, inp))).toBe('OK');
  });

  it('hasil = golden; file CSV tersimpan di folder Drive; riwayat tercatat di Audit_Log', async () => {
    const h = await exportOdoo(w.deps, fs, inp);
    expect(h.csv).toBe(keCsv(G.expected.rows));
    expect(h.namaFile).toBe('Odoo_keduanya_20261001_20261031.csv');
    const f = w.drive.files.get(h.fileId)!;
    expect(new TextDecoder().decode(f.bytes)).toBe(h.csv);
    expect(f.meta).toMatchObject({ mimeType: 'text/csv', parents: [w.drive.folderId] });
    expect(w.audit().at(-1)).toMatchObject({ action: 'EXPORT_ODOO', actor: 'fs@x.id', notes: `${h.namaFile} | ${h.fileId}` });
    const r = await riwayatExport(w.deps, fm);
    expect(r[0]).toMatchObject({ oleh: 'fs@x.id', jenis: 'keduanya', rentang: '2026-10-01..2026-10-31', jumlah: '3 pembelian, 3 pembayaran', fileId: h.fileId });
  });

  it('validasi & kosong: rentang terbalik 400; tidak ada transaksi 422 tanpa file/audit', async () => {
    expect(await kode(exportOdoo(w.deps, fs, { ...inp, dari: '2026-11-01', sampai: '2026-10-01' }))).toBe('VALIDATION');
    expect(await kode(exportOdoo(w.deps, fs, { ...inp, dari: '2025-01-01', sampai: '2025-01-31' }))).toBe('RULE_VIOLATION');
    expect(w.drive.files.size).toBe(0);
    expect(w.audit().filter((a) => a.action === 'EXPORT_ODOO')).toHaveLength(0);
  });

  it('Drive gagal -> tidak ada riwayat palsu', async () => {
    w.drive.failOn.add('createFile');
    expect(await kode(exportOdoo(w.deps, fs, inp))).toBe('UPSTREAM_BUSY');
    expect(w.audit().filter((a) => a.action === 'EXPORT_ODOO')).toHaveLength(0);
  });

  it('unduh ulang hanya file yang tercatat di riwayat export (bukan lampiran / file lain)', async () => {
    const h = await exportOdoo(w.deps, fs, inp);
    const u = await unduhExport(w.deps, adm, h.fileId);
    expect(u.namaFile).toBe(h.namaFile);
    expect(await new Response(u.body).text()).toBe(h.csv);
    w.drive.put({ id: 'FILELAMPIRAN0000001', name: 'invoice_TRD-00001.pdf' }, new Uint8Array([1]));
    expect(await kode(unduhExport(w.deps, adm, 'FILELAMPIRAN0000001'))).toBe('NOT_FOUND');
    expect(await kode(unduhExport(w.deps, sess('p@x.id', 1), h.fileId))).toBe('FORBIDDEN');
    await w.drive.trash(h.fileId);
    expect(await kode(unduhExport(w.deps, adm, h.fileId))).toBe('NOT_FOUND');
  });

  it('dibatasi 6 export/menit per pengguna', async () => {
    for (let i = 0; i < 6; i++) await exportOdoo(w.deps, fs, inp);
    expect(await kode(exportOdoo(w.deps, fs, inp))).toBe('RATE_LIMITED');
    expect(await kode(exportOdoo(w.deps, fm, inp))).toBe('OK');
  });
});
