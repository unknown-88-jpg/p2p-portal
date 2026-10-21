import { randomBytes } from 'node:crypto';
import { canViewDocument } from '@/domain/capabilities';
import { RuleError } from '@/domain/errors';
import { num, str, upper } from '@/domain/legacy-parse';
import {
  cocokMagic, fileIdDariUrl, LAMPIRAN_MAX_BYTES, MIME_LAMPIRAN, namaFileServer, POLA_NAMA_SERVER, urlFileDrive, validasiUnggahan, type UnggahanInput,
} from '@/domain/lampiran';
import { normEmail } from '@/domain/roles';
import { STATUS } from '@/domain/status';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { toSheetSerial } from '@/lib/time';
import { TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { CellValue, Mutation, RawRow } from '@/ports/store';
import type { DrivePort } from '@/ports/drive';
import { auditMutation } from './audit';
import type { SessionData } from './auth';
import { findRowById } from './row-index';
import { runAction, type UowDeps } from './uow';

export interface LampiranDeps extends UowDeps { drive: DrivePort }

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const cell = (r: RawRow, k: string): CellValue => r[T(k)] ?? null;
const BOLEH_EDIT: readonly string[] = [STATUS.DRAFT, STATUS.REVISION];
const PENDING_TTL_MS = 2 * 3_600_000;
const RATE_MAX = 30, RATE_WINDOW_MS = 3_600_000;
const YATIM_UMUR_MS = 24 * 3_600_000;

interface Pending { idTrx: string; email: string; name: string; size: number; mime: string; namaAsli: string }
const pendingKey = (uploadId: string): string => `upl:${uploadId}`;
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

const isOwner = (s: SessionData, r: RawRow): boolean => !!normEmail(s.email) && normEmail(str(cell(r, 'CREATED_BY'))) === normEmail(s.email);
class SudahTerpasang extends Error {}

async function barisMilikku(d: LampiranDeps, s: SessionData, idTrx: string): Promise<{ row: number; data: RawRow }> {
  const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  if (!f || !isOwner(s, f.data)) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.'); // bukan pemilik = 404 (tidak membocorkan ID)
  const status = str(cell(f.data, 'STATUS'));
  if (!BOLEH_EDIT.includes(status)) throw new AppError('CONFLICT', `Dokumen berstatus "${status}" sudah terkunci; lampiran tidak bisa diganti.`);
  return f;
}

// ------------------------------------------------------------------ 1. mulai: sesi upload resumable
export async function mulaiUnggah(d: LampiranDeps, s: SessionData, idTrx: string, input: UnggahanInput, origin: string) {
  await barisMilikku(d, s, idTrx);
  try { validasiUnggahan(input); } catch (e) { if (e instanceof RuleError) throw new AppError('RULE_VIOLATION', e.message); throw e; }

  const rk = `upl:rate:${normEmail(s.email)}`;
  const n = await d.redis.incr(rk);
  if (n === 1) await d.redis.pexpire(rk, RATE_WINDOW_MS);
  if (n > RATE_MAX) throw new AppError('RATE_LIMITED', 'Terlalu banyak upload. Coba lagi nanti.', undefined, 600);

  const name = namaFileServer({ idTrx, nowMs: d.clock.now(), acak: randomBytes(4).toString('hex').slice(0, 6), namaAsli: input.namaAsli, mimeType: input.mimeType });
  const { sessionUrl } = await d.drive.createUploadSession({ name, size: input.size, mimeType: input.mimeType, origin });
  const uploadId = randomBytes(24).toString('base64url');
  const p: Pending = { idTrx, email: normEmail(s.email), name, size: input.size, mime: input.mimeType, namaAsli: input.namaAsli.slice(0, 120) };
  await d.redis.set(pendingKey(uploadId), JSON.stringify(p), { pxMs: PENDING_TTL_MS });
  // sessionUrl = kredensial pembawa: hanya dikembalikan ke pemilik, TIDAK di-log (redact.ts juga menyamarkan pola URL-nya).
  return { uploadId, sessionUrl, maxBytes: LAMPIRAN_MAX_BYTES };
}

// ------------------------------------------------------------------ 2. konfirmasi: server memverifikasi file SEBELUM menempel
export async function konfirmasiUnggah(d: LampiranDeps, s: SessionData, idTrx: string, input: { uploadId: string; fileId: string }) {
  if (!UPLOAD_ID_RE.test(input.uploadId) || !FILE_ID_RE.test(input.fileId)) throw new AppError('VALIDATION', 'Data konfirmasi tidak valid.');
  const raw = await d.redis.get(pendingKey(input.uploadId));
  const p = raw ? (JSON.parse(raw) as Pending) : null;
  if (!p || p.idTrx !== idTrx || p.email !== normEmail(s.email)) {
    // Sudah terpasang oleh konfirmasi sebelumnya (klik ganda / retry)? Anggap sukses.
    const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
    if (f && isOwner(s, f.data) && fileIdDariUrl(cell(f.data, 'FILE_URL')) === input.fileId) return { punyaLampiran: true as const };
    throw new AppError('NOT_FOUND', 'Sesi upload tidak dikenal atau sudah kedaluwarsa. Ulangi dari awal.');
  }
  await barisMilikku(d, s, idTrx); // cepat gagal sebelum IO Drive; diulang di dalam lock

  const meta = await d.drive.getMeta(input.fileId);
  // Nama dibuat server + unik: klien tidak bisa menempelkan file lain (milik orang lain / file lama) sebagai lampiran.
  if (!meta || meta.trashed || meta.name !== p.name) throw new AppError('RULE_VIOLATION', 'File yang diunggah tidak ditemukan atau tidak cocok dengan sesi upload.');
  const buang = async (alasan: string): Promise<never> => {
    await d.drive.trash(meta.id).catch((e: unknown) => logger.warn('lampiran_trash_gagal', { err: e instanceof Error ? e.message : String(e) }));
    await d.redis.del(pendingKey(input.uploadId)).catch(() => undefined);
    throw new AppError('RULE_VIOLATION', alasan);
  };
  if (meta.parents.length !== 1 || meta.parents[0] !== d.drive.folderId) return buang('File berada di lokasi yang tidak semestinya.');
  if (meta.size !== p.size) return buang('Ukuran file tidak sesuai dengan yang dideklarasikan. Unggah ulang.');
  if (meta.size > LAMPIRAN_MAX_BYTES) return buang('File terlalu besar.');
  if (meta.mimeType !== p.mime || !Object.hasOwn(MIME_LAMPIRAN, meta.mimeType)) return buang('Tipe file tidak sesuai. Gunakan PDF, JPG, atau PNG.');
  if (!cocokMagic(p.mime, await d.drive.readHead(meta.id, 16))) return buang('Isi file tidak cocok dengan tipenya (bukan PDF/JPG/PNG sungguhan).');

  let lama = '';
  try {
    await runAction(d, {
      name: 'lampiran.konfirmasi', actor: s.email, lockKeys: [`trx:${idTrx}`],
      execute: async ({ store, clock }) => {
        const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
        if (!f || !isOwner(s, f.data)) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
        const status = str(cell(f.data, 'STATUS'));
        if (!BOLEH_EDIT.includes(status)) throw new AppError('CONFLICT', `Dokumen berstatus "${status}" sudah terkunci; lampiran tidak bisa diganti.`);
        const sekarang = fileIdDariUrl(cell(f.data, 'FILE_URL'));
        if (sekarang === meta.id) throw new SudahTerpasang();
        lama = sekarang;
        const mutations: Mutation[] = [
          { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { FILE_URL: urlFileDrive(meta.id), LAST_UPDATE: toSheetSerial(clock.now()) } },
          auditMutation({ actor: s.email, idTrx, action: 'UPLOAD', field: 'Lampiran', oldValue: sekarang || '', newValue: meta.id, notes: `${p.namaAsli} (${p.mime}, ${num(meta.size)} byte)` }, clock),
        ];
        return { mutations, result: { ok: true } };
      },
    });
  } catch (e) {
    if (!(e instanceof SudahTerpasang)) throw e;
    lama = '';
  }
  await d.redis.del(pendingKey(input.uploadId)).catch(() => undefined);
  // Lampiran pengganti: bersihkan file lama buatan server (best-effort; file lama dari sistem lama TIDAK pernah disentuh).
  if (lama && lama !== meta.id) await trashJikaBuatanServer(d.drive, lama);
  return { punyaLampiran: true as const, namaFile: p.namaAsli, size: meta.size, mimeType: meta.mimeType };
}

async function trashJikaBuatanServer(drive: DrivePort, fileId: string): Promise<void> {
  try {
    const m = await drive.getMeta(fileId);
    if (m && !m.trashed && m.parents.includes(drive.folderId) && POLA_NAMA_SERVER.test(m.name)) await drive.trash(fileId);
  } catch (e) { logger.warn('lampiran_lama_gagal_dibersihkan', { err: e instanceof Error ? e.message : String(e) }); }
}

// ------------------------------------------------------------------ 3. proxy baca (I13)
/** Stream lampiran lewat server. Pemilik, Manager berwenang, atau Finance+ (canViewDocument); selain itu 404. Tidak pernah memberi link Drive ke klien. */
export async function bukaLampiran(d: LampiranDeps, s: SessionData, idTrx: string): Promise<Response> {
  const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  const r = f?.data;
  if (!r || !canViewDocument(s.roles, s.email, { createdBy: str(cell(r, 'CREATED_BY')), brand: upper(str(cell(r, 'BRAND'))), dept: upper(str(cell(r, 'DEPARTEMENT'))) })) {
    throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
  }
  const fileId = fileIdDariUrl(cell(r, 'FILE_URL'));
  if (!fileId) throw new AppError('NOT_FOUND', 'Dokumen ini tidak punya lampiran invoice.');
  const st = await d.drive.open(fileId);
  const ext = MIME_LAMPIRAN[st.mimeType];
  const headers = new Headers({
    'content-type': ext ? st.mimeType : 'application/octet-stream',
    // Nama dibuat server (bukan dari klien/Drive) -> tidak ada injeksi header. Tipe di luar whitelist (file lama) dipaksa unduh, tidak pernah dirender.
    'content-disposition': ext ? `inline; filename="lampiran-${idTrx}.${ext}"` : `attachment; filename="lampiran-${idTrx}.bin"`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300', 'referrer-policy': 'no-referrer',
  });
  // Gambar: tak perlu apa pun selain ditampilkan -> sandbox total. (PDF tidak diberi sandbox: penampil PDF browser tak jalan di dalamnya.)
  if (ext && st.mimeType.startsWith('image/')) headers.set('content-security-policy', "default-src 'none'; sandbox");
  if (st.size !== null) headers.set('content-length', String(st.size));
  return new Response(st.body, { status: 200, headers });
}

// ------------------------------------------------------------------ 4. housekeeping: file yatim
/** Trash file buatan server yang > 24 jam dan tidak dirujuk pengajuan mana pun (upload tanpa konfirmasi). Daftar Drive DIAMBIL DULU, baru sheet dibaca (konfirmasi di sela keduanya tetap terlihat). */
export async function bersihkanYatim(d: LampiranDeps, maxTrash = 100): Promise<{ diperiksa: number; ditrash: number }> {
  const tua = await d.drive.listOld({ namePrefix: 'invoice_', createdBeforeMs: d.clock.now() - YATIM_UMUR_MS, limit: 200 });
  const kandidat = tua.filter((m) => POLA_NAMA_SERVER.test(m.name) && m.parents.includes(d.drive.folderId));
  if (!kandidat.length) return { diperiksa: tua.length, ditrash: 0 };
  const rows = await d.store.readRows(TRX_PENGAJUAN); // gagal baca = batalkan (jangan pernah trash tanpa tahu rujukan)
  const dirujuk = new Set(rows.map((r) => fileIdDariUrl(r[T('FILE_URL')])).filter(Boolean));
  let n = 0;
  for (const m of kandidat) {
    if (n >= maxTrash) break;
    if (dirujuk.has(m.id)) continue;
    await d.drive.trash(m.id);
    n++;
  }
  logger.info('lampiran_yatim_dibersihkan', { diperiksa: tua.length, ditrash: n });
  return { diperiksa: tua.length, ditrash: n };
}
