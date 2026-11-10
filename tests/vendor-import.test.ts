import { describe, expect, it } from 'vitest';
import { bacaBarisVendor, parseCsv, rencanaImpor } from '@/domain/vendor-import';

// Semua data fiktif.
const CSV = `nama,tipe,npwp,bank,nama_rekening,no_rekening
PT CONTOH SATU,Trade,01.111.111.1-111.000,BCA,PT CONTOH SATU,1111 2222 33
PT CONTOH SATU,Non-Trade,01.111.111.1-111.000,BCA,PT CONTOH SATU,1111222233
"PT CONTOH, DUA",Non-Trade,,MANDIRI,PT CONTOH DUA,44445555
PT CONTOH TIGA,Non-Trade,,BCA,PT CONTOH TIGA,1111222233
PT SALAH,Aneh,,BCA,PT SALAH,5555666677
`;

describe('parseCsv', () => {
  it('kutip, koma di dalam kutip, CRLF, BOM, titik koma', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]); // baris kosong dibuang
  });
});

describe('bacaBarisVendor', () => {
  it('kolom wajib; header tak peka huruf/spasi', () => {
    expect(bacaBarisVendor(parseCsv('nama,tipe,bank\nx,Trade,BCA'))).toMatchObject({ ok: false, galat: expect.stringMatching(/npwp/) });
    const r = bacaBarisVendor(parseCsv('Nama Vendor,Tipe,NPWP,Bank,Nama Rekening,No Rekening\nA,Trade,,BCA,A,123456'));
    expect(r).toMatchObject({ ok: true, baris: [{ no: 2, input: { namaVendor: 'A', noRekening: '123456' } }] });
  });
});

describe('rencanaImpor', () => {
  const r = bacaBarisVendor(parseCsv(CSV));
  if (!r.ok) throw new Error(r.galat);
  it('pasangan Trade/Non-Trade lolos; rekening sama beda entitas ditolak; tipe tak valid ditolak', () => {
    const h = rencanaImpor([], r.baris);
    expect(h.map((x) => x.status)).toEqual(['siap', 'siap', 'siap', 'ditolak', 'ditolak']);
    expect(h[3]!.alasan).toMatch(/I7/);
    expect(h[4]!.alasan).toMatch(/Tipe vendor/);
  });
  it('terhadap sheet yang sudah berisi rekening yang sama: ditolak; alasan tidak memuat NPWP/rekening', () => {
    const sheet = [['VND-0001', 'PT CONTOH DUA', 'Trade', '', 'MANDIRI', 'X', '44445555', 'Approved']];
    const h = rencanaImpor(sheet, r.baris);
    expect(h[2]).toMatchObject({ status: 'ditolak', alasan: expect.stringContaining('VND-0001') });
    expect(JSON.stringify(h)).not.toMatch(/\d{6,}/);
  });
});
