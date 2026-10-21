import { describe, expect, it } from 'vitest';
import { redact, redactString } from '@/lib/redact';

describe('redaksi log', () => {
  it('JID WA, nomor HP, rekening, bearer, URL sesi upload', () => {
    expect(redactString('dari 6281234567890@s.whatsapp.net')).toBe('dari [redacted-jid]');
    expect(redactString('hubungi 081234567890')).toContain('[redacted-phone]');
    expect(redactString('rek 1234567890123')).toContain('[redacted-number]');
    expect(redactString('Authorization: Bearer abc.def-123')).toContain('Bearer [redacted]');
    expect(redactString('PUT https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=AAA_bbb')).toContain('[redacted-upload-session]');
  });
  it('kunci sensitif dihapus nilainya (nested & array)', () => {
    const out = redact({ user: 'budi', password: 'x', nested: { otp: '123456', no_hp: '0812', ok: 'aman' }, list: [{ messageSecret: 's' }] }) as { password: string; nested: { otp: string; no_hp: string; ok: string }; list: { messageSecret: string }[]; user: string };
    expect(out.password).toBe('[redacted]');
    expect(out.nested.otp).toBe('[redacted]');
    expect(out.nested.no_hp).toBe('[redacted]');
    expect(out.nested.ok).toBe('aman');
    expect(out.list[0]?.messageSecret).toBe('[redacted]');
    expect(out.user).toBe('budi');
  });
  it('Error: hanya name+message (tanpa stack), pesan diredaksi', () => {
    const o = redact(new Error('gagal kirim ke 081234567890')) as Record<string, string>;
    expect(Object.keys(o)).toEqual(['name', 'message']);
    expect(o.message).toContain('[redacted-phone]');
  });
  it('struktur melingkar/dalam tidak meledak', () => {
    const a: Record<string, unknown> = {}; a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});
