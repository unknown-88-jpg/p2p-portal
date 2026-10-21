import { AppError } from '@/lib/errors';
import type { Clock } from '@/lib/clock';
import type { DriveFileMeta, DrivePort, DriveStream } from '@/ports/drive';

interface Stored { meta: DriveFileMeta; bytes: Uint8Array }
interface Session { name: string; size: number; mimeType: string; origin: string }

/** Drive palsu di memori. `upload()` meniru PUT browser ke URL sesi (satu-satunya jalan file masuk, seperti Drive asli). */
export class MemoryDrive implements DrivePort {
  readonly folderId = 'FOLDER-TEST-0000000000';
  files = new Map<string, Stored>();
  sessions = new Map<string, Session>();
  calls: string[] = [];
  /** Paksa kegagalan (mis. Drive down) untuk metode tertentu. */
  failOn = new Set<string>();
  private n = 0;
  constructor(private clock: Clock) {}
  private guard(m: string): void { this.calls.push(m); if (this.failOn.has(m)) throw new AppError('UPSTREAM_BUSY', `Drive ${m} gagal (test).`, undefined, 3); }

  async createUploadSession(a: Session): Promise<{ sessionUrl: string }> {
    this.guard('createUploadSession');
    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=SESS-${++this.n}`;
    this.sessions.set(url, a);
    return { sessionUrl: url };
  }
  /** Simulasi PUT browser. `override` = apa yang sebenarnya diunggah klien nakal (isi/ukuran/tipe berbeda dari yang dideklarasikan). */
  upload(sessionUrl: string, bytes: Uint8Array, override: { mimeType?: string } = {}): string {
    const s = this.sessions.get(sessionUrl);
    if (!s) throw new Error('sesi tidak ada');
    const id = `FILE${String(++this.n).padStart(16, '0')}`;
    this.files.set(id, { bytes, meta: { id, name: s.name, size: bytes.length, mimeType: override.mimeType ?? s.mimeType, parents: [this.folderId], trashed: false, createdMs: this.clock.now() } });
    return id;
  }
  /** File sembarang di luar alur sesi (mis. file orang lain / file lama sistem lama). */
  put(meta: Partial<DriveFileMeta> & { id: string; name: string }, bytes: Uint8Array): void {
    this.files.set(meta.id, { bytes, meta: { size: bytes.length, mimeType: 'application/pdf', parents: [this.folderId], trashed: false, createdMs: this.clock.now(), ...meta } });
  }
  alive(id: string): boolean { const f = this.files.get(id); return !!f && !f.meta.trashed; }

  async getMeta(id: string): Promise<DriveFileMeta | null> { this.guard('getMeta'); const f = this.files.get(id); return f ? { ...f.meta } : null; }
  async readHead(id: string, n: number): Promise<Uint8Array> { this.guard('readHead'); const f = this.files.get(id); if (!f) throw new AppError('NOT_FOUND', 'tidak ada'); return f.bytes.slice(0, n); }
  async open(id: string): Promise<DriveStream> {
    this.guard('open');
    const f = this.files.get(id);
    if (!f || f.meta.trashed) throw new AppError('NOT_FOUND', 'Lampiran tidak ditemukan di Drive.');
    const bytes = f.bytes;
    return { mimeType: f.meta.mimeType, size: bytes.length, body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
  }
  async trash(id: string): Promise<void> { this.guard('trash'); const f = this.files.get(id); if (f) f.meta.trashed = true; }
  async listOld(a: { namePrefix: string; createdBeforeMs: number; limit: number }): Promise<DriveFileMeta[]> {
    this.guard('listOld');
    return [...this.files.values()].map((f) => f.meta).filter((m) => !m.trashed && m.name.startsWith(a.namePrefix) && m.createdMs < a.createdBeforeMs).slice(0, a.limit).map((m) => ({ ...m }));
  }
}
