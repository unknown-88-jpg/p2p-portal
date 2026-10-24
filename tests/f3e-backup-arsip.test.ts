import { beforeEach, describe, expect, it } from 'vitest';
import { batasArsip, kandidatArsip, namaBackup, pilihHapusBackup, seninDari, tglBackup } from '@/domain/backup';
import { AppError } from '@/lib/errors';
import type { RawRow } from '@/ports/store';
import { AUDIT_LOG, TRX_PENGAJUAN, type TabSchema } from '@/repo/schema';
import type { SessionData } from '@/server/auth';
import { cekArsip } from '@/server/admin';
import { jalankanBackup } from '@/server/backup';
import { authWorld } from './auth-helpers';

const kode = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const S = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000 + 25569;
const baris = (schema: TabSchema, o: Record<string, unknown>): RawRow => schema.cols.map((c) => (o[c.key] ?? null) as RawRow[number]);
const hari = (mulai: string, n: number): string[] => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${mulai}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10));

describe('F3-E domain', () => {
  it('nama backup & Senin ISO', () => {
    expect(namaBackup('2026-10-24')).toBe('BACKUP_P2P_2026-10-24');
    expect([tglBackup('BACKUP_P2P_2026-10-24'), tglBackup('BACKUP_P2P_2026-10-24 (1)'), tglBackup('invoice_x')]).toEqual(['2026-10-24', null, null]);
    expect([seninDari('2026-10-24'), seninDari('2026-10-19'), seninDari('2026-10-25')]).toEqual(['2026-10-19', '2026-10-19', '2026-10-19']); // Sabtu, Senin, Minggu
  });

  it('retensi: 7 tanggal terbaru + terbaru dari 4 minggu terbaru; file lain tidak pernah dihapus', () => {
    const files = [...hari('2026-10-24', 40).map((t) => ({ id: t, name: namaBackup(t) })), { id: 'LAIN', name: 'catatan.txt' }, { id: 'DUP', name: 'BACKUP_P2P_2026-10-24' }];
    const hapus = pilihHapusBackup(files, '2026-10-24');
    const simpan = files.map((f) => f.id).filter((id) => !hapus.includes(id));
    // harian: 24..18 Okt (7); mingguan (Senin 19 Okt, 12 Okt, 5 Okt, 28 Sep): terbaru tiap minggu = 24 Okt, 18 Okt, 11 Okt, 4 Okt
    expect(simpan.sort()).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', 'DUP', 'LAIN'].sort());
    expect(hapus).toContain('2026-10-24'); // dua backup bertanggal sama: yang ber-ID lebih besar ("DUP") dipertahankan, satu lagi dihapus
    expect(pilihHapusBackup([{ id: 'X', name: namaBackup('2026-12-01') }], '2026-10-24')).toEqual([]); // tanggal masa depan dibiarkan
  });

  it('batas arsip 18 bulan (akhir bulan dijepit) & kandidat: hanya Paid yang lunas ≤ batas', () => {
    expect([batasArsip('2026-10-24'), batasArsip('2026-08-31'), batasArsip('2027-01-15')]).toEqual(['2025-04-24', '2025-02-28', '2025-07-15']);
    const k = kandidatArsip([
      { ID_TRX: 'A', STATUS: 'Paid', LAST_PAY_DATE: S('2025-04-24'), FINAL_AMOUNT: 1, VENDOR_NAME: 'V' },
      { ID_TRX: 'B', STATUS: 'Paid', LAST_PAY_DATE: S('2025-04-25') },
      { ID_TRX: 'C', STATUS: 'Partially Paid', LAST_PAY_DATE: S('2024-01-01') },
      { ID_TRX: 'D', STATUS: 'Paid', LAST_PAY_DATE: '', LAST_UPDATE: S('2024-12-01') },
      { ID_TRX: 'E', STATUS: 'Paid' },
    ], '2026-10-24');
    expect(k.batas).toBe('2025-04-24');
    expect(k.kandidat.map((x) => [x.id, x.lunas])).toEqual([['D', '2024-12-01'], ['A', '2025-04-24']]);
  });
});

