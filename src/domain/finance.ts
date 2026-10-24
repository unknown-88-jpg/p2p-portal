// Fase 2 / F2-A: tahap antrean Finance & hak akses per level. Murni, tanpa I/O. Sumber perilaku: getFinanceQueues (API_Finance.gs).
import { can, type Capability } from './capabilities';
import type { Role } from './roles';
import { STATUS, type Status } from './status';

export type KunciTahap = 'pajak' | 'persetujuan' | 'jurnal' | 'bayar';
export interface TahapFinance {
  kunci: KunciTahap;
  label: string;
  /** Status tersimpan yang masuk tahap ini (enum lama tidak diubah). */
  status: readonly Status[];
  /** Siapa yang bertindak di tahap ini (aksinya dibangun di F2-B..F2-E). */
  aktor: string;
  /** Capability yang boleh BERTINDAK di tahap ini; melihat antrean cukup `finance.view`. */
  cap: readonly Capability[];
}

/** Urutan = urutan alur. Pemetaan status sama dengan getFinanceQueues lama: tax / wet / coa / treasury. */
export const TAHAP_FINANCE: readonly TahapFinance[] = [
  { kunci: 'pajak', label: 'Verifikasi pajak', status: [STATUS.MANAGER_APPROVED], aktor: 'Finance Staff', cap: ['tax.verify'] },
  { kunci: 'persetujuan', label: 'Persetujuan Fin. Mgr / CFO', status: [STATUS.TAX_VERIFIED], aktor: 'Fin. Mgr / CFO', cap: ['sign.eapprove.finmgr', 'sign.eapprove.cfo'] },
  { kunci: 'jurnal', label: 'Jurnal COA', status: [STATUS.WET_SIGNED], aktor: 'Finance Staff', cap: ['journal.post'] },
  { kunci: 'bayar', label: 'Siap dibayar', status: [STATUS.COA_POSTED, STATUS.PARTIALLY_PAID], aktor: 'Finance Staff', cap: ['payment.execute'] },
];

export const isKunciTahap = (v: unknown): v is KunciTahap => TAHAP_FINANCE.some((t) => t.kunci === v);
export const tahapDariStatus = (status: string): TahapFinance | null => TAHAP_FINANCE.find((t) => (t.status as readonly string[]).includes(status)) ?? null;

/** Melihat antrean Finance: Finance Staff, Fin. Mgr, CFO (L3/L4/L5). Lama: requireLevel(FINANCE_STAFF). */
export const bisaLihatFinance = (roles: readonly Role[]): boolean => can(roles, 'finance.view');
/** Boleh bertindak di tahap ini? (Untuk tampilan; penjaga sebenarnya ada di tiap aksi F2-B..F2-E.) */
export const bisaAksiTahap = (roles: readonly Role[], t: TahapFinance): boolean => t.cap.some((c) => can(roles, c));

export interface RingkasTahap { kunci: KunciTahap; label: string; aktor: string; jumlah: number; total: number; tertuaHari: number | null; bisaAksi: boolean }
export interface ItemRingkas { tahap: KunciTahap; nominal: number; sisa: number; umurHari: number | null }

/** Hitungan per tahap: jumlah, total Rp (tahap bayar = total SISA tagihan), dokumen tertua (hari di tahap). */
export function ringkasTahap(items: readonly ItemRingkas[], roles: readonly Role[]): RingkasTahap[] {
  return TAHAP_FINANCE.map((t) => {
    const di = items.filter((i) => i.tahap === t.kunci);
    const umur = di.map((i) => i.umurHari).filter((x): x is number => x !== null);
    return {
      kunci: t.kunci, label: t.label, aktor: t.aktor, jumlah: di.length,
      total: di.reduce((a, i) => a + (t.kunci === 'bayar' ? i.sisa : i.nominal), 0),
      tertuaHari: umur.length ? Math.max(...umur) : null, bisaAksi: bisaAksiTahap(roles, t),
    };
  });
}
