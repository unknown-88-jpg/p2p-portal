// Padanan Config.gs (CONFIG). Satu-satunya tempat angka bisnis. Jangan duplikasi.
export const CONFIG = {
  CFO_THRESHOLD: 5_000_000,
  /** Keputusan user 2026-11-09: dokumen dept ini (semua brand, termasuk Shared Service) dengan nominal >= ambang CFO wajib persetujuan COO (L6), setelah Fin. Mgr dan sebelum CFO. */
  COO_DEPT: 'GENERAL AFFAIRS',
  /** Keputusan user 2026-11-10: pengajuan dari dept ini (semua brand) TIDAK lewat Manager L2: langsung Manager Approved lalu Staff Finance -> Fin. Mgr -> (COO bila GA) -> CFO bila >= ambang. */
  SKIP_L2_DEPTS: ['FATS'] as readonly string[],
  PPN_RATE: 0.11,
  PAYMENT_TOLERANCE: 1000,
  /** D9: approval via WA di/atas nominal ini DIMATIKAN (wajib web + konfirmasi password). */
  WA_APPROVAL_MAX_EXCLUSIVE: 5_000_000,
  /** D9/I14: approve manager di web pada/di atas nominal ini wajib konfirmasi ulang password (step-up). */
  APPROVE_STEPUP_MIN: 5_000_000,
  KAS_L3: 'KAS DAN SETARA KAS',
  TAB: {
    PENGAJUAN: 'Trx_Pengajuan',
    APPROVAL: 'Trx_Approval',
    PAYMENT_LOG: 'Trx_Payment_Log',
    AUDIT: 'Audit_Log',
    VENDOR: 'Master_Vendor',
    SETTING: 'Master_Setting',
    USER_TTD: 'Master_User_TTD',
    COA: 'Master_COA',
    PPH: 'Master_PPh',
    PO: 'DB_PO',
    SJ: 'DB_SJ',
  },
} as const;

export const LEVEL = { PIC: 1, MANAGER: 2, FINANCE_STAFF: 3, FINANCE_MGR: 4, CFO: 5, COO: 6, ADMIN: 9 } as const;
export type Level = (typeof LEVEL)[keyof typeof LEVEL];

/** I1: nominal >= ambang CFO -> wajib CFO. */
export function butuhCFO(finalAmount: number): boolean {
  return finalAmount >= CONFIG.CFO_THRESHOLD;
}

/** Wajib COO: dept GA (semua brand) dan nominal >= ambang yang sama dengan CFO (keputusan user 2026-11-09). */
export function butuhCOO(dept: string, finalAmount: number): boolean {
  return dept.trim().toUpperCase() === CONFIG.COO_DEPT && butuhCFO(finalAmount);
}

/** D9/I14: boleh disetujui lewat balasan WA hanya bila nominal di bawah ambang. Dievaluasi di server dari nominal tersimpan. */
export function bolehApproveViaWA(storedNominal: number): boolean {
  return storedNominal < CONFIG.WA_APPROVAL_MAX_EXCLUSIVE;
}
