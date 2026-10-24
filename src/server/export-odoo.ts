import { can } from '@/domain/capabilities';
import { str } from '@/domain/legacy-parse';
import { keCsv, namaFileOdoo, PESAN_KOSONG_ODOO, susunJurnalOdoo, type JenisExport } from '@/domain/odoo';
import { AppError } from '@/lib/errors';
import { fmtWaktu } from '@/lib/time';
import type { RawRow } from '@/ports/store';
import { AUDIT_LOG, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex, type TabSchema } from '@/repo/schema';
import { appendAudit } from './audit';
import type { AuthDeps, SessionData } from './auth';

/** Baris sheet -> objek {kolom: nilai} (dipakai fungsi domain murni yang bekerja per nama kolom). */
export const keObjek = (schema: TabSchema, r: RawRow): Record<string, unknown> => Object.fromEntries(schema.cols.map((c, i) => [c.key, r[i] ?? null]));

export const AKSI_EXPORT_ODOO = 'EXPORT_ODOO';
const BATAS_PER_MENIT = 6;

function wajibExport(s: SessionData): void {
  if (!can(s.roles, 'export.odoo')) throw new AppError('FORBIDDEN', 'Akun Anda tidak berwenang meng-export jurnal Odoo.');
}

export interface HasilExport { namaFile: string; fileId: string; csv: string; jumlahPembelian: number; jumlahPembayaran: number; peringatan: string[] }

/**
 * F3-B (port exportJurnalOdoo): baca SEGAR Trx_Pengajuan + Trx_Payment_Log (angka akuntansi tidak pernah dari cache),
 * susun dua jenis jurnal, simpan CSV ke folder Shared Drive, catat riwayat di Audit_Log (EXPORT_ODOO), kembalikan CSV untuk diunduh.
 * Tidak mengubah data transaksi -> tanpa lock; audit = satu append mandiri (seperti writeAudit lama).
 */
export async function exportOdoo(d: AuthDeps, s: SessionData, input: { dari: string; sampai: string; jenis: JenisExport }): Promise<HasilExport> {
  wajibExport(s);
  if (input.dari > input.sampai) throw new AppError('VALIDATION', 'Tanggal mulai harus sebelum atau sama dengan tanggal selesai.', { sampai: 'sebelum tanggal mulai' });
  const kunci = `rl:export-odoo:${s.email.trim().toLowerCase()}:${Math.floor(d.clock.now() / 60_000)}`;
  const n = await d.redis.incr(kunci);
  if (n === 1) await d.redis.pexpire(kunci, 120_000);
  if (n > BATAS_PER_MENIT) throw new AppError('RATE_LIMITED', 'Terlalu sering export. Tunggu sebentar.', undefined, 60);

  const [pengajuan, pembayaran] = await Promise.all([d.store.readRows(TRX_PENGAJUAN), d.store.readRows(TRX_PAYMENT_LOG)]);
  const h = susunJurnalOdoo({
    pengajuan: pengajuan.map((r) => keObjek(TRX_PENGAJUAN, r)), pembayaran: pembayaran.map((r) => keObjek(TRX_PAYMENT_LOG, r)),
    dari: input.dari, sampai: input.sampai, jenis: input.jenis,
  });
  if (h.jumlahPembelian + h.jumlahPembayaran === 0) throw new AppError('RULE_VIOLATION', PESAN_KOSONG_ODOO);

  const csv = keCsv(h.rows);
  const namaFile = namaFileOdoo(input.jenis, input.dari, input.sampai);
  const file = await d.drive.createFile({ name: namaFile, mimeType: 'text/csv', content: csv });
  await appendAudit(d.store, d.clock, {
    actor: s.email, action: AKSI_EXPORT_ODOO, field: input.jenis, oldValue: `${input.dari}..${input.sampai}`,
    newValue: `${h.jumlahPembelian} pembelian, ${h.jumlahPembayaran} pembayaran`, notes: `${namaFile} | ${file.id}`,
  });
  return { namaFile, fileId: file.id, csv, jumlahPembelian: h.jumlahPembelian, jumlahPembayaran: h.jumlahPembayaran, peringatan: h.peringatan };
}

export interface RiwayatExport { waktu: string; oleh: string; jenis: string; rentang: string; jumlah: string; namaFile: string; fileId: string }

const pisahNotes = (notes: string): { namaFile: string; fileId: string } => {
  const [namaFile = '', fileId = ''] = notes.split('|').map((x) => x.trim().split(/\s+/)[0] ?? '');
  return { namaFile, fileId };
};

/** Riwayat export (terbaru dulu) dari Audit_Log — siapa, kapan, rentang, jumlah entry. */
export async function riwayatExport(d: AuthDeps, s: SessionData, batas = 20): Promise<RiwayatExport[]> {
  wajibExport(s);
  const rows = await d.store.readRows(AUDIT_LOG);
  const A = (r: RawRow, k: string): string => str(r[colIndex(AUDIT_LOG, k)]);
  const out: RiwayatExport[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < batas; i--) {
    const r = rows[i]!;
    if (A(r, 'Action') !== AKSI_EXPORT_ODOO) continue;
    out.push({ waktu: fmtWaktu(r[colIndex(AUDIT_LOG, 'Timestamp')]), oleh: A(r, 'User_Email'), jenis: A(r, 'Field'), rentang: A(r, 'Old_Value'), jumlah: A(r, 'New_Value'), ...pisahNotes(A(r, 'Notes')) });
  }
  return out;
}

/** Unduh ulang file export lama: hanya file yang TERCATAT di riwayat export (bukan sembarang file Drive / lampiran). */
export async function unduhExport(d: AuthDeps, s: SessionData, fileId: string): Promise<{ namaFile: string; body: ReadableStream<Uint8Array> | null }> {
  wajibExport(s);
  const notes = await d.store.readColumn(AUDIT_LOG, 'Notes');
  const actions = await d.store.readColumn(AUDIT_LOG, 'Action');
  const i = notes.findIndex((n, k) => str(actions[k]) === AKSI_EXPORT_ODOO && pisahNotes(str(n)).fileId === fileId);
  if (i < 0) throw new AppError('NOT_FOUND', 'File export tidak ditemukan.');
  const meta = await d.drive.getMeta(fileId);
  if (!meta || meta.trashed || !meta.parents.includes(d.drive.folderId)) throw new AppError('NOT_FOUND', 'File export sudah tidak ada di Drive.');
  const f = await d.drive.open(fileId);
  return { namaFile: pisahNotes(str(notes[i])).namaFile, body: f.body };
}
