import { describe, expect, it } from 'vitest';
import { cocokMagic, fileIdDariUrl, LAMPIRAN_MAX_BYTES, namaFileServer, POLA_NAMA_SERVER, sanitasiNama, urlFileDrive, validasiUnggahan } from '@/domain/lampiran';
import { checkDriveAllowed } from '@/lib/trial-guard';

describe('validasiUnggahan', () => {
  const ok = { namaAsli: 'inv.pdf', size: 1000, mimeType: 'application/pdf' };
  it('lolos', () => expect(() => validasiUnggahan(ok)).not.toThrow());
  it('batas ukuran tepat 10 MB lolos, +1 byte ditolak', () => {
    expect(() => validasiUnggahan({ ...ok, size: LAMPIRAN_MAX_BYTES })).not.toThrow();
    expect(() => validasiUnggahan({ ...ok, size: LAMPIRAN_MAX_BYTES + 1 })).toThrow(/10 MB/);
  });
  it.each([0, -5, 1.5, NaN])('ukuran tak valid %s', (size) => expect(() => validasiUnggahan({ ...ok, size })).toThrow(/tidak valid/));
  it.each(['text/html', 'application/x-msdownload', 'image/svg+xml', 'image/gif', 'application/pdf; x=1', '', '__proto__', 'constructor'])('MIME %j ditolak', (mimeType) =>
    expect(() => validasiUnggahan({ ...ok, mimeType })).toThrow(/tidak didukung/));
});

describe('nama file buatan server', () => {
  it('sanitasi: tanpa path/ekstensi/karakter aneh, maks 40, fallback', () => {
    expect(sanitasiNama('../../etc/passwd.pdf')).toBe('passwd');
    expect(sanitasiNama('C:\\Users\\x\\Faktur Juli #1 (final).PDF')).toBe('Faktur-Juli-1-final');
    expect(sanitasiNama('名前.pdf')).toBe('file');
    expect(sanitasiNama('a'.repeat(100) + '.pdf')).toHaveLength(40);
    expect(sanitasiNama('')).toBe('file');
    expect(sanitasiNama('.pdf')).toBe('file');
  });
  it('format & cocok pola pembersihan; ekstensi dari MIME, bukan dari klien', () => {
    const n = namaFileServer({ idTrx: 'NTR-00001', nowMs: Date.UTC(2026, 9, 21, 3, 4, 5), acak: 'ab12cd', namaAsli: 'evil.exe', mimeType: 'image/png' });
    expect(n).toBe('invoice_NTR-00001_20261021-030405_ab12cd_evil.png');
    expect(POLA_NAMA_SERVER.test(n)).toBe(true);
  });
  it('pola menolak nama di luar format', () => {
    for (const x of ['invoice_NTR-1_x.pdf', 'laporan.pdf', 'invoice_NTR-00001_20261021-030405_ab12cd_x.exe', 'invoice_NTR-00001_20261021-030405_ab12cd_.pdf']) expect(POLA_NAMA_SERVER.test(x), x).toBe(false);
  });
  it('acak harus 6 karakter [a-z0-9]; MIME tak dikenal ditolak', () => {
    expect(() => namaFileServer({ idTrx: 'NTR-00001', nowMs: 0, acak: 'AB', namaAsli: 'a', mimeType: 'application/pdf' })).toThrow();
    expect(() => namaFileServer({ idTrx: 'NTR-00001', nowMs: 0, acak: 'abcdef', namaAsli: 'a', mimeType: 'text/html' })).toThrow(/tidak didukung/);
  });
});

describe('cocokMagic', () => {
  const b = (...x: number[]) => new Uint8Array(x);
  it('PDF / JPEG / PNG asli lolos', () => {
    expect(cocokMagic('application/pdf', new TextEncoder().encode('%PDF-1.7\n'))).toBe(true);
    expect(cocokMagic('image/jpeg', b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(cocokMagic('image/png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
  });
  it('menyamar ditolak (exe/html/teks berlabel PDF, PNG berlabel JPEG, kosong, terpotong)', () => {
    expect(cocokMagic('application/pdf', new TextEncoder().encode('MZ\x90\x00'))).toBe(false);
    expect(cocokMagic('application/pdf', new TextEncoder().encode('<html>'))).toBe(false);
    expect(cocokMagic('image/jpeg', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(false);
    expect(cocokMagic('image/png', b(0x89, 0x50))).toBe(false);
    expect(cocokMagic('application/pdf', b())).toBe(false);
    expect(cocokMagic('text/html', new TextEncoder().encode('<html>'))).toBe(false);
  });
});

describe('fileIdDariUrl (extractDriveId_)', () => {
  const id = '1gxEx-3sGuDh4hGzScazC_-sN8mlJNZWx';
  it('berbagai bentuk URL', () => {
    expect(fileIdDariUrl(`https://drive.google.com/file/d/${id}/view`)).toBe(id);
    expect(fileIdDariUrl(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(fileIdDariUrl(id)).toBe(id);
    expect(fileIdDariUrl(urlFileDrive(id))).toBe(id);
  });
  it('kosong / sampah / terlalu pendek => ""', () => {
    for (const x of ['', null, undefined, 'abc', 'https://example.com/x', 123, '-']) expect(fileIdDariUrl(x)).toBe('');
  });
});

describe('checkDriveAllowed (D6)', () => {
  it('trial: wajib DUMMY; production: bebas', () => {
    expect(checkDriveAllowed({ appEnv: 'trial', driveName: 'P2P DUMMY Files' })).toBeNull();
    expect(checkDriveAllowed({ appEnv: 'trial', driveName: 'P2P Finance Files' })).toMatch(/DUMMY/);
    expect(checkDriveAllowed({ appEnv: 'production', driveName: 'apa saja' })).toBeNull();
  });
});
