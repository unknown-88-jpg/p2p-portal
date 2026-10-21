import { describe, expect, it } from 'vitest';
import { SCHEMAS, TRX_PENGAJUAN, MASTER_USER_TTD, MASTER_VENDOR, DB_PO, colIndex } from '@/repo/schema';
import { validateHeader, overallWritable } from '@/repo/header-validator';

describe('schema registry (paritas Config.gs)', () => {
  it('Trx_Pengajuan = 48 kolom, posisi kunci sama dengan COL lama (1-based)', () => {
    expect(TRX_PENGAJUAN.cols).toHaveLength(48);
    const one = (k: string) => colIndex(TRX_PENGAJUAN, k) + 1;
    expect(one('ID_TRX')).toBe(1);
    expect(one('FILE_URL')).toBe(20);
    expect(one('STATUS')).toBe(32);
    expect(one('CREATED_BY')).toBe(33);
    expect(one('LINK_TTD')).toBe(34);
    expect(one('REQUIRE_CFO')).toBe(41);
    expect(one('QTY_SJ')).toBe(48);
  });
  it('Master_User_TTD: No_HP=H(8), hash=I(9), salt=J(10)', () => {
    expect(colIndex(MASTER_USER_TTD, 'No_HP') + 1).toBe(8);
    expect(colIndex(MASTER_USER_TTD, 'Password_Hash') + 1).toBe(9);
    expect(colIndex(MASTER_USER_TTD, 'Password_Salt') + 1).toBe(10);
  });
  it('Master_Vendor & DB_PO: posisi sesuai kode lama', () => {
    expect(colIndex(MASTER_VENDOR, 'Status') + 1).toBe(8);
    expect(colIndex(MASTER_VENDOR, 'Didaftarkan_Oleh') + 1).toBe(9);
    expect(colIndex(DB_PO, 'Grand_Total') + 1).toBe(13); // dibaca dataPO[i][12]
    expect(colIndex(DB_PO, 'QTY PO') + 1).toBe(16);      // dataPO[i][15]
    expect(colIndex(DB_PO, 'Kode Vendor') + 1).toBe(17); // dataPO[i][16]
  });
  it('key kolom unik per tab', () => {
    for (const s of SCHEMAS) expect(new Set(s.cols.map((c) => c.key)).size).toBe(s.cols.length);
  });
});

describe('validator header', () => {
  const header = TRX_PENGAJUAN.cols.map((c) => c.key);
  it('header persis -> ok', () => {
    expect(validateHeader(TRX_PENGAJUAN, header).ok).toBe(true);
  });
  it('alias "Soft File" untuk FILE_URL & LINK_TTD diterima', () => {
    const h = [...header]; h[19] = 'Soft File'; h[33] = 'Soft File';
    expect(validateHeader(TRX_PENGAJUAN, h).ok).toBe(true);
  });
  it('kolom ekstra di kanan diperbolehkan', () => {
    expect(validateHeader(TRX_PENGAJUAN, [...header, 'CATATAN_BARU']).ok).toBe(true);
  });
  it('kolom disisipkan (bergeser) -> terdeteksi', () => {
    const h = [...header]; h.splice(5, 0, 'KOLOM_SISIPAN');
    const r = validateHeader(TRX_PENGAJUAN, h);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ position: 6, expected: 'TIPE' });
  });
  it('header terlalu pendek -> gagal; tab hilang -> gagal', () => {
    expect(validateHeader(TRX_PENGAJUAN, header.slice(0, 40)).ok).toBe(false);
    expect(validateHeader(TRX_PENGAJUAN, null)).toMatchObject({ ok: false, missingTab: true });
  });
  it('overallWritable: satu tab buruk = read-only', () => {
    const good = validateHeader(TRX_PENGAJUAN, header);
    const bad = validateHeader(TRX_PENGAJUAN, null);
    expect(overallWritable([good])).toBe(true);
    expect(overallWritable([good, bad])).toBe(false);
  });
});
