import { describe, expect, it } from 'vitest';
import { alasanTerkunci, butuhStepUp, cekSoD, cekStatus, cekWewenang, etagCocok, kunciVersi, type VersiDokumen } from '@/domain/approval';
import { CONFIG } from '@/domain/config';
import { STATUS } from '@/domain/status';

const mgr = [{ brand: 'BRAND A', dept: 'DEPT X', level: 2 }];
const v = (o: Partial<VersiDokumen> = {}): VersiDokumen => ({ status: 'Submitted', lastUpdate: 46000.5, finalAmount: 1000, invAmount: 1000, diskon: 0, biayaLain: 0, vendorKode: 'V3', noInvoice: 'I1', tipe: 'Non-Trade', poNumber: '-', statusPPN: 'Non PPN', fileAda: true, ...o });

describe('M5 domain approval', () => {
  it('step-up: tepat di ambang (>=) wajib, 1 rupiah di bawahnya tidak', () => {
    expect(CONFIG.APPROVE_STEPUP_MIN).toBe(5_000_000);
    expect(butuhStepUp(5_000_000)).toBe(true);
    expect(butuhStepUp(4_999_999)).toBe(false);
    expect(butuhStepUp(5_000_001)).toBe(true);
    expect(butuhStepUp(0)).toBe(false);
  });
  it('wewenang: level persis 2 + brand/dept (ALL boleh); Level 1/3 atau divisi lain => NOT_FOUND', () => {
    expect(cekWewenang(mgr, { brand: 'brand a', dept: 'dept x' })).toBeNull();
    expect(cekWewenang([{ brand: 'ALL', dept: 'ALL', level: 2 }], { brand: 'B', dept: 'Y' })).toBeNull();
    expect(cekWewenang(mgr, { brand: 'BRAND B', dept: 'DEPT X' })?.code).toBe('NOT_FOUND');
    expect(cekWewenang([{ brand: 'ALL', dept: 'ALL', level: 3 }], { brand: 'BRAND A', dept: 'DEPT X' })?.code).toBe('NOT_FOUND');
    expect(cekWewenang([{ brand: 'ALL', dept: 'ALL', level: 1 }], { brand: 'BRAND A', dept: 'DEPT X' })?.code).toBe('NOT_FOUND');
    expect(cekWewenang([], { brand: 'A', dept: 'B' })?.code).toBe('NOT_FOUND');
  });
  it('I3: hanya status Submitted yang boleh di-approve/tolak, semua status lain CONFLICT', () => {
    expect(cekStatus('approve', STATUS.SUBMITTED)).toBeNull();
    expect(cekStatus('reject', STATUS.SUBMITTED)).toBeNull();
    for (const s of Object.values(STATUS).filter((x) => x !== STATUS.SUBMITTED)) {
      expect(cekStatus('approve', s)?.code).toBe('CONFLICT');
      expect(cekStatus('reject', s)?.code).toBe('CONFLICT');
    }
    expect(cekStatus('approve', 'ngawur')?.code).toBe('CONFLICT');
  });
  it('SoD: pembuat = approver ditolak bila flag ON (email dinormalisasi: huruf besar, spasi, karakter tak terlihat)', () => {
    expect(cekSoD('citra@x.id', 'budi@x.id', true)).toMatchObject({ ok: true });
    expect(cekSoD('Budi@X.id', ' budi@x.id​', true)).toMatchObject({ ok: false, tolak: { code: 'FORBIDDEN' } });
  });
  it('SoD: email approver kosong tidak lolos saat ON (identitas tak bisa diverifikasi); pembuat kosong + approver ada = lolos', () => {
    expect(cekSoD('citra@x.id', '', true)).toMatchObject({ ok: false });
    expect(cekSoD('', 'budi@x.id', true)).toMatchObject({ ok: true });
  });
  it('SoD OFF: self-approval lolos TAPI diberi penanda audit eksplisit', () => {
    const r = cekSoD('budi@x.id', 'budi@x.id', false);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.penanda).toContain('SELF-APPROVAL');
    const biasa = cekSoD('citra@x.id', 'budi@x.id', false);
    expect(biasa.ok && biasa.penanda).not.toContain('SELF-APPROVAL');
  });
  it('alasanTerkunci: pesan hanya bila terkunci', () => {
    expect(alasanTerkunci('a@x.id', 'b@x.id', true)).toBeNull();
    expect(alasanTerkunci('a@x.id', 'a@x.id', true)).toMatch(/pembuat/);
    expect(alasanTerkunci('a@x.id', 'a@x.id', false)).toBeNull();
  });
  it('etag: setiap komponen versi mengubah kunci; yang sama persis => sama', () => {
    const base = kunciVersi(v());
    expect(kunciVersi(v())).toBe(base);
    const varian: Partial<VersiDokumen>[] = [
      { status: 'Revision Needed' }, { lastUpdate: 46001 }, { finalAmount: 1001 }, { invAmount: 1001 }, { diskon: 1 }, { biayaLain: 1 },
      { vendorKode: 'V4' }, { noInvoice: 'I2' }, { tipe: 'Trade' }, { poNumber: 'PO/1' }, { statusPPN: 'Include PPN' }, { fileAda: false },
    ];
    for (const o of varian) expect(kunciVersi(v(o))).not.toBe(base);
  });
  it('etagCocok: kosong tidak pernah cocok', () => {
    expect(etagCocok('', '')).toBe(false);
    expect(etagCocok('abc', 'abc')).toBe(true);
    expect(etagCocok('abc', 'abd')).toBe(false);
  });
});
