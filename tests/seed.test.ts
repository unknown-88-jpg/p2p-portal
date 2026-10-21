import { describe, expect, it } from 'vitest';
import { fillPoVendorCodes, planUserFill, planVendors, toSerial } from '@/repo/seed';

describe('seed user', () => {
  it('satu orang (nama sama) -> satu nomor & satu email di semua barisnya; yang sudah terisi dipertahankan', () => {
    const r = planUserFill([
      { nama: 'Pengguna A', email: '', noHp: '' },
      { nama: 'pengguna a', email: '', noHp: '' },
      { nama: 'Pengguna B', email: 'b@x.test', noHp: '0800000001' },
      { nama: '-', email: '', noHp: '' },
    ]);
    expect(r.phones[0]).toBe(r.phones[1]);
    expect(r.emails[0]).toBe(r.emails[1]);
    expect(r.phones[2]).toBe('0800000001');
    expect(r.emails[2]).toBe('b@x.test');
    expect(r.phones[3]).toBe('');
    expect(r.phones[0]).toMatch(/^0800000\d{4}$/);
    expect(r.emails[0]).toMatch(/@dummy\.test$/);
    expect(r.filledPhones).toBe(2);
  });
  it('nomor tidak menabrak yang sudah dipakai', () => {
    const r = planUserFill([{ nama: 'X', email: '', noHp: '' }, { nama: 'Y', email: '', noHp: '08000005000' }]);
    expect(new Set(r.phones).size).toBe(2);
  });
});

describe('seed vendor', () => {
  it('vendor dari DB_PO dibuat Approved & unik; kode berlanjut dari yang ada', () => {
    const { rows, codeByName } = planVendors(['pt maju', 'PT MAJU', 'PT Baru'], [{ kode: 'VND-0007', nama: 'PT Lama', tipe: 'Trade', status: 'Approved', noRek: '9000000001' }], 46300);
    const trade = rows.filter((r) => r[2] === 'Trade');
    expect(trade.map((r) => r[1])).toEqual(['PT MAJU', 'PT BARU']);
    expect(trade[0]![0]).toBe('VND-0008');
    expect(trade.every((r) => r[7] === 'Approved')).toBe(true);
    expect(new Set(rows.map((r) => r[6])).size).toBe(rows.length); // rekening unik
    expect(codeByName.get('PT MAJU')).toBe('VND-0008');
    expect(typeof rows[0]![9]).toBe('number'); // tanggal sebagai serial
  });
  it('Non-Trade ditambah hanya bila belum ada; nama error (#N/A) diabaikan', () => {
    expect(planVendors(['#N/A'], [], 1).rows.filter((r) => r[2] === 'Non-Trade')).toHaveLength(3);
    const ex = [{ kode: 'VND-0001', nama: 'NT', tipe: 'Non-Trade', status: 'Approved', noRek: '1' }];
    expect(planVendors([], ex, 1).rows).toHaveLength(0);
  });
  it('kode vendor DB_PO: isi yang kosong/#N/A, pertahankan yang valid', () => {
    const map = new Map([['PT MAJU', 'VND-0008']]);
    const r = fillPoVendorCodes(['pt maju', 'PT MAJU', 'PT X'], ['#N/A', 'VND-0001', ''], map);
    expect(r.codes).toEqual(['VND-0008', 'VND-0001', '']);
    expect(r.filled).toBe(1);
  });
  it('serial tanggal', () => expect(toSerial(new Date(Date.UTC(2026, 0, 28)))).toBe(46050));
});
