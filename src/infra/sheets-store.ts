import type { Clock, Rng } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { toSheetSerial } from '@/lib/time';
import { colIndex, type ColType, type TabSchema } from '@/repo/schema';
import { AmbiguousWriteError, FIRST_DATA_ROW, type CellValue, type Mutation, type RawRow, type ReadOpts, type TableStore } from '@/ports/store';
import { GoogleHttpError, withRetry } from './retry';
import type { Quota } from './ratelimit';

export type RawFetch = (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ERR = /^#(N\/A|REF!|VALUE!|ERROR!|DIV\/0!|NAME\?|NUM!|NULL!)$|^Loading\.\.\.$/i;

export function colLetter(i0: number): string {
  let n = i0 + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---------- builder murni batchUpdate (diuji tanpa jaringan) ----------
type CellData = Record<string, unknown>;
const FORMATS: Partial<Record<ColType, { type: string; pattern: string }>> = {
  date: { type: 'DATE', pattern: 'yyyy-mm-dd' },
  datetime: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' },
};

/** stringValue/numberValue/boolValue = nilai LITERAL (tidak diparse jadi formula; nol di depan aman). null = sel kosong. */
export function cellData(v: CellValue, type: ColType, withFormat: boolean): CellData {
  const out: CellData = {};
  if (v !== null && v !== undefined) {
    out.userEnteredValue = typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: v };
  }
  const f = FORMATS[type];
  if (withFormat && f && v !== null) out.userEnteredFormat = { numberFormat: f };
  return out;
}

export function buildBatchUpdate(mutations: readonly Mutation[], gidOf: (tab: string) => number): { requests: unknown[] } {
  const requests: unknown[] = [];
  for (const m of mutations) {
    const sheetId = gidOf(m.schema.tab);
    if (m.kind === 'append') {
      for (const k of Object.keys(m.cells)) colIndex(m.schema, k); // kunci salah -> lempar
      const values = m.schema.cols.map((c) => cellData(m.cells[c.key] ?? null, c.type, true));
      requests.push({ appendCells: { sheetId, rows: [{ values }], fields: 'userEnteredValue,userEnteredFormat.numberFormat' } });
    } else {
      const idx = Object.entries(m.cells).map(([k, v]) => ({ i: colIndex(m.schema, k), v, t: m.schema.cols[colIndex(m.schema, k)]!.type })).sort((a, b) => a.i - b.i);
      let run: typeof idx = [];
      const flush = (): void => {
        if (!run.length) return;
        requests.push({ updateCells: {
          start: { sheetId, rowIndex: m.row - 1, columnIndex: run[0]!.i },
          rows: [{ values: run.map((x) => cellData(x.v, x.t, false)) }],
          fields: 'userEnteredValue',
        } });
        run = [];
      };
      for (const x of idx) { if (run.length && x.i !== run[run.length - 1]!.i + 1) flush(); run.push(x); }
      flush();
    }
  }
  return { requests };
}

/** Bentuk nilai sel untuk timestamp dari Clock (serial WIB). */
export function nowSerial(clock: Clock): number { return toSheetSerial(clock.now()); }

export interface SheetsStoreOpts { spreadsheetId: string; fetch: RawFetch; clock: Clock; rng: Rng; quota?: Quota }

export class SheetsStore implements TableStore {
  private gids: Map<string, number> | null = null;
  constructor(private o: SheetsStoreOpts) {}

  private isTransient(e: unknown): boolean {
    if (e instanceof GoogleHttpError) return e.status === 429 || e.status >= 500;
    return !(e instanceof AppError); // timeout / jaringan
  }
  private async readJson<T>(url: string): Promise<T> {
    return withRetry(async () => {
      await this.o.quota?.take('read');
      const r = await this.o.fetch(url);
      if (!r.ok) throw new GoogleHttpError(r.status, await r.text().catch(() => ''));
      return (await r.json()) as T;
    }, { clock: this.o.clock, rng: this.o.rng, isRetryable: (e) => this.isTransient(e) }).catch((e: unknown) => {
      if (e instanceof AppError) throw e;
      throw new AppError('UPSTREAM_BUSY', 'Google Sheets tidak merespons. Coba lagi sebentar.', undefined, 3);
    });
  }

  private async gidOf(tab: string): Promise<number> {
    if (!this.gids) {
      const j = await this.readJson<{ sheets: { properties: { sheetId: number; title: string } }[] }>(`${BASE}/${this.o.spreadsheetId}?fields=sheets.properties(sheetId,title)`);
      this.gids = new Map(j.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    }
    const g = this.gids.get(tab);
    if (g === undefined) throw new AppError('INTERNAL', `Tab ${tab} tidak ditemukan di spreadsheet.`);
    return g;
  }

  private qs = 'valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS';
  private norm(schema: TabSchema, r: unknown[] | undefined, opts?: ReadOpts): RawRow {
    const row: RawRow = Array.from({ length: schema.cols.length }, (_, i) => {
      const v = r?.[i];
      if (v === undefined || v === '') return null;
      if (typeof v === 'string' && ERR.test(v)) {
        if (opts?.rejectErrors) throw new AppError('UPSTREAM_BUSY', 'Data sumber belum siap (IMPORTRANGE). Coba lagi sebentar.', undefined, 3);
      }
      return v as CellValue;
    });
    return row;
  }

  async readRows(schema: TabSchema, opts?: ReadOpts): Promise<RawRow[]> {
    const last = colLetter(schema.cols.length - 1);
    const url = `${BASE}/${this.o.spreadsheetId}/values/${encodeURIComponent(`'${schema.tab}'!A${FIRST_DATA_ROW}:${last}`)}?${this.qs}`;
    const j = await this.readJson<{ values?: unknown[][] }>(url);
    return (j.values ?? []).map((r) => this.norm(schema, r, opts));
  }
  async readColumn(schema: TabSchema, key: string, opts?: ReadOpts): Promise<CellValue[]> {
    const L = colLetter(colIndex(schema, key));
    const url = `${BASE}/${this.o.spreadsheetId}/values/${encodeURIComponent(`'${schema.tab}'!${L}${FIRST_DATA_ROW}:${L}`)}?${this.qs}`;
    const j = await this.readJson<{ values?: unknown[][] }>(url);
    return (j.values ?? []).map((r) => this.norm({ ...schema, cols: [schema.cols[colIndex(schema, key)]!] }, r, opts)[0] ?? null);
  }
  async readRow(schema: TabSchema, row: number): Promise<RawRow | null> {
    const last = colLetter(schema.cols.length - 1);
    const url = `${BASE}/${this.o.spreadsheetId}/values/${encodeURIComponent(`'${schema.tab}'!A${row}:${last}${row}`)}?${this.qs}`;
    const j = await this.readJson<{ values?: unknown[][] }>(url);
    const r = j.values?.[0];
    if (!r) return null;
    const out = this.norm(schema, r);
    return out.every((v) => v === null) ? null : out;
  }

  async applyBatch(mutations: readonly Mutation[]): Promise<void> {
    if (mutations.length === 0) return;
    const tabs = new Set(mutations.map((m) => m.schema.tab));
    for (const t of tabs) await this.gidOf(t); // isi cache gid (baca; boleh retry)
    const gids = this.gids!;
    const body = JSON.stringify(buildBatchUpdate(mutations, (t) => gids.get(t)!));
    const url = `${BASE}/${this.o.spreadsheetId}:batchUpdate`;
    const send = async (): Promise<void> => {
      await this.o.quota?.take('write');
      let r: Response;
      try {
        r = await this.o.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      } catch {
        throw new AmbiguousWriteError('Timeout/jaringan saat menulis ke Google.');
      }
      if (r.ok) return;
      const text = await r.text().catch(() => '');
      if (r.status === 429) throw new GoogleHttpError(429, text);       // ditolak tegas -> aman diulang
      if (r.status >= 500) throw new AmbiguousWriteError(`Google ${r.status} saat menulis.`);
      throw new GoogleHttpError(r.status, text);                          // 4xx lain: tegas, tidak ada yang berlaku
    };
    try {
      await withRetry(send, { clock: this.o.clock, rng: this.o.rng, isRetryable: (e) => e instanceof GoogleHttpError && e.status === 429 });
    } catch (e) {
      if (e instanceof AmbiguousWriteError) throw e;
      if (e instanceof GoogleHttpError) {
        if (e.status === 429) throw new AppError('UPSTREAM_BUSY', 'Sistem sedang padat. Coba lagi sebentar.', undefined, 5);
        throw new AppError('INTERNAL', `Penulisan ditolak Google (${e.status}).`);
      }
      throw e;
    }
  }
}
