import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DURASI_TOAST, Toast } from '@/ui/kit';

describe('Toast (notifikasi pop-up hasil aksi)', () => {
  it('sukses = role status + tombol tutup; galat = role alert; kosong = tidak dirender; tanpa gaya inline (CSP)', () => {
    const ok = renderToStaticMarkup(<Toast isi={{ jenis: 'ok', teks: 'NTR-00001 disetujui.' }} onTutup={() => undefined} />);
    expect(ok).toMatch(/class="toast ok" role="status"/);
    expect(ok).toContain('NTR-00001 disetujui.');
    expect(ok).toMatch(/aria-label="Tutup notifikasi"/);
    expect(renderToStaticMarkup(<Toast isi={{ jenis: 'err', teks: 'x' }} onTutup={() => undefined} />)).toMatch(/role="alert"/);
    expect(renderToStaticMarkup(<Toast isi={null} onTutup={() => undefined} />)).toBe('');
    expect(ok).not.toContain(' style=');
  });
  it('sukses hilang lebih cepat daripada peringatan (yang sering berisi rincian gagal)', () => {
    expect(DURASI_TOAST.ok).toBeLessThan(DURASI_TOAST.warn);
  });
});