describe('F3-E backup harian', () => {
  let w: ReturnType<typeof authWorld>;
  beforeEach(() => { w = authWorld(); w.clock.t = Date.parse('2026-10-24T18:30:00Z'); }); // 25 Okt 01:30 WIB

  it('menyalin sekali per hari WIB (idempoten), mencatat audit, menerapkan retensi', async () => {
    for (const t of hari('2026-10-24', 10)) w.drive.put({ id: `OLD${t}`, name: namaBackup(t), mimeType: 'application/vnd.google-apps.spreadsheet' }, new Uint8Array());
    w.drive.put({ id: 'INVOICE1', name: 'invoice_x.pdf' }, new Uint8Array([1]));
    const h = await jalankanBackup({ drive: w.drive, store: w.store, clock: w.clock }, 'SHEET-DUMMY');
    expect(h.dibuat).toBe('BACKUP_P2P_2026-10-25'); // tanggal WIB, bukan UTC
    // 11 backup (15..25 Okt). Harian: 19..25 Okt. Mingguan: minggu Senin 19 Okt -> 25 Okt, minggu Senin 12 Okt -> 18 Okt. Sisa 15–17 Okt dihapus.
    expect(h.disimpan).toBe(8);
    expect(h.dihapus.sort()).toEqual(['OLD2026-10-15', 'OLD2026-10-16', 'OLD2026-10-17']);
    expect(w.drive.alive('INVOICE1')).toBe(true);
    expect(w.audit().at(-1)).toMatchObject({ action: 'BACKUP', actor: 'system-cron' });
    const lagi = await jalankanBackup({ drive: w.drive, store: w.store, clock: w.clock }, 'SHEET-DUMMY');
    expect(lagi).toEqual({ dibuat: null, dihapus: [], disimpan: 8 });
    expect([...w.drive.files.values()].filter((f) => f.meta.name === 'BACKUP_P2P_2026-10-25')).toHaveLength(1);
  });

  it('salin gagal -> error dilempar, tidak ada yang dihapus', async () => {
    for (const t of hari('2026-10-24', 10)) w.drive.put({ id: `OLD${t}`, name: namaBackup(t) }, new Uint8Array());
    w.drive.failOn.add('copyInto');
    expect(await kode(jalankanBackup({ drive: w.drive, store: w.store, clock: w.clock }, 'SHEET-DUMMY'))).toBe('UPSTREAM_BUSY');
    expect([...w.drive.files.values()].filter((f) => !f.meta.trashed)).toHaveLength(10);
  });
});

describe('F3-E kandidat arsip (admin, baca saja)', () => {
  it('System Admin saja; tidak menulis apa pun', async () => {
    const w = authWorld();
    w.clock.t = Date.parse('2026-10-24T03:00:00Z');
    w.store.seed(TRX_PENGAJUAN, [baris(TRX_PENGAJUAN, { ID_TRX: 'NTR-1', STATUS: 'Paid', LAST_PAY_DATE: S('2025-01-10'), FINAL_AMOUNT: 5, VENDOR_NAME: 'V' })]);
    w.store.seed(AUDIT_LOG, []);
    const fs: SessionData = { phone: '62800', email: 'f@x.id', nama: 'F', jabatan: 'F', created: 0, ep: 0, roles: [{ brand: 'ALL', dept: 'ALL', level: 3 }] };
    expect(await kode(cekArsip(w.deps, fs))).toBe('FORBIDDEN');
    const n = w.store.batches.length;
    const r = await cekArsip(w.deps, { ...fs, roles: [{ brand: 'ALL', dept: 'ALL', level: 9 }] });
    expect(r).toMatchObject({ jumlahBaris: 1, batas: '2025-04-24', kandidat: [{ id: 'NTR-1', lunas: '2025-01-10' }] });
    expect(w.store.batches.length).toBe(n);
  });
});
