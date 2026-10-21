import type { TabSchema } from './schema';

export interface HeaderIssue { tab: string; position: number; expected: string; found: string }
export interface HeaderReport { tab: string; ok: boolean; issues: HeaderIssue[]; missingTab?: boolean }

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * Bandingkan baris header sheet dengan registry. Murni (tanpa I/O).
 * Kolom ekstra di kanan diperbolehkan (konvensi: kolom baru ditambah di paling kanan).
 */
export function validateHeader(schema: TabSchema, headerRow: readonly unknown[] | null): HeaderReport {
  if (!headerRow) return { tab: schema.tab, ok: false, issues: [], missingTab: true };
  const issues: HeaderIssue[] = [];
  schema.cols.forEach((col, i) => {
    const found = norm(headerRow[i]);
    if (!schema.strictHeader) return; // tab yang headernya belum didaftarkan penuh: dilewati
    const ok = found === norm(col.key) || (col.aliases ?? []).some((a) => norm(a) === found);
    if (!ok) issues.push({ tab: schema.tab, position: i + 1, expected: col.key, found: String(headerRow[i] ?? '') });
  });
  return { tab: schema.tab, ok: issues.length === 0, issues };
}

/** Mode aman: kalau ada tab yang tidak valid -> aplikasi read-only (tidak menulis ke kolom yang salah). */
export function overallWritable(reports: readonly HeaderReport[]): boolean {
  return reports.every((r) => r.ok);
}
