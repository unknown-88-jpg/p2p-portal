// Padanan STATUS & STATUS_FLOW di Config.gs. Enum tersimpan TIDAK diubah (label tampil beda, lihat design 7.3).
export const STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  MANAGER_APPROVED: 'Manager Approved',
  TAX_VERIFIED: 'Tax Verified',
  WET_SIGNED: 'Wet Signed',
  COA_POSTED: 'COA Posted',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  REVISION: 'Revision Needed',
  REJECTED: 'Rejected',
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STATUS_FLOW: Readonly<Record<Status, readonly Status[]>> = {
  [STATUS.DRAFT]: [STATUS.SUBMITTED],
  [STATUS.REVISION]: [STATUS.SUBMITTED],
  [STATUS.SUBMITTED]: [STATUS.MANAGER_APPROVED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.MANAGER_APPROVED]: [STATUS.TAX_VERIFIED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.TAX_VERIFIED]: [STATUS.WET_SIGNED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.WET_SIGNED]: [STATUS.COA_POSTED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.COA_POSTED]: [STATUS.PARTIALLY_PAID, STATUS.PAID, STATUS.REVISION],
  [STATUS.PARTIALLY_PAID]: [STATUS.PARTIALLY_PAID, STATUS.PAID],
  [STATUS.PAID]: [],
  [STATUS.REJECTED]: [],
};

export function isStatus(v: string): v is Status {
  return (Object.values(STATUS) as string[]).includes(v);
}

/** I3: satu-satunya pintu transisi. Mengembalikan alasan penolakan, atau null bila sah. */
export function checkTransition(from: string, to: Status): string | null {
  if (!isStatus(from)) return `Status saat ini "${from}" tidak dikenal.`;
  if (!STATUS_FLOW[from].includes(to)) return `Transisi "${from}" → "${to}" tidak diizinkan.`;
  return null;
}
