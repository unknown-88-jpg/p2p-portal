import { describe, expect, it } from 'vitest';
import { GalatPut, GalatUnggah, unggahLampiran, type DepsUnggah, type TahapUnggah } from '@/ui/unggah-lampiran';

interface Berkas { name: string; size: number; type: string }
const PDF: Berkas = { name: 'Invoice Juli.pdf', size: 250_000, type: 'application/pdf' };
const SESSION_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=RAHASIA-123';
const gagal = (p: Promise<unknown>): Promise<GalatUnggah> => p.then(() => { throw new Error('seharusnya gagal'); }, (e: unknown) => e as GalatUnggah);
const apiErr = (code: string, message = 'galat') => ({ code, message });

function fake(opts: { sesi?: () => unknown; put?: () => Promise<{ id: string }>; konfirmasi?: (n: number) => unknown } = {}) {
  const log: string[] = []; const waits: number[] = [];
  let konfN = 0;
  const d: DepsUnggah<Berkas> = {
    api: (async (path: string, init?: { body?: unknown }) => {
      if (path.endsWith('/sesi')) { log.push(`sesi ${JSON.stringify(init?.body)}`); const r = opts.sesi?.() ?? { hasil: { uploadId: 'U'.repeat(24), sessionUrl: SESSION_URL, maxBytes: 10485760 } }; if (r instanceof Error || (r as { code?: string }).code) throw r; return r; }
      log.push(`konfirmasi ${JSON.stringify(init?.body)}`);
      const r = opts.konfirmasi?.(++konfN) ?? { hasil: { punyaLampiran: true, namaFile: 'Invoice Juli.pdf', size: 250_000, mimeType: 'application/pdf' } };
      if (r instanceof Error || (r as { code?: string }).code) throw r; return r;
    }) as DepsUnggah<Berkas>['api'],
    put: async (url, b, onP) => { log.push(`put ${url === SESSION_URL ? 'URL-SESI' : url} ${b.size}`); onP(0.5); return opts.put ? opts.put() : { id: 'FILE-ID-0000001' }; },
    tunggu: async (ms) => { waits.push(ms); },
  };
  return { d, log, waits };
}

