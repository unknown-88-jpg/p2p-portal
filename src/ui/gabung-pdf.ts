import { RuleError } from '@/domain/errors';
import { GABUNG_MAKS_FILE, namaGabungan, ukuranHalamanFoto } from '@/domain/lampiran';

export interface BerkasSumber { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }

/**
 * Gabung beberapa lampiran (PDF/JPG/PNG, urutan = urutan array) menjadi SATU PDF di browser, supaya pengajuan tetap punya satu file/link.
 * Foto = satu halaman (muat A4); halaman PDF disalin apa adanya. PDF berpassword/rusak -> RuleError yang menyebut nama filenya.
 * pdf-lib dimuat saat dipakai saja (tidak membebani halaman lain). Server tetap memverifikasi hasilnya seperti file biasa.
 */
export async function gabungJadiPdf(files: readonly BerkasSumber[]): Promise<{ bytes: Uint8Array; nama: string }> {
  if (files.length < 2) throw new Error('gabungJadiPdf butuh minimal 2 file');
  if (files.length > GABUNG_MAKS_FILE) throw new RuleError(`Maksimal ${GABUNG_MAKS_FILE} file per pengajuan.`);
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const f of files) {
    const buf = await f.arrayBuffer();
    try {
      if (f.type === 'application/pdf') {
        const src = await PDFDocument.load(buf);
        for (const h of await out.copyPages(src, src.getPageIndices())) out.addPage(h);
      } else if (f.type === 'image/jpeg' || f.type === 'image/png') {
        const img = f.type === 'image/jpeg' ? await out.embedJpg(buf) : await out.embedPng(buf);
        const u = ukuranHalamanFoto(img.width, img.height);
        if (!u) throw new Error('dimensi');
        out.addPage([u.w, u.h]).drawImage(img, { x: 0, y: 0, width: u.w, height: u.h });
      } else throw new RuleError('Tipe file tidak didukung. Gunakan PDF, JPG, atau PNG.');
    } catch (e) {
      if (e instanceof RuleError) throw e;
      const terkunci = /encrypt/i.test((e as Error)?.message ?? '') || /Encrypted/.test((e as Error)?.name ?? '');
      throw new RuleError(terkunci
        ? `"${f.name}" dikunci password, jadi tidak bisa digabung. Buka kuncinya dulu atau pakai file lain.`
        : `"${f.name}" tidak dapat dibaca untuk digabung. Coba file lain.`);
    }
  }
  if (out.getPageCount() === 0) throw new RuleError('Tidak ada halaman yang bisa digabung.');
  return { bytes: await out.save(), nama: namaGabungan(files[0]!.name, files.length) };
}
