import { describe, expect, it } from 'vitest';
import { signatureWebhookValid, signWebhook } from '@/infra/wa-signature';
import { LixusWaSender, TrialAllowlistSender } from '@/infra/wa-sender';
import { ekstrakTeks, idemKeyWA, nomorDariJid, parsePerintah, pesanDigest, pesanTidakSegar, timestampMs } from '@/domain/wa';

describe('parsePerintah (port regex lama)', () => {
  it('SETUJU/APPROVE + 4 digit, huruf besar-kecil bebas', () => {
    expect(parsePerintah('SETUJU 4821')).toEqual({ jenis: 'SETUJU', kode: '4821' });
    expect(parsePerintah('  setuju   1234 ')).toEqual({ jenis: 'SETUJU', kode: '1234' });
    expect(parsePerintah('approve 9999')).toEqual({ jenis: 'SETUJU', kode: '9999' });
  });
  it('TOLAK wajib alasan >= 3 huruf; alasan mempertahankan huruf aslinya', () => {
    expect(parsePerintah('TOLAK 4821 Nominal Salah')).toEqual({ jenis: 'TOLAK', kode: '4821', alasan: 'Nominal Salah' });
    expect(parsePerintah('reject 4821 lampiran buram')).toEqual({ jenis: 'TOLAK', kode: '4821', alasan: 'lampiran buram' });
    expect(parsePerintah('TOLAK 4821')).toEqual({ jenis: 'TOLAK_TANPA_ALASAN', kode: '4821' });
    expect(parsePerintah('TOLAK 4821 ok')).toEqual({ jenis: 'TOLAK_TANPA_ALASAN', kode: '4821' });
  });
  it('6 digit = OTP lama (dijawab "tidak dipakai"); selain itu tidak dikenal; kode bukan 4 digit tidak lolos', () => {
    expect(parsePerintah('123456')).toEqual({ jenis: 'OTP' });
    expect(parsePerintah('halo')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('SETUJU 123')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('SETUJU 12345')).toEqual({ jenis: 'TIDAK_DIKENAL' });
    expect(parsePerintah('tolong SETUJU 1234')).toEqual({ jenis: 'TIDAK_DIKENAL' });
  });
});

describe('pengirim & umur pesan (fail-closed)', () => {
  it('hanya <digit>@s.whatsapp.net; @lid, grup, akhiran device, huruf ditolak', () => {
    expect(nomorDariJid('6281200000001@s.whatsapp.net')).toBe('6281200000001');
    expect(nomorDariJid('081200000001@s.whatsapp.net')).toBe('6281200000001');
    for (const bad of ['123456789012345@lid', '6281200000001:12@s.whatsapp.net', '12036@g.us', 'abc@s.whatsapp.net', '', undefined, null, 5, '@s.whatsapp.net', '6281200000001@s.whatsapp.net.evil']) expect(nomorDariJid(bad)).toBe('');
  });
  it('timestamp: detik/string diterima; sampah NaN; > 10 menit atau masa depan > 2 menit ditolak', () => {
    const now = 1_790_000_000_000;
    expect(timestampMs(1_790_000_000)).toBe(now);
    expect(timestampMs('1790000000')).toBe(now);
    expect(Number.isNaN(timestampMs({ low: 1 }))).toBe(true);
    expect(Number.isNaN(timestampMs(undefined))).toBe(true);
    expect(Number.isNaN(timestampMs(-5))).toBe(true);
    expect(pesanTidakSegar(now - 9 * 60_000, now)).toBe(false);
    expect(pesanTidakSegar(now - 10 * 60_000 - 1, now)).toBe(true);
    expect(pesanTidakSegar(now + 60_000, now)).toBe(false);
    expect(pesanTidakSegar(now + 2 * 60_000 + 1, now)).toBe(true);
    expect(pesanTidakSegar(NaN, now)).toBe(true);
  });
  it('ekstrakTeks: conversation, extended, caption, tombol; selain itu kosong', () => {
    expect(ekstrakTeks({ conversation: ' SETUJU 1 ' })).toBe('SETUJU 1');
    expect(ekstrakTeks({ extendedTextMessage: { text: 'TOLAK 1 x' } })).toBe('TOLAK 1 x');
    expect(ekstrakTeks({ imageMessage: { caption: 'cap' } })).toBe('cap');
    expect(ekstrakTeks({ buttonsResponseMessage: { selectedButtonId: 'SETUJU 2' } })).toBe('SETUJU 2');
    expect(ekstrakTeks({ stickerMessage: {} })).toBe('');
    expect(ekstrakTeks(null)).toBe('');
  });
  it('idemKeyWA memenuhi IDEM_KEY_RE (8-64, [A-Za-z0-9_-]) dan stabil', () => {
    const k = idemKeyWA('3EB0 ABC/def+==' + 'x'.repeat(200));
    expect(k).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(idemKeyWA('ABC123')).toBe('wa-ABC123');
  });
});

