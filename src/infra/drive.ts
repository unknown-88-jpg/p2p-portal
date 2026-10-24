import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { checkDriveAllowed } from '@/lib/trial-guard';
import type { DriveFileMeta, DrivePort, DriveStream } from '@/ports/drive';
import { gfetch, gfetchRaw } from './google';

const API = 'https://www.googleapis.com/drive/v3';
const META_FIELDS = 'id,name,size,mimeType,parents,trashed,createdTime';
const STREAM_TIMEOUT_MS = 55_000; // batas fungsi Vercel; timeout 9 dtk standar akan memotong body yang di-stream

interface RawMeta { id: string; name: string; size?: string; mimeType: string; parents?: string[]; trashed?: boolean; createdTime?: string }
const toMeta = (m: RawMeta): DriveFileMeta => ({
  id: m.id, name: m.name, size: Number(m.size ?? 0), mimeType: m.mimeType, parents: m.parents ?? [], trashed: !!m.trashed, createdMs: Date.parse(m.createdTime ?? '') || 0,
});

async function fail(r: Response, what: string): Promise<never> {
  const status = r.status;
  await r.body?.cancel().catch(() => undefined);
  if (status === 429 || status >= 500) throw new AppError('UPSTREAM_BUSY', `Drive sedang sibuk (${what}). Coba lagi sebentar.`, undefined, 3);
  throw new AppError('INTERNAL', `Drive ${what} gagal (${status}).`);
}

let folderOk = false;
/** D6: folder harus ada di Shared Drive (service account tak punya kuota) dan, di trial, drive-nya berjudul DUMMY. Dicek sekali per instance. */
async function assertFolderAllowed(folderId: string): Promise<void> {
  if (folderOk) return;
  const r = await gfetch(`${API}/files/${folderId}?supportsAllDrives=true&fields=name,driveId,capabilities(canAddChildren)`);
  if (!r.ok) return fail(r, 'cek folder');
  const f = (await r.json()) as { driveId?: string; capabilities?: { canAddChildren?: boolean } };
  if (!f.driveId) throw new AppError('FORBIDDEN', 'Folder lampiran harus berada di Shared Drive.');
  if (!f.capabilities?.canAddChildren) throw new AppError('FORBIDDEN', 'Service account tidak boleh menambah file di folder lampiran.');
  const dr = await gfetch(`${API}/drives/${f.driveId}?fields=name`);
  if (!dr.ok) return fail(dr, 'cek Shared Drive');
  const driveName = ((await dr.json()) as { name?: string }).name ?? '';
  const why = checkDriveAllowed({ appEnv: env().APP_ENV, driveName });
  if (why) throw new AppError('FORBIDDEN', why);
  folderOk = true;
}

export class GoogleDrive implements DrivePort {
  readonly folderId: string;
  constructor(folderId = env().DRIVE_ROOT_ID) { this.folderId = folderId; }

  async createUploadSession(a: { name: string; size: number; mimeType: string; origin: string }): Promise<{ sessionUrl: string }> {
    await assertFolderAllowed(this.folderId);
    const r = await gfetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=${META_FIELDS}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': a.mimeType, 'x-upload-content-length': String(a.size),
        origin: a.origin, // wajib agar browser boleh PUT langsung ke URL sesi (CORS; terbukti S3)
      },
      body: JSON.stringify({ name: a.name, parents: [this.folderId] }),
    });
    if (!r.ok) return fail(r, 'membuat sesi upload');
    const sessionUrl = r.headers.get('location');
    if (!sessionUrl) throw new AppError('INTERNAL', 'Drive tidak mengembalikan URL sesi.');
    return { sessionUrl };
  }

  async getMeta(fileId: string): Promise<DriveFileMeta | null> {
    const r = await gfetch(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${META_FIELDS}`);
    if (r.status === 404 || r.status === 403) { await r.body?.cancel().catch(() => undefined); return null; }
    if (!r.ok) return fail(r, 'baca metadata');
    return toMeta((await r.json()) as RawMeta);
  }

  async readHead(fileId: string, n: number): Promise<Uint8Array> {
    const r = await gfetch(`https://www.googleapis.com/download/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { range: `bytes=0-${n - 1}` } });
    if (!r.ok) return fail(r, 'baca awal file');
    return new Uint8Array(await r.arrayBuffer()).slice(0, n);
  }

  async open(fileId: string): Promise<DriveStream> {
    let r: Response;
    try { r = await gfetchRaw(`https://www.googleapis.com/download/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}, STREAM_TIMEOUT_MS); }
    catch (e) { if (e instanceof AppError) throw e; throw new AppError('UPSTREAM_BUSY', 'Drive tidak merespons tepat waktu.', undefined, 3); }
    if (r.status === 404) { await r.body?.cancel().catch(() => undefined); throw new AppError('NOT_FOUND', 'Lampiran tidak ditemukan di Drive.'); }
    if (!r.ok) return fail(r, 'unduh');
    const len = r.headers.get('content-length');
    return { body: r.body, mimeType: r.headers.get('content-type') ?? 'application/octet-stream', size: len ? Number(len) : null };
  }

  async trash(fileId: string): Promise<void> {
    const r = await gfetch(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    });
    if (r.status === 404) { await r.body?.cancel().catch(() => undefined); return; }
    if (!r.ok) return fail(r, 'trash');
    await r.body?.cancel().catch(() => undefined);
  }

  async createFile(a: { name: string; mimeType: string; content: string }): Promise<DriveFileMeta> {
    await assertFolderAllowed(this.folderId);
    const boundary = `p2p${crypto.randomUUID().replace(/-/g, '')}`;
    const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: a.name, parents: [this.folderId], mimeType: a.mimeType })}\r\n`
      + `--${boundary}\r\ncontent-type: ${a.mimeType}; charset=UTF-8\r\n\r\n${a.content}\r\n--${boundary}--`;
    const r = await gfetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${META_FIELDS}`, {
      method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
    });
    if (!r.ok) return fail(r, 'membuat file');
    return toMeta((await r.json()) as RawMeta);
  }

  async listOld(a: { namePrefix: string; createdBeforeMs: number; limit: number }): Promise<DriveFileMeta[]> {
    const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `'${this.folderId}' in parents and trashed=false and name contains '${esc(a.namePrefix)}' and createdTime < '${new Date(a.createdBeforeMs).toISOString()}'`;
    const r = await gfetch(`${API}/files?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=${Math.min(a.limit, 200)}&orderBy=createdTime&q=${encodeURIComponent(q)}&fields=files(${META_FIELDS})`);
    if (!r.ok) return fail(r, 'daftar file');
    return ((await r.json()) as { files?: RawMeta[] }).files?.map(toMeta) ?? [];
  }
}