describe('unggahLampiran (alur sesi -> PUT -> konfirmasi)', () => {
  it('jalur bahagia: urutan tepat, tahap & progres dilaporkan, konfirmasi membawa uploadId + fileId dari Drive', async () => {
    const { d, log } = fake(); const tahap: TahapUnggah[] = []; const prog: number[] = [];
    const h = await unggahLampiran(d, 'NTR-00001', PDF, { onTahap: (t) => tahap.push(t), onProgress: (p) => prog.push(p) });
    expect(h).toEqual({ namaFile: 'Invoice Juli.pdf', size: 250_000, mimeType: 'application/pdf' });
    expect(tahap).toEqual(['menyiapkan', 'mengunggah', 'memverifikasi']);
    expect(prog[0]).toBe(0); expect(prog.at(-1)).toBe(1);
    expect(log.map((l) => l.split(' ')[0])).toEqual(['sesi', 'put', 'konfirmasi']);
    expect(log[0]).toContain('"namaAsli":"Invoice Juli.pdf"'); expect(log[0]).toContain('"size":250000');
    expect(log[2]).toContain('FILE-ID-0000001'); expect(log[2]).toContain('U'.repeat(24));
  });
  it('validasi lokal: tipe asing / terlalu besar / kosong ditolak SEBELUM menyentuh server', async () => {
    for (const b of [{ ...PDF, type: 'application/zip' }, { ...PDF, size: 10 * 1024 * 1024 + 1 }, { ...PDF, size: 0 }]) {
      const { d, log } = fake();
      await expect(unggahLampiran(d, 'NTR-00001', b)).rejects.toMatchObject({ name: 'GalatUnggah', tahap: 'menyiapkan', bisaCobaLagi: false });
      expect(log).toEqual([]);
    }
  });
  it('sesi ditolak server: tidak lanjut ke PUT; RULE_VIOLATION tak bisa dicoba lagi, UPSTREAM_BUSY/RATE_LIMITED/jaringan bisa', async () => {
    for (const [e, bisa] of [[apiErr('RULE_VIOLATION'), false], [apiErr('UPSTREAM_BUSY'), true], [apiErr('RATE_LIMITED'), true], [new TypeError('fetch failed'), true], [apiErr('FORBIDDEN'), false]] as const) {
      const { d, log } = fake({ sesi: () => e });
      await expect(unggahLampiran(d, 'NTR-00001', PDF)).rejects.toMatchObject({ tahap: 'menyiapkan', bisaCobaLagi: bisa });
      expect(log.some((l) => l.startsWith('put'))).toBe(false);
    }
  });
  it('PUT gagal: tidak ada konfirmasi (file tak pernah ditempel); pesan TIDAK memuat URL sesi', async () => {
    const { d, log } = fake({ put: async () => { throw new GalatPut('Koneksi terputus saat mengunggah. Coba lagi.'); } });
    const e = await gagal(unggahLampiran(d, 'NTR-00001', PDF));
    expect(e).toBeInstanceOf(GalatUnggah); expect(e.tahap).toBe('mengunggah'); expect(e.bisaCobaLagi).toBe(true);
    expect(e.message).not.toContain('RAHASIA'); expect(e.message).not.toContain('googleapis');
    expect(log.some((l) => l.startsWith('konfirmasi'))).toBe(false);
  });
  it('PUT melempar sesuatu yang aneh (mis. berisi URL) -> pesan generik, bukan e.message mentah', async () => {
    const { d } = fake({ put: async () => { throw new Error(`gagal ${SESSION_URL}`); } });
    const e = await gagal(unggahLampiran(d, 'NTR-00001', PDF));
    expect(e.message).not.toContain('RAHASIA'); expect(e.message).toMatch(/Gagal mengunggah/);
  });
  it('konfirmasi: jaringan putus 2x lalu berhasil -> sukses (idempoten di server), dengan jeda', async () => {
    const { d, waits, log } = fake({ konfirmasi: (n) => (n < 3 ? new TypeError('fetch failed') : undefined) });
    await expect(unggahLampiran(d, 'NTR-00001', PDF)).resolves.toMatchObject({ namaFile: 'Invoice Juli.pdf' });
    expect(log.filter((l) => l.startsWith('konfirmasi'))).toHaveLength(3); expect(waits).toEqual([700, 1800]);
    expect(log.filter((l) => l.startsWith('put'))).toHaveLength(1); // file tidak diunggah ulang
  });
  it('konfirmasi: UPSTREAM_BUSY terus -> menyerah setelah 3 percobaan, boleh dicoba lagi', async () => {
    const { d, log } = fake({ konfirmasi: () => apiErr('UPSTREAM_BUSY', 'sibuk') });
    await expect(unggahLampiran(d, 'NTR-00001', PDF)).rejects.toMatchObject({ tahap: 'memverifikasi', bisaCobaLagi: true, message: 'sibuk' });
    expect(log.filter((l) => l.startsWith('konfirmasi'))).toHaveLength(3);
  });
  it('konfirmasi: penolakan tegas (isi tidak cocok tipe) -> TIDAK diulang, tidak bisa coba lagi dengan file sama', async () => {
    const { d, log, waits } = fake({ konfirmasi: () => apiErr('RULE_VIOLATION', 'Isi file tidak cocok dengan tipe PDF.') });
    await expect(unggahLampiran(d, 'NTR-00001', PDF)).rejects.toMatchObject({ tahap: 'memverifikasi', bisaCobaLagi: false, message: 'Isi file tidak cocok dengan tipe PDF.' });
    expect(log.filter((l) => l.startsWith('konfirmasi'))).toHaveLength(1); expect(waits).toEqual([]);
  });
  it('dibatalkan (signal) saat PUT -> galat "dibatalkan", tanpa konfirmasi', async () => {
    const ac = new AbortController();
    const { d, log } = fake({ put: async () => { ac.abort(); throw new GalatPut('x'); } });
    await expect(unggahLampiran(d, 'NTR-00001', PDF, { signal: ac.signal })).rejects.toMatchObject({ tahap: 'mengunggah', message: 'Unggah dibatalkan.' });
    expect(log.some((l) => l.startsWith('konfirmasi'))).toBe(false);
  });
  it('ID dokumen di-encode di path (tidak bisa menyisipkan segmen)', async () => {
    const paths: string[] = [];
    const { d } = fake(); const api0 = d.api;
    d.api = (async (p: string, i?: never) => { paths.push(p); return api0(p, i); }) as typeof d.api;
    await unggahLampiran(d, 'NTR-00001/../x', PDF);
    expect(paths[0]).toBe('/api/pengajuan/NTR-00001%2F..%2Fx/lampiran/sesi');
  });
});
