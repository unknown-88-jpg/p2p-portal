/** Operasi Drive minimum untuk lampiran. Semua file ada di SATU folder (Shared Drive); implementasi tahu ID foldernya. */
export interface DriveFileMeta {
  id: string; name: string; size: number; mimeType: string; parents: string[]; trashed: boolean;
  /** epoch ms */ createdMs: number;
}
export interface DriveStream { body: ReadableStream<Uint8Array> | null; mimeType: string; size: number | null }

export interface DrivePort {
  readonly folderId: string;
  /** Buat sesi upload resumable; browser mem-PUT langsung ke `sessionUrl` (kredensial pembawa: JANGAN di-log). */
  createUploadSession(a: { name: string; size: number; mimeType: string; origin: string }): Promise<{ sessionUrl: string }>;
  /** null bila file tidak ada / tidak terlihat. */
  getMeta(fileId: string): Promise<DriveFileMeta | null>;
  /** n byte pertama (untuk magic bytes). */
  readHead(fileId: string, n: number): Promise<Uint8Array>;
  open(fileId: string): Promise<DriveStream>;
  trash(fileId: string): Promise<void>;
  /** File di folder ini yang namanya diawali `namePrefix`, dibuat sebelum `createdBeforeMs`, belum di-trash. */
  listOld(a: { namePrefix: string; createdBeforeMs: number; limit: number }): Promise<DriveFileMeta[]>;
}
