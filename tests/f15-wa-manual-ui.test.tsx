import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KirimWa } from '@/ui/KirimWa';

describe('F-15 UI (SSR smoke)', () => {
  it('tombol Kirim WA aktif bila belum dikirim; nonaktif + keterangan bila sudah dikirim hari ini; tanpa gaya inline (CSP)', () => {
    const siap = renderToStaticMarkup(<KirimWa id="TRD-00005" sudahHariIni={false} />);
    expect(siap).toMatch(/<button[^>]*class="btn-wa"[^>]*>.*Kirim WA<\/button>/);
    expect(siap).not.toMatch(/<button[^>]*disabled/);
    const sudah = renderToStaticMarkup(<KirimWa id="TRD-00004" sudahHariIni />);
    expect(sudah).toMatch(/<button[^>]*disabled=""/); expect(sudah).toContain('Sudah dikirim hari ini');
    expect(siap + sudah).not.toContain(' style=');
  });
});
