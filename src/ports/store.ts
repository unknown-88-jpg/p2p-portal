import type { TabSchema } from '@/repo/schema';

export type CellValue = string | number | boolean | null;
/** Satu baris data, sejajar dengan schema.cols (dipadatkan dengan null). */
export type RawRow = CellValue[];

export type Mutation =
  | { kind: 'update'; schema: TabSchema; /** nomor baris sheet (1-based; data mulai baris 2) */ row: number; cells: Record<string, CellValue> }
  | { kind: 'append'; schema: TabSchema; cells: Record<string, CellValue> };

export interface ReadOpts { /** tolak sel error rumus (#N/A, #REF!, ...) — untuk tab IMPORTRANGE */ rejectErrors?: boolean }

export interface TableStore {
  /** Semua baris data (mulai baris 2), BACA SEGAR. Baris kosong di tengah tetap ada (posisi dipertahankan). */
  readRows(schema: TabSchema, opts?: ReadOpts): Promise<RawRow[]>;
  readColumn(schema: TabSchema, key: string, opts?: ReadOpts): Promise<CellValue[]>;
  /** null bila baris kosong/di luar rentang. */
  readRow(schema: TabSchema, row: number): Promise<RawRow | null>;
  /** ATOMIK: semua mutasi berlaku atau tidak ada yang berlaku (spreadsheets.batchUpdate; S2). */
  applyBatch(mutations: readonly Mutation[]): Promise<void>;
}

/** Hasil tulis tidak pasti (timeout/5xx): batch MUNGKIN sudah berlaku. Pemanggil tidak boleh mengulang buta. */
export class AmbiguousWriteError extends Error {
  constructor(message = 'Hasil penulisan tidak pasti (batch mungkin sudah berlaku).') {
    super(message);
    this.name = 'AmbiguousWriteError';
  }
}

/** Nilai awal 0-based dari nomor baris data. */
export const FIRST_DATA_ROW = 2;
