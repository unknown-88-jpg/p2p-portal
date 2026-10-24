import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetPasswordForm } from '@/ui/SetPasswordForm';

describe('F-12 UI (SSR smoke)', () => {
  it('keadaan awal: form tampil, tombol Simpan nonaktif selama link diperiksa, tanpa gaya inline (CSP)', () => {
    const html = renderToStaticMarkup(<SetPasswordForm />);
    expect(html).toContain('Atur password');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Simpan password<\/button>/);
    expect(html).not.toContain('Link tidak berlaku');
    expect(html).not.toContain(' style=');
  });
});
