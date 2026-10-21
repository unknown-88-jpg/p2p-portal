import { LEVEL } from './config';
import { hasAuthority, normEmail, type Role } from './roles';

/** Matriks capability (design 5.4) — mereplikasi perilaku lama: level PERSIS, bukan "level >= n". Kelonggaran lama TIDAK diubah diam-diam (O4/O5). */
export const CAPABILITY_LEVELS = {
  'pengajuan.write': [LEVEL.PIC],
  'approve.manager': [LEVEL.MANAGER],        // + wajib wewenang brand/dept (lihat canApprove)
  'tax.verify': [LEVEL.FINANCE_STAFF],
  'sign.upload': [LEVEL.FINANCE_STAFF],      // kompat tanda tangan basah
  'sign.eapprove.finmgr': [LEVEL.FINANCE_MGR], // Fase 2
  'sign.eapprove.cfo': [LEVEL.CFO],            // Fase 2
  'journal.post': [LEVEL.FINANCE_STAFF],
  'payment.execute': [LEVEL.FINANCE_STAFF],
  'vendor.register': [LEVEL.PIC, LEVEL.MANAGER, LEVEL.FINANCE_STAFF, LEVEL.ADMIN],
  'vendor.approve': [LEVEL.FINANCE_STAFF],
  'export.odoo': [LEVEL.FINANCE_STAFF, LEVEL.FINANCE_MGR, LEVEL.ADMIN],
  'admin.manage': [LEVEL.ADMIN],
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
