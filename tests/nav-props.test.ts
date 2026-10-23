import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from '@/server/auth';

const inbox = vi.fn();
vi.mock('@/server/approval', () => ({ inbox: (...a: unknown[]) => inbox(...a) }));
vi.mock('@/server/runtime', () => ({ authDeps: () => ({}) }));

const sesi = (levels: number[]) => ({ roles: levels.map((level) => ({ brand: 'HEYLOCAL', dept: 'BRAND', level })) }) as unknown as SessionData;

describe('propsNav: isi sidebar satu sumber untuk semua halaman', () => {
  beforeEach(() => { inbox.mockReset(); });

  it('pengaju saja: bisa ajukan, tanpa menu persetujuan, antrean tidak dibaca', async () => {
    const { propsNav } = await import('@/app/_lib/nav');
    expect(await propsNav(sesi([1]))).toEqual({ bisaAjukan: true, bisaSetujui: false });
    expect(inbox).not.toHaveBeenCalled();
  });

  it('Manager saja: persetujuan + jumlah antrean, tanpa Ajukan', async () => {
    inbox.mockResolvedValue([1, 2, 3]);
    const { propsNav } = await import('@/app/_lib/nav');
    expect(await propsNav(sesi([2]))).toEqual({ bisaAjukan: false, bisaSetujui: true, jumlahMenunggu: 3 });
  });

  it('peran ganda (pengaju + Manager): kedua menu tetap ada (regresi halaman Persetujuan)', async () => {
    inbox.mockResolvedValue([1]);
    const { propsNav } = await import('@/app/_lib/nav');
    expect(await propsNav(sesi([1, 2]))).toEqual({ bisaAjukan: true, bisaSetujui: true, jumlahMenunggu: 1 });
  });

  it('antrean gagal dibaca: halaman tetap jalan, jumlah dihilangkan', async () => {
    inbox.mockRejectedValue(new Error('Sheets 429'));
    const { propsNav } = await import('@/app/_lib/nav');
    expect(await propsNav(sesi([1, 2]))).toEqual({ bisaAjukan: true, bisaSetujui: true });
  });
});
