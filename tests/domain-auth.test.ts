import { describe, expect, it } from 'vitest';
import { CAPABILITY_LEVELS, can, canApprove, canViewDocument, capabilitiesOf } from '@/domain/capabilities';
import { checkPassword } from '@/domain/password-policy';
import { maskPhone, normalizePhone } from '@/domain/phone';
import { buildAccounts, hasAuthority, isAktif, normEmail, parseLevel, type UserRowInput } from '@/domain/roles';

describe('normalizePhone (port normalisasiNomorWA_)', () => {
  it.each([
    ['081200000001', '6281200000001'], ['0812-0000-0001', '6281200000001'], ['+62 812 0000 0001', '6281200000001'],
    ['6281200000001', '6281200000001'], ['81200000001', '6281200000001'], ['(0812) 0000.0001', '6281200000001'],
  ])('%s -> %s', (i, o) => expect(normalizePhone(i)).toBe(o));
  it('sampah/terlalu pendek/panjang -> ""', () => {
    for (const x of ['', '   ', 'abc', '0812', '0'.repeat(30), null, undefined]) expect(normalizePhone(x)).toBe('');
  });
  it('mask', () => { expect(maskPhone('6281200000001')).toBe('6281****0001'); expect(maskPhone('123')).toBe('****'); });
});

describe('kebijakan password', () => {
  const ph = '6281200000001';
  it('lolos yang wajar', () => expect(checkPassword('Kopi-Manis-47', ph)).toBeNull());
  it.each([['abc', 'PENDEK'], ['x'.repeat(129), 'PANJANG'], ['password123', 'UMUM'], ['12345678', 'UMUM'], ['081200000001', 'SAMA_DENGAN_NOMOR'],
    ['6281200000001', 'SAMA_DENGAN_NOMOR'], ['aaaaaaaa', 'POLA_SEDERHANA'], ['abcdefgh1'.slice(0, 8), 'UMUM'], ['abababab', 'POLA_SEDERHANA'], ['cdefghij', 'POLA_SEDERHANA']] as const)(
    '%s -> %s', (pw, issue) => expect(checkPassword(pw, ph)).toBe(issue));
});

const row = (o: Partial<UserRowInput> & { row: number }): UserRowInput => ({ brand: 'A', dept: 'X', level: 1, jabatan: 'J', nama: 'N', email: 'n@x.id', aktif: 'YES', phone: '081200000001', hash: '', salt: '', ...o });

describe('buildAccounts (port cariBarisApproverByNomor_)', () => {
  it('banyak baris satu nomor -> satu akun, roles gabungan, hash dari baris pertama yang terisi', () => {
    const m = buildAccounts([row({ row: 2, level: 2, brand: 'a', dept: 'x' }), row({ row: 3, level: '1', brand: 'B', dept: 'Y', hash: 'H', salt: 'S' }), row({ row: 4, phone: '0813000000009' })]);
    const a = m.get('6281200000001')!;
    expect(a.rows).toEqual([2, 3]);
    expect(a.roles).toEqual([{ brand: 'A', dept: 'X', level: 2 }, { brand: 'B', dept: 'Y', level: 1 }]);
    expect(a.hash).toBe('H'); expect(a.salt).toBe('S'); expect(m.size).toBe(2);
  });
  it('baris nonaktif tidak menyumbang role; semua nonaktif -> aktif=false', () => {
    const m = buildAccounts([row({ row: 2, aktif: 'NO', level: 2 }), row({ row: 3, aktif: ' nonaktif ', level: 3 })]);
    const a = m.get('6281200000001')!;
    expect(a.aktif).toBe(false); expect(a.roles).toEqual([]); expect(a.rows).toEqual([2, 3]);
  });
  it('kosong = aktif (perilaku lama); baris tanpa nomor valid dilewati', () => {
    expect(isAktif('')).toBe(true); expect(isAktif(null)).toBe(true); expect(isAktif('Tidak')).toBe(false);
    expect(buildAccounts([row({ row: 2, phone: '' }), row({ row: 3, phone: 'abc' })]).size).toBe(0);
  });
  it('level tak terbaca -> 99; email dinormalisasi buang spasi tak terlihat', () => {
    expect(parseLevel('x')).toBe(99); expect(parseLevel('')).toBe(99); expect(parseLevel(' 3 ')).toBe(3); expect(parseLevel(4)).toBe(4);
    expect(normEmail(' Budi​@X.id  ')).toBe('budi@x.id');
  });
});

