import type { Clock } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { colIndex, type TabSchema } from '@/repo/schema';
import { AmbiguousWriteError, FIRST_DATA_ROW, type CellValue, type Mutation, type RawRow, type ReadOpts, type TableStore } from '@/ports/store';

const ERR = /^#(N\/A|REF!|VALUE!|ERROR!|DIV\/0!|NAME\?|NUM!|NULL!)$|^Loading\.\.\.$/i;

export type Fault =
  | { kind: 'beforeApply'; error?: Error }          // gagal tegas: TIDAK ada yang berlaku
  | { kind: 'afterApply' }                          // batch berlaku, tapi klien menerima timeout (ambigu)
  | { kind: 'ambiguousLost' };                      // klien menerima timeout, batch ternyata TIDAK berlaku

/** Sheets palsu di memori. applyBatch atomik (salin-lalu-tukar) + injeksi gangguan + latensi + penghitung. */
export class MemoryStore implements TableStore {
  private tabs = new Map<string, RawRow[]>();
  private faults: Fault[] = [];
  reads = 0;
  writes = 0;
  batches: Mutation[][] = [];
  constructor(private clock: Clock, public latencyMs = 0) {}

  seed(schema: TabSchema, rows: readonly RawRow[]): void {
    this.tabs.set(schema.tab, rows.map((r) => this.pad(schema, r)));
  }
  /** Gangguan berikutnya yang akan dikenakan pada applyBatch (FIFO). */
  inject(f: Fault): void { this.faults.push(f); }
  rowsOf(schema: TabSchema): RawRow[] { return (this.tabs.get(schema.tab) ?? []).map((r) => [...r]); }
  /** Mutasi di luar aplikasi (mis. user menyortir sheet). */
  reorder(schema: TabSchema, fn: (rows: RawRow[]) => RawRow[]): void { this.tabs.set(schema.tab, fn(this.rowsOf(schema))); }

  private pad(schema: TabSchema, r: RawRow): RawRow {
    const out: RawRow = Array.from({ length: schema.cols.length }, (_, i) => r[i] ?? null);
    return out;
  }
  private async tick(): Promise<void> { await this.clock.sleep(this.latencyMs); }
  private tab(schema: TabSchema): RawRow[] {
    let t = this.tabs.get(schema.tab);
    if (!t) { t = []; this.tabs.set(schema.tab, t); }
    return t;
  }
  private check(rows: RawRow[], opts?: ReadOpts): void {
    if (!opts?.rejectErrors) return;
    for (const r of rows) for (const v of r) if (typeof v === 'string' && ERR.test(v)) throw new AppError('UPSTREAM_BUSY', 'Data sumber belum siap (IMPORTRANGE).', undefined, 3);
  }

  async readRows(schema: TabSchema, opts?: ReadOpts): Promise<RawRow[]> {
    await this.tick(); this.reads++;
    const rows = this.rowsOf(schema);
    this.check(rows, opts);
    return rows;
  }
  async readColumn(schema: TabSchema, key: string, opts?: ReadOpts): Promise<CellValue[]> {
    const i = colIndex(schema, key);
    const rows = await this.readRows(schema, opts);
    return rows.map((r) => r[i] ?? null);
  }
  async readRow(schema: TabSchema, row: number): Promise<RawRow | null> {
    await this.tick(); this.reads++;
    const r = this.tab(schema)[row - FIRST_DATA_ROW];
    if (!r || r.every((v) => v === null || v === '')) return null;
    return [...r];
  }

  async applyBatch(mutations: readonly Mutation[]): Promise<void> {
    await this.tick();
    const fault = this.faults.shift();
    if (fault?.kind === 'ambiguousLost') throw new AmbiguousWriteError('timeout (injected, batch tidak berlaku)');
    if (fault?.kind === 'beforeApply') throw fault.error ?? new Error('Google 400 (injected)');
    // salin-lalu-tukar => atomik
    const draft = new Map<string, RawRow[]>();
    const get = (schema: TabSchema): RawRow[] => {
      let d = draft.get(schema.tab);
      if (!d) { d = this.rowsOf(schema); draft.set(schema.tab, d); }
      return d;
    };
    for (const m of mutations) {
      const rows = get(m.schema);
      if (m.kind === 'append') {
        const r: RawRow = Array.from({ length: m.schema.cols.length }, () => null);
        for (const [k, v] of Object.entries(m.cells)) r[colIndex(m.schema, k)] = v;
        rows.push(r);
      } else {
        const r = rows[m.row - FIRST_DATA_ROW];
        if (!r) throw new Error(`update di luar rentang: ${m.schema.tab}!${m.row}`);
        for (const [k, v] of Object.entries(m.cells)) r[colIndex(m.schema, k)] = v;
      }
    }
    for (const [tab, rows] of draft) this.tabs.set(tab, rows);
    this.writes++;
    this.batches.push([...mutations]);
    if (fault?.kind === 'afterApply') throw new AmbiguousWriteError('timeout (injected, batch sudah berlaku)');
  }
}
