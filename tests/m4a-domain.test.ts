import { describe, expect, it } from 'vitest';
import { cariInvoiceDuplikat, cekBarangDiterima, cekHakPengaju, hitungDraft, invoiceLockName, isValidYmd, validatePengajuan, type PengajuanInput } from '@/domain/pengajuan';
import { serialToYmd, ymdToSerial } from '@/lib/time';

const base: PengajuanInput = {
  tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-1',
  dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: 1_000_000,
};

describe('hitungDraft (I1 + I2)', () => {
  it('ambang CFO tepat 5.000.000: 4.999.999 tidak, 5.000.000 ya', () => {
    expect(hitungDraft({ invoiceAmount: 4_999_999, statusPPN: 'Non PPN' }).perluCFO).toBe(false);
    expect(hitungDraft({ invoiceAmount: 5_000_000, statusPPN: 'Non PPN' }).perluCFO).toBe(true);
  });
  it('PPN exclude 11% masuk final & flag CFO dihitung dari final', () => {
    const r = hitungDraft({ invoiceAmount: 4_600_000, statusPPN: 'Exclude PPN' });
    expect(r.finalAmount).toBe(5_106_000);
    expect(r.perluCFO).toBe(true);
  });
  it('diskon & biaya lain mempengaruhi final', () => {
    expect(hitungDraft({ invoiceAmount: 1_000_000, diskon: 100_000, biayaLainnya: 50_000, statusPPN: 'Non PPN' }).finalAmount).toBe(950_000);
  });
});

describe('validatePengajuan', () => {
  it('lolos untuk input sah', () => expect(() => validatePengajuan(base, 'PT A')).not.toThrow());
  it.each([
    ['company kosong', {}, '', /Company kosong/],
    ['nilai 0', { invoiceAmount: 0 }, 'PT A', /Nilai invoice/],
    ['31 Februari', { dateInvoice: '2026-02-31' }, 'PT A', /tidak valid/],
    ['jatuh tempo sebelum invoice', { dueDate: '2026-09-01' }, 'PT A', /sebelum tanggal invoice/],
    ['Trade tanpa PO', { tipe: 'Trade' as const }, 'PT A', /wajib punya Nomor P\.O/],
    ['jenis pembayaran asing', { jenisPembayaran: 'Cicil' }, 'PT A', /tidak dikenal/],
  ])('menolak: %s', (_n, over, company, re) => {
    expect(() => validatePengajuan({ ...base, ...over }, company)).toThrow(re);
  });
});

describe('cekHakPengaju', () => {
  const pic = [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }];
  it('PIC brand+dept cocok boleh', () => expect(cekHakPengaju(pic, 'brand a', 'dept x')).toBeNull());
  it('brand/dept lain ditolak', () => {
    expect(cekHakPengaju(pic, 'BRAND B', 'DEPT X')).toMatch(/bukan PIC/);
    expect(cekHakPengaju(pic, 'BRAND A', 'DEPT Z')).toMatch(/bukan PIC/);
  });
  it('Manager (Level 2) saja tidak boleh membuat pengajuan', () => {
    expect(cekHakPengaju([{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }], 'BRAND A', 'DEPT X')).not.toBeNull();
  });
  it('ALL/ALL Level 1 cocok semuanya', () => expect(cekHakPengaju([{ brand: 'ALL', dept: 'ALL', level: 1 }], 'BRAND Q', 'DEPT Q')).toBeNull());
});

describe('I9 cariInvoiceDuplikat', () => {
  const v = { kode: 'V1', nama: 'Alfa' };
  const row = (o: Partial<{ idTrx: string; vendorKode: string; vendorNama: string; noInvoice: string; status: string }> = {}) =>
    ({ idTrx: 'TRD-00001', vendorKode: 'V1', vendorNama: 'Alfa', noInvoice: 'INV-1', status: 'Submitted', ...o });
  it('dupe (case/spasi diabaikan pada kode)', () => expect(cariInvoiceDuplikat([row()], v, 'inv-1')?.idTrx).toBe('TRD-00001'));
  it('Rejected tidak dihitung', () => expect(cariInvoiceDuplikat([row({ status: 'Rejected' })], v, 'INV-1')).toBeNull());
  it('dokumen sendiri dikecualikan', () => expect(cariInvoiceDuplikat([row()], v, 'INV-1', 'trd-00001')).toBeNull());
  it('vendor lain tidak bentrok', () => expect(cariInvoiceDuplikat([row({ vendorKode: 'V2', vendorNama: 'Beta' })], v, 'INV-1')).toBeNull());
  it('baris lama tanpa kode: cocok lewat nama', () => expect(cariInvoiceDuplikat([row({ vendorKode: '' })], v, 'INV-1')).not.toBeNull());
  it('nama lock dinormalisasi', () => expect(invoiceLockName('v1', ' inv-1 '.trim())).toBe(invoiceLockName('V1', 'INV-1')));
});

describe('I11 cekBarangDiterima', () => {
  it('Trade Full Payment, SJ kurang => tolak', () => expect(cekBarangDiterima('Trade', 'Full Payment', 10, 9)).toMatch(/belum diterima penuh/));
  it('Trade DP dikecualikan', () => expect(cekBarangDiterima('Trade', 'DP', 10, 0)).toBeNull());
  it('Trade SJ lengkap lolos; qtyPO 0 (jasa) lolos; Non-Trade lolos', () => {
    expect(cekBarangDiterima('Trade', 'Pelunasan', 10, 10)).toBeNull();
    expect(cekBarangDiterima('Trade', 'Pelunasan', 0, 0)).toBeNull();
    expect(cekBarangDiterima('Non-Trade', 'Full Payment', 10, 0)).toBeNull();
  });
});

describe('tanggal', () => {
  it('isValidYmd', () => {
    expect(isValidYmd('2026-02-28')).toBe(true);
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2028-02-29')).toBe(true);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('26-1-1')).toBe(false);
  });
  it('ymdToSerial/serialToYmd bolak-balik & menolak tanggal fiktif', () => {
    expect(ymdToSerial('2026-01-01')).toBe(46023);
    for (const d of ['2026-01-01', '2026-12-31', '2028-02-29']) expect(serialToYmd(ymdToSerial(d))).toBe(d);
    expect(() => ymdToSerial('2026-02-31')).toThrow();
    expect(serialToYmd('')).toBe('');
    expect(serialToYmd(0)).toBe('');
  });
});
