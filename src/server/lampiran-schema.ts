import { z } from 'zod';
import { LAMPIRAN_MAX_BYTES } from '@/domain/lampiran';

export const sesiUnggahSchema = z.object({
  namaAsli: z.string().min(1).max(200),
  size: z.number().int().positive().max(LAMPIRAN_MAX_BYTES * 2), // batas sebenarnya (10 MB) ditegakkan domain dengan pesan Indonesia
  mimeType: z.string().min(1).max(100),
}).strict();

export const konfirmasiUnggahSchema = z.object({
  uploadId: z.string().min(20).max(64),
  fileId: z.string().min(10).max(100),
}).strict();
