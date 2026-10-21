import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const csp = (): string => proxy(new NextRequest('http://localhost:3000/pengajuan/baru')).headers.get('content-security-policy') ?? '';
const directive = (name: string): string[] => (csp().split(';').map((s) => s.trim()).find((d) => d.startsWith(name + ' ')) ?? '').split(/\s+/).slice(1);

describe('CSP (M4c: upload langsung browser -> Drive)', () => {
  it('connect-src mengizinkan self + host sesi upload Drive, tidak lebih', () => {
    expect(directive('connect-src')).toEqual(["'self'", 'https://www.googleapis.com']);
  });
  it('tidak ada wildcard / unsafe-inline di script & style; pratinjau gambar lokal (blob:) boleh', () => {
    expect(csp()).not.toMatch(/\*/);
    expect(directive('script-src').join(' ')).not.toContain('unsafe-inline');
    expect(directive('style-src').join(' ')).not.toContain('unsafe-inline');
    expect(directive('img-src')).toContain('blob:');
  });
  it('frame-ancestors none, object-src none tetap', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
  });
});
