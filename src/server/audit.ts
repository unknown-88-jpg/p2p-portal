import type { Clock } from '@/lib/clock';
import { toSheetSerial } from '@/lib/time';
import { AUDIT_LOG } from '@/repo/schema';
import type { Mutation } from '@/ports/store';

export interface AuditEntry {
  actor: string;       // email pelaku
  idTrx?: string;
  action: string;
  field?: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  notes?: string;
}

/**
 * Baris Audit_Log sebagai mutasi append — HARUS ikut batch yang sama dengan perubahan datanya (I17).
 * Format identik sistem lama: Log_ID "LOG-"+8 hex, "-" untuk kosong. Beda dari writeAudit lama: TIDAK ADA try/catch yang menelan error.
 */
export function auditMutation(e: AuditEntry, clock: Clock): Mutation {
  return {
    kind: 'append',
    schema: AUDIT_LOG,
    cells: {
      Log_ID: `LOG-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
      Timestamp: toSheetSerial(clock.now()),
      User_Email: e.actor,
      ID_Trx: e.idTrx || '-',
      Action: e.action || '-',
      Field: e.field || '-',
      Old_Value: e.oldValue === undefined || e.oldValue === null ? '' : String(e.oldValue),
      New_Value: e.newValue === undefined || e.newValue === null ? '' : String(e.newValue),
      Notes: e.notes ?? '',
    },
  };
}

export const isAuditMutation = (m: Mutation): boolean => m.schema.tab === AUDIT_LOG.tab;

/** Tulis satu baris audit mandiri (tanpa mutasi data) — untuk kejadian auth. Satu append atomik; tanpa lock. */
export async function appendAudit(store: import('@/ports/store').TableStore, clock: Clock, e: AuditEntry): Promise<void> {
  await store.applyBatch([auditMutation(e, clock)]);
}
