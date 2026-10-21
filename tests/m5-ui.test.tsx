import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppNav } from '@/ui/AppNav';
import { alasanValid, bisaBulk, itemBerikutnya, perluMuatUlang, pertahankanKunci } from '@/domain/approval-ui';

describe('M5 UI - logika murni', () => {
  it('bulk hanya untuk < 5 jt dan tidak terkunci', () => {
    expect(bisaBulk({ butuhStepUp: false, terkunci: null })).toBe(true);
    expect(bisaBulk({ butuhStepUp: true, terkunci: null })).toBe(false);
    expect(bisaBulk({ butuhStepUp: false, terkunci: 'SoD' })).toBe(false);
  });
  it('alasan tolak 3..500 setelah trim', () => {
    expect(alasanValid('  ab ')).toBe(false); expect(alasanValid('abc')).toBe(true); expect(alasanValid('x'.repeat(501))).toBe(false);
  });
  it('item berikutnya', () => {
    expect(itemBerikutnya(['a', 'b', 'c'], 'b')).toBe('c'); expect(itemBerikutnya(['a', 'b', 'c'], 'c')).toBe('b');
    expect(itemBerikutnya(['a'], 'a')).toBeNull(); expect(itemBerikutnya(['a', 'b'], 'zz')).toBe('a');
  });
  it('kunci idempotensi: dipertahankan hanya untuk jaringan putus & step-up', () => {
    expect(pertahankanKunci(null)).toBe(true);
    expect(pertahankanKunci({ code: 'FORBIDDEN', fields: { stepUp: 'required' } })).toBe(true);
    expect(pertahankanKunci({ code: 'CONFLICT' })).toBe(false); expect(pertahankanKunci({ code: 'RULE_VIOLATION' })).toBe(false);
  });
  it('muat ulang pada CONFLICT/NOT_FOUND', () => { expect(perluMuatUlang('CONFLICT')).toBe(true); expect(perluMuatUlang('NOT_FOUND')).toBe(true); expect(perluMuatUlang('VALIDATION')).toBe(false); });
});

describe('M5 UI - nav', () => {
  it('link Persetujuan hanya untuk manager, dengan hitungan & aria-current', () => {
    const a = renderToStaticMarkup(<AppNav nama="Budi" bisaAjukan={false} bisaSetujui jumlahMenunggu={3} aktif="persetujuan" />);
    expect(a).toContain('Persetujuan (3)'); expect(a).toContain('aria-current="page"');
    expect(renderToStaticMarkup(<AppNav nama="Citra" bisaAjukan />)).not.toContain('Persetujuan');
  });
});
