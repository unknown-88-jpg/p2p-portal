import { describe, expect, it } from 'vitest';
import { Anonymizer, RULES, plan, anonymizeColumn, SHEET_ERROR, STILL_LOADING, FREEZE_TABS } from '@/repo/anonymize';

describe('anonimisasi dummy', () => {
  it('konsisten: nilai asli sama -> palsu sama (case-insensitive untuk email/vendor)', () => {
    const a = new Anonymizer();
    expect(a.apply('email', 'Budi@Corp.id')).toBe(a.apply('email', 'budi@corp.id'));
    expect(a.apply('vendor', 'PT Maju')).toBe(a.apply('vendor', 'pt maju'));
    expect(a.apply('email', 'budi@corp.id')).not.toBe(a.apply('email', 'siti@corp.id'));
  });
  it('rekening/NPWP palsu valid format & unik; nol di depan aman (string)', () => {
    const a = new Anonymizer();
    const r1 = a.apply('rek', '0012345678'), r2 = a.apply('rek', '9988776655');
    expect(r1).toMatch(/^\d{6,20}$/); expect(r1).not.toBe(r2);
    expect(a.apply('rek', '0012-345678')).toBe(r1); // format beda, rekening sama
    expect(a.apply('npwp', '01.234.567.8-901.000')).toMatch(/^\d{15}$/);
  });
  it('nomor HP dinormalisasi (08.., 628.., +628..) ke satu nomor uji', () => {
    const a = new Anonymizer();
    const p = a.apply('phone', '081234567890');
    expect(a.apply('phone', '6281234567890')).toBe(p);
    expect(a.apply('phone', '+62 812-3456-7890')).toBe(p);
    expect(p).toMatch(/^0800000\d{4}$/); // bukan rentang seluler nyata
  });
  it('kosong/"-" dipertahankan; blank selalu kosong', () => {
    const a = new Anonymizer();
    expect(a.apply('name', '')).toBe('');
    expect(a.apply('npwp', '-')).toBe('-');
    expect(a.apply('blank', 'https://drive.google.com/x')).toBe('');
  });
  it('tidak ada nilai asli yang lolos di kolom sensitif', () => {
    const a = new Anonymizer();
    const out = anonymizeColumn(a, 'email', ['rahasia@perusahaan.co.id', 'lain@perusahaan.co.id']);
    out.forEach((v) => expect(v).not.toContain('perusahaan'));
  });
  it('semua rule menunjuk kolom yang ada & tidak ada duplikat', () => {
    expect(() => plan()).not.toThrow();
    const keys = RULES.map((r) => `${r.schema.tab}.${r.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('nilai error rumus & Loading dikenali; tab beku = DB_PO, DB_SJ', () => {
    ['#N/A', '#REF!', '#VALUE!', '#ERROR!'].forEach((e) => expect(SHEET_ERROR.test(e)).toBe(true));
    expect(SHEET_ERROR.test('#N/A saja')).toBe(false);
    expect(STILL_LOADING.test('Loading...')).toBe(true);
    expect(FREEZE_TABS.map((f) => f.tab)).toEqual(['DB_PO', 'DB_SJ']);
  });
});
