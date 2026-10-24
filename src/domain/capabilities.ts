import { LEVEL } from './config';
import { hasAuthority, normEmail, type Role } from './roles';

/** Matriks capability (design 5.4) — mereplikasi perilaku lama: level PERSIS, bukan "level >= n". O4/O5 final 2026-10-24 (ROADMAP-FASE-2-4 §2.0). */
export const CAPABILITY_LEVELS = {
  'pengajuan.write': [LEVEL.PIC],
  'approve.manager': [LEVEL.MANAGER],        // + wajib wewenang brand/dept (lihat canApprove)
  'finance.view': [LEVEL.FINANCE_STAFF, LEVEL.FINANCE_MGR, LEVEL.CFO], // F2-A: lihat antrean Finance (lama: requireLevel(FINANCE_STAFF))
  'tax.verify': [LEVEL.FINANCE_STAFF],
  // O4: TTD basah (unggah scan) DIHAPUS tanpa masa transisi -> capability 'sign.upload' tidak ada lagi.
  'sign.eapprove.finmgr': [LEVEL.FINANCE_MGR], // Fase 2 (F2-C)
  'sign.eapprove.cfo': [LEVEL.CFO],            // Fase 2 (F2-C)
  'journal.post': [LEVEL.FINANCE_STAFF],
  'payment.execute': [LEVEL.FINANCE_STAFF],
  'vendor.register': [LEVEL.PIC, LEVEL.MANAGER, LEVEL.FINANCE_STAFF, LEVEL.ADMIN],
  'vendor.approve': [LEVEL.FINANCE_STAFF],
  'export.odoo': [LEVEL.FINANCE_STAFF, LEVEL.FINANCE_MGR, LEVEL.ADMIN],
  'admin.manage': [LEVEL.ADMIN],
  // F3-D: laporan AP (baca-saja) & viewer Audit_Log. Keputusan default Fase 3 — tercatat di README, bisa diubah user.
  'report.view': [LEVEL.FINANCE_STAFF, LEVEL.FINANCE_MGR, LEVEL.CFO, LEVEL.ADMIN],
  'audit.view': [LEVEL.FINANCE_MGR, LEVEL.CFO, LEVEL.ADMIN],
} as const satisfies Record<string, readonly number[]>;
export type Capability = keyof typeof CAPABILITY_LEVELS;

export function can(roles: readonly Role[], cap: Capability): boolean {
  const allowed: readonly number[] = CAPABILITY_LEVELS[cap];
  return roles.some((r) => allowed.includes(r.level));
}
export function capabilitiesOf(roles: readonly Role[]): Capability[] {
  return (Object.keys(CAPABILITY_LEVELS) as Capability[]).filter((c) => can(roles, c));
}

/** Approve Level 2 hanya untuk brand/dept yang berwenang. */
export function canApprove(roles: readonly Role[], doc: { brand: string; dept: string }): boolean {
  return hasAuthority(roles, doc.brand, doc.dept, LEVEL.MANAGER);
}

/** bisaLihatDokumen_ (perbaikan IDOR 2026-09-18): pemilik, manager berwenang, atau Finance/CFO/Admin (level >= 3). */
export function canViewDocument(roles: readonly Role[], myEmail: string, doc: { createdBy: string; brand: string; dept: string }): boolean {
  const owner = normEmail(doc.createdBy);
  if (owner && owner === normEmail(myEmail)) return true;
  if (hasAuthority(roles, doc.brand, doc.dept, LEVEL.MANAGER)) return true;
  return roles.some((r) => r.level >= LEVEL.FINANCE_STAFF && r.level !== 99);
}