describe('otorisasi', () => {
  const roles = (...l: [number, string?, string?][]) => l.map(([level, brand = 'A', dept = 'X']) => ({ level, brand, dept }));
  it('hasAuthority: level persis + brand/dept atau ALL', () => {
    expect(hasAuthority(roles([2]), 'a', 'x', 2)).toBe(true);
    expect(hasAuthority(roles([2]), 'B', 'x', 2)).toBe(false);
    expect(hasAuthority(roles([2, 'ALL', 'ALL']), 'Z', 'Q', 2)).toBe(true);
    expect(hasAuthority(roles([3, 'ALL', 'ALL']), 'Z', 'Q', 2)).toBe(false);
  });
  it('capability = level PERSIS (L4 tanpa baris L3 tidak bisa verifikasi pajak) — perilaku lama dipertahankan', () => {
    expect(can(roles([4]), 'tax.verify')).toBe(false);
    expect(can(roles([3]), 'tax.verify')).toBe(true);
    expect(can(roles([1, 'A', 'X'], [3, 'ALL', 'ALL']), 'payment.execute')).toBe(true);
    expect(can(roles([9]), 'admin.manage')).toBe(true);
    expect(can(roles([2]), 'pengajuan.write')).toBe(false);
  });
  it('matriks design 5.4 (tabel)', () => {
    const who = (l: number) => capabilitiesOf(roles([l])).sort();
    expect(who(1)).toEqual(['pengajuan.write', 'vendor.register']);
    expect(who(2)).toEqual(['approve.manager', 'vendor.register']);
    expect(who(3)).toEqual(['export.odoo', 'finance.view', 'journal.post', 'payment.execute', 'report.view', 'tax.verify', 'vendor.approve', 'vendor.register']); // O4: tanpa 'sign.upload'
    expect(who(4)).toEqual(['audit.view', 'export.odoo', 'finance.view', 'report.view', 'sign.eapprove.finmgr']);
    expect(who(5)).toEqual(['audit.view', 'finance.view', 'report.view', 'sign.eapprove.cfo']);
    expect(who(9)).toEqual(['admin.manage', 'audit.view', 'export.odoo', 'report.view', 'vendor.register']);
    expect(who(99)).toEqual([]);
    expect(Object.keys(CAPABILITY_LEVELS)).toHaveLength(14); // F3-D: report.view, audit.view
  });
  it('canApprove menghormati brand/dept', () => {
    expect(canApprove(roles([2, 'A', 'X']), { brand: 'A', dept: 'X' })).toBe(true);
    expect(canApprove(roles([2, 'A', 'X']), { brand: 'A', dept: 'Y' })).toBe(false);
  });
  it('canViewDocument (IDOR lama): pemilik, manager berwenang, finance+; level 99 DITOLAK (lama lolos karena >= 3)', () => {
    const doc = { createdBy: 'Pic@X.id ', brand: 'A', dept: 'X' };
    expect(canViewDocument(roles([1]), 'pic@x.id', doc)).toBe(true);
    expect(canViewDocument(roles([1]), 'lain@x.id', doc)).toBe(false);
    expect(canViewDocument(roles([2, 'A', 'X']), 'm@x.id', doc)).toBe(true);
    expect(canViewDocument(roles([2, 'B', 'X']), 'm@x.id', doc)).toBe(false);
    for (const l of [3, 4, 5, 9]) expect(canViewDocument(roles([l]), 'f@x.id', doc)).toBe(true);
    expect(canViewDocument(roles([99]), 'z@x.id', doc)).toBe(false);
    expect(canViewDocument(roles([1]), '', { ...doc, createdBy: '' })).toBe(false);
  });
});
