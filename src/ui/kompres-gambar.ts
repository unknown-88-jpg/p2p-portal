import { hitungUkuranKompres, KOMPRES, MIME_GAMBAR, namaSetelahKompres, pilihBerkas } from '@/domain/lampiran';

/**
 * Kompres foto invoice di browser: sisi terpanjang 1800 px, JPEG 0,82 (sama dengan sistem lama). PDF tidak disentuh.
 * Hasil dipakai hanya bila lebih kecil dari aslinya. Gagal decode (format aneh) -> berkas asli diteruskan; validasi/server yang memutuskan.
 * Re-encode via canvas membuang metadata EXIF (lokasi GPS dsb.) - bonus privasi.
 */
export async function kompresGambar(f: File): Promise<File> {
  if (!MIME_GAMBAR.includes(f.type)) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const u = hitungUkuranKompres(bmp.width, bmp.height);
    if (!u) { bmp.close(); return f; }
    const canvas = document.createElement('canvas');
    canvas.width = u.w; canvas.height = u.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return f; }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, u.w, u.h); // PNG transparan -> latar putih (JPEG tak punya alfa)
    ctx.drawImage(bmp, 0, 0, u.w, u.h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', KOMPRES.KUALITAS));
    if (!blob) return f;
    return pilihBerkas(f, new File([blob], namaSetelahKompres(f.name), { type: 'image/jpeg', lastModified: Date.now() }));
  } catch { return f; }
}
