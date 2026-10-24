import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_LOG, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { JADWAL_DIGEST_WIB, pesanPengingatPIC } from '@/domain/wa';
import { createDraft, submitPengajuan } from '@/server/pengajuan';
import type { SessionData } from '@/server/auth';
import { kirimWaManual, sudahKirimHariIni } from '@/server/wa-manual';
import { AppError } from '@/lib/errors';
import { authWorld, USERS } from './auth-helpers';

const C = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const PH = { budi: '6281200000001', fajar: '6281200000009', dual: '6281200000010' };
const sess = (o: Partial<SessionData> & Pick<SessionData, 'email' | 'nama' | 'roles'>): SessionData => ({ phone: '6280000000000', jabatan: 'X', created: 0, ep: 0, ...o });
const citra = sess({ email: 'citra@x.id', nama: 'Citra', phone: '6281200000002', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
const dual = sess({ email: 'dual@x.id', nama: 'Dual', phone: PH.dual, roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND A', dept: 'DEPT X', level: 2 }] });

let w: ReturnType<typeof authWorld>;
let n = 0;
const setCell = (id: string, k: string, v: string | number): void => w.store.reorder(TRX_PENGAJUAN, (rows) => rows.map((r) => { if (r[C('ID_TRX')] === id) r[C(k)] = v; return r; }));
const to = (phone: string): string[] => w.wa.sent.filter((m) => m.to === phone).map((m) => m.text);
const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

async function draft(by: SessionData = citra, amount = 1_000_000): Promise<string> {
  const r = await createDraft(w.deps, by, { tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: `INV-F15-${++n}`, dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: amount, statusPPN: 'Non PPN' });
  setCell(r.id, 'FILE_URL', 'https://drive.google.com/file/d/abc/view');
  return r.id;
}
async function submitted(by: SessionData = citra, amount = 1_000_000): Promise<string> {
  const id = await draft(by, amount);
  await submitPengajuan(w.deps, by, id, `idem-f15-${String(++n).padStart(8, '0')}`, true);
  return id;
}

beforeEach(() => {
  w = authWorld();
  w.store.seed(MASTER_USER_TTD, [
    ...USERS,
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Fajar', 'fajar@x.id', 'YES', '081200000009', null, null],
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ['BRAND A', 'DEPT X', 2, 'Manager', 'Dual', 'dual@x.id', 'YES', '081200000010', null, null],
    ['BRAND B', 'DEPT Y', 2, 'Manager', 'Bunga', 'bb@x.id', 'YES', '081200000011', null, null],
    ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],
  ]);
  w.store.seed(MASTER_SETTING, [['PT A', 'BRAND A', '', '', 'HL'], ['PT B', 'BRAND B', '', '', 'HM']]);
  w.store.seed(MASTER_VENDOR, [['V3', 'Gama', 'Non-Trade', '', '', '', '', 'Approved']]);
  w.store.seed(TRX_PENGAJUAN, []); w.store.seed(TRX_APPROVAL, []);
});

describe('F-15 kirim WA manual oleh PIC', () => {
  it('mengirim pengingat ke Manager berwenang (bukan divisi lain), dengan kode < 5 jt; tercatat di audit', async () => {
    const id = await submitted();
    const r = await kirimWaManual(w.deps, citra, id, true);
    expect(r).toEqual({ manager: 3, terkirim: 3 }); // budi, fajar, dual
    for (const p of [PH.budi, PH.fajar, PH.dual]) {
      const t = to(p).at(-1)!;
      expect(t).toContain('Pengingat persetujuan'); expect(t).toContain(id); expect(t).toContain('Citra');
      expect(t).toMatch(/SETUJU \d{4}/);
    }
    expect(to('6281200000011')).toHaveLength(0);
    const CL = (k: string): number => colIndex(AUDIT_LOG, k);
    expect(w.store.rowsOf(AUDIT_LOG).some((a) => a[CL('ID_Trx')] === id && a[CL('Action')] === 'WA_REMINDER_MANUAL')).toBe(true);
  });
  it('>= Rp 5 jt: tanpa kode, hanya link web', async () => {
    const id = await submitted(citra, 7_500_000);
    await kirimWaManual(w.deps, citra, id, true);
    const t = to(PH.budi).at(-1)!;
    expect(t).not.toMatch(/SETUJU \d{4}/); expect(t).toContain('/persetujuan?id=');
    expect(await w.redis.get(`wa:d:${PH.budi}:${id}`)).toBeNull();
  });
  it('maks. 1x per hari WIB per dokumen; besok boleh lagi; dokumen lain tidak terpengaruh', async () => {
    const a = await submitted(), b = await submitted();
    expect(await kode(kirimWaManual(w.deps, citra, a, true))).toBe('OK');
    const kirimKedua = kirimWaManual(w.deps, citra, a, true);
    await expect(kirimKedua).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await kirimKedua.catch((e: AppError) => expect(e.retryAfterSec).toBeGreaterThan(0));
    expect(await kode(kirimWaManual(w.deps, citra, b, true))).toBe('OK');
    expect([...(await sudahKirimHariIni(w.deps, [a, b]))].sort()).toEqual([a, b].sort());
    w.clock.t += 24 * 3_600_000; // hari WIB berikutnya
    expect(await sudahKirimHariIni(w.deps, [a])).toEqual(new Set());
    expect(await kode(kirimWaManual(w.deps, citra, a, true))).toBe('OK');
  });
  it('batas hari mengikuti WIB, bukan UTC: 23.59 WIB lalu 00.01 WIB = hari baru', async () => {
    const id = await submitted();
    w.clock.t = Date.UTC(2026, 9, 5, 16, 59, 0); // 23.59 WIB
    expect(await kode(kirimWaManual(w.deps, citra, id, true))).toBe('OK');
    w.clock.t = Date.UTC(2026, 9, 5, 17, 1, 0);  // 00.01 WIB besoknya
    expect(await kode(kirimWaManual(w.deps, citra, id, true))).toBe('OK');
  });
  it('bukan pemilik / tidak ada = 404; bukan Menunggu Manager = 422; tidak mengirim apa pun', async () => {
    const id = await submitted();
    const dr = await draft();
    const lain = sess({ email: 'orang@x.id', nama: 'Orang', roles: [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }] });
    w.wa.sent.length = 0;
    expect(await kode(kirimWaManual(w.deps, lain, id, true))).toBe('NOT_FOUND');
    expect(await kode(kirimWaManual(w.deps, citra, 'NTR-99999', true))).toBe('NOT_FOUND');
    expect(await kode(kirimWaManual(w.deps, citra, dr, true))).toBe('RULE_VIOLATION');
    setCell(id, 'STATUS', 'Manager Approved');
    expect(await kode(kirimWaManual(w.deps, citra, id, true))).toBe('RULE_VIOLATION');
    expect(w.wa.sent).toHaveLength(0);
  });
  it('SoD: pembuat yang juga Manager tidak dikirimi pengingat dokumennya sendiri', async () => {
    const id = await submitted(dual);
    const r = await kirimWaManual(w.deps, dual, id, true);
    expect(r.manager).toBe(2);
    expect(to(PH.dual)).toHaveLength(0);
  });
  it('semua kirim gagal = 503 dan jatah hari itu DIKEMBALIKAN (bisa coba lagi)', async () => {
    const id = await submitted();
    const asli = w.wa.send.bind(w.wa);
    w.wa.send = async () => ({ ok: false, info: 'gateway mati' });
    expect(await kode(kirimWaManual(w.deps, citra, id, true))).toBe('UPSTREAM_BUSY');
    expect(await sudahKirimHariIni(w.deps, [id])).toEqual(new Set());
    w.wa.send = asli;
    expect(await kode(kirimWaManual(w.deps, citra, id, true))).toBe('OK');
  });
  it('tidak ada Manager penerima = 422 dan jatah dikembalikan', async () => {
    const id = await submitted();
    setCell(id, 'BRAND', 'BRAND Z');
    expect(await kode(kirimWaManual(w.deps, citra, id, true))).toBe('RULE_VIOLATION');
    expect(await sudahKirimHariIni(w.deps, [id])).toEqual(new Set());
  });
});

describe('F-15 jadwal digest', () => {
  it('teks jadwal di UI sama dengan cron GitHub Actions (UTC -> WIB)', () => {
    const yml = readFileSync('.github/workflows/digest.yml', 'utf8');
    const m = /cron:\s*'(\d+) ([\d,]+) \* \* 1-5'/.exec(yml)!;
    expect(m).not.toBeNull();
    const wib = m[2]!.split(',').map((h) => `${String((Number(h) + 7) % 24).padStart(2, '0')}.${m[1]!.padStart(2, '0')}`);
    expect(wib).toEqual([...JADWAL_DIGEST_WIB]);
  });
  it('pesan pengingat menyebut pengirim dan dokumen', () => {
    const t = pesanPengingatPIC({ nama: 'Budi', pengirim: 'Citra', linkInbox: 'https://x/persetujuan', item: { idTrx: 'NTR-00001', vendor: 'Gama', pic: 'Citra', nominal: 1_000_000, perluCFO: false, kode: '1234', link: 'https://x/persetujuan?id=NTR-00001' } });
    expect(t).toContain('Halo Budi, Citra meminta persetujuan'); expect(t).toContain('SETUJU 1234');
  });
});
