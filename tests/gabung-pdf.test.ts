import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { RuleError } from '@/domain/errors';
import { cocokMagic, GABUNG_MAKS_FILE, namaGabungan, ukuranHalamanFoto } from '@/domain/lampiran';
import { gabungJadiPdf, type BerkasSumber } from '@/ui/gabung-pdf';

const berkas = (name: string, type: string, b: Uint8Array): BerkasSumber => ({ name, type, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
async function pdf(halaman: number, ubah?: (d: PDFDocument) => void): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < halaman; i++) d.addPage([300, 400]);
  ubah?.(d);
  return d.save({ useObjectStreams: false });
}
// PNG 1x1 valid
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('gabung lampiran jadi satu PDF', () => {
  it('PDF + foto + PDF -> satu PDF, halaman berurutan sesuai urutan file, lolos magic bytes server', async () => {
    const r = await gabungJadiPdf([berkas('inv.pdf', 'application/pdf', await pdf(2)), berkas('foto.png', 'image/png', PNG), berkas('sj.pdf', 'application/pdf', await pdf(3))]);
    expect(cocokMagic('application/pdf', r.bytes.subarray(0, 8))).toBe(true);
    const d = await PDFDocument.load(r.bytes);
    expect(d.getPageCount()).toBe(6);
    expect(d.getPage(2).getSize()).toEqual({ width: 1, height: 1 }); // halaman ke-3 = foto
    expect(r.nama).toBe('inv-gabungan-3-file.pdf');
  });
  it('PDF berpassword ditolak dengan menyebut nama filenya; file rusak juga', async () => {
    const terkunci = await pdf(1, (d) => { d.context.trailerInfo.Encrypt = d.context.obj({}); });
    await expect(gabungJadiPdf([berkas('a.pdf', 'application/pdf', await pdf(1)), berkas('rahasia.pdf', 'application/pdf', terkunci)])).rejects.toThrow(/"rahasia\.pdf" dikunci password/);
    const e = await gabungJadiPdf([berkas('a.pdf', 'application/pdf', await pdf(1)), berkas('rusak.png', 'image/png', new Uint8Array([1, 2, 3]))]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RuleError);
    expect((e as Error).message).toContain('"rusak.png" tidak dapat dibaca');
  });
  it(`lebih dari ${GABUNG_MAKS_FILE} file ditolak`, async () => {
    const satu = berkas('a.pdf', 'application/pdf', await pdf(1));
    await expect(gabungJadiPdf(Array.from({ length: GABUNG_MAKS_FILE + 1 }, () => satu))).rejects.toBeInstanceOf(RuleError);
  });
  it('ukuran halaman foto: muat A4 searah foto, tidak membesarkan; nama gabungan aman', () => {
    expect(ukuranHalamanFoto(1800, 1200)).toEqual({ w: 842, h: 561 });
    expect(ukuranHalamanFoto(1200, 1800)).toEqual({ w: 561, h: 842 });
    expect(ukuranHalamanFoto(200, 100)).toEqual({ w: 200, h: 100 });
    expect(ukuranHalamanFoto(0, 5)).toBeNull();
    expect(namaGabungan('C:\\x\\Invoice Maret.pdf', 3)).toBe('Invoice Maret-gabungan-3-file.pdf');
    expect(namaGabungan('.pdf', 2)).toBe('lampiran-gabungan-2-file.pdf');
  });
});