describe('tanda tangan webhook (vektor S6 dari vendor)', () => {
  const body = '{"event":"message.received","sessionId":"s1"}';
  const vektor = '95a77c64bdd40c82cc3a336360457a80872bd1e4dca6b2178db5990cfec4a8e2';
  it('HMAC-SHA256 hex atas raw body cocok dengan vektor', () => {
    expect(signWebhook(body, 'test-secret')).toBe(vektor);
    expect(signatureWebhookValid(body, vektor, 'test-secret')).toBe(true);
  });
  it('fail-closed: header/secret kosong, secret salah, body diubah 1 byte, panjang beda, bukan hex', () => {
    expect(signatureWebhookValid(body, undefined, 'test-secret')).toBe(false);
    expect(signatureWebhookValid(body, '', 'test-secret')).toBe(false);
    expect(signatureWebhookValid(body, vektor, undefined)).toBe(false);
    expect(signatureWebhookValid(body, vektor, 'test-secreT')).toBe(false);
    expect(signatureWebhookValid(body + ' ', vektor, 'test-secret')).toBe(false);
    expect(signatureWebhookValid(body, vektor.slice(0, 62), 'test-secret')).toBe(false);
    expect(signatureWebhookValid(body, 'zz'.repeat(32), 'test-secret')).toBe(false);
  });
});

describe('pesanDigest', () => {
  const base = { idTrx: 'NTR-00001', vendor: 'Gama', pic: 'Citra', perluCFO: false, link: 'http://x/persetujuan?id=NTR-00001' };
  it('item < ambang memuat kode; item >= ambang TANPA kode dan mengarah ke web', () => {
    const t = pesanDigest({ nama: 'Budi', linkInbox: 'http://x/persetujuan', sisa: 0, items: [{ ...base, nominal: 1_000_000, kode: '4821' }, { ...base, idTrx: 'NTR-00002', nominal: 7_500_000, perluCFO: true, kode: null }] });
    expect(t).toContain('SETUJU 4821');
    expect(t).toContain('Rp 1.000.000');
    expect(t).toContain('Rp 7.500.000');
    expect(t.match(/SETUJU \d{4}/g)).toHaveLength(1);
    expect(t).toContain('lewat web');
  });
  it('menyebut sisa dokumen yang tidak dimuat', () => {
    expect(pesanDigest({ nama: '', linkInbox: 'http://x', sisa: 3, items: [{ ...base, nominal: 1, kode: '1111' }] })).toContain('dan 3 lainnya');
  });
});

describe('pengirim', () => {
  it('Lixus: sukses 2xx; 2xx tapi success:false = gagal; 401/timeout = gagal tanpa melempar; nomor dinormalkan; header & body benar', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mk = (res: () => Response | Promise<Response>) => new LixusWaSender('https://gw.example/', 'KEY', async (url, init) => { calls.push({ url, init }); return res(); });
    const ok = await mk(() => Response.json({ success: true, messageId: 'm' })).send('0812-0000-0001', 'hai');
    expect(ok.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://gw.example/api/messages/send');
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('KEY');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ to: '6281200000001', text: 'hai' });
    expect((await mk(() => Response.json({ success: false })).send('081200000001', 'x')).ok).toBe(false);
    expect((await mk(() => new Response('no', { status: 401 })).send('081200000001', 'x')).info).toContain('API key');
    expect((await mk(() => { throw new Error('boom'); }).send('081200000001', 'x')).ok).toBe(false);
    expect((await mk(() => Response.json({})).send('abc', 'x')).ok).toBe(false);
  });
  it('allowlist trial: hanya nomor terdaftar; kosong = tidak ada yang terkirim', async () => {
    const sent: string[] = [];
    const inner = { send: async (to: string) => { sent.push(to); return { ok: true, info: 'ok' }; } };
    const s = new TrialAllowlistSender(inner, '081200000001, 6281200000002');
    expect((await s.send('0812-0000-0001', 'x')).ok).toBe(true);
    expect((await s.send('081299999999', 'x')).ok).toBe(false);
    expect(sent).toEqual(['6281200000001']);
    expect((await new TrialAllowlistSender(inner, '').send('081200000001', 'x')).ok).toBe(false);
    // opsi 1 (2026-10-24): user aktif Master_User_TTD juga diizinkan; sumber gagal = fail-closed
    const dariSheet = new TrialAllowlistSender(inner, '', async () => new Set(['6281200000009']));
    expect((await dariSheet.send('0812-0000-0009', 'x')).ok).toBe(true);
    expect((await dariSheet.send('081200000008', 'x'))).toEqual({ ok: false, info: 'diblokir allowlist trial' });
    const rusak = new TrialAllowlistSender(inner, '081200000001', async () => { throw new Error('Sheets 500'); });
    expect((await rusak.send('081200000009', 'x')).ok).toBe(false);
    expect((await rusak.send('081200000001', 'x')).ok).toBe(true);
  });
});
