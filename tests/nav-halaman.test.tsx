import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Regresi: halaman Persetujuan dulu menulis bisaAjukan={false} tetap, sehingga pengguna ber-peran ganda
// kehilangan "Pengajuan saya" dan "Ajukan" di sidebar hanya di halaman itu.
const roles = [{ brand: 'HEYLOCAL', dept: 'BRAND', level: 1 }, { brand: 'HEYLOCAL', dept: 'BRAND', level: 2 }];
vi.mock('@/app/_lib/sesi', () => ({ wajibSesi: async () => ({ nama: 'Rina Manager', roles, email: 'r@x.id' }) }));
vi.mock('@/server/approval', () => ({ inbox: async () => [1, 2] }));
vi.mock('@/server/runtime', () => ({ authDeps: () => ({}) }));

describe('sidebar halaman Persetujuan untuk pengguna ber-peran ganda', () => {
  it('menampilkan semua menu dan jumlah antrean', async () => {
    const Page = (await import('@/app/persetujuan/page')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Beranda');
    expect(html).toContain('Pengajuan saya');
    expect(html).toContain('Persetujuan (2)');
    expect(html).toContain('/pengajuan/baru'); // tombol Ajukan
    expect(html).toContain('aria-current="page"');
  });
});
