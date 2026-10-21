import { describe, expect, it } from 'vitest';
import { burnVerify, hashPassword, legacyHash, verifyPassword } from '@/infra/password';

describe('password hashing', () => {
  it('scrypt s1: benar/salah, salt acak per hash, parameter tersimpan', async () => {
    const a = await hashPassword('Kopi-Manis-47'), b = await hashPassword('Kopi-Manis-47');
    expect(a.hash).toMatch(/^s1\$32768\$8\$1\$/); expect(a.salt).toBe('s1'); expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword('Kopi-Manis-47', a.hash, a.salt)).toEqual({ ok: true, needsRehash: false });
    expect(await verifyPassword('kopi-manis-47', a.hash, a.salt)).toEqual({ ok: false });
  });
  it('hash lama: cocok dengan implementasi referensi independen (hashlib Python, algoritma Auth.gs)', async () => {
    const v1 = '099ecbef6ad9c96eee58d1486f2b9ef949bac36a84752af2a1975eabfe858f5f';
    expect(legacyHash('rahasia-lama-1', 'salt123')).toBe(v1);
    expect(legacyHash('sandi unik ñ', 'a'.repeat(64))).toBe('18c1cc75069fdcfeee6e562f6496d940ce1f039e520d4628760b0887235059eb');
    expect(await verifyPassword('rahasia-lama-1', v1, 'salt123')).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword('rahasia-lama-2', v1, 'salt123')).toEqual({ ok: false });
    expect(await verifyPassword('rahasia-lama-1', v1.toUpperCase(), 'salt123')).toEqual({ ok: true, needsRehash: true });
  });
  it('hash/salt rusak atau kosong => ditolak tanpa melempar', async () => {
    for (const [h, s] of [['', ''], ['abc', 'x'], ['s1$bad', 's1'], ['s1$99999999$8$1$QQ$QQ', 's1'], ['0'.repeat(64), '']] as const) {
      expect(await verifyPassword('x', h, s)).toEqual({ ok: false });
    }
  });
  it('burnVerify tidak melempar', async () => { await expect(burnVerify('x')).resolves.toBeUndefined(); });
});
