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

/** I6 (perilaku lama, dikonfirmasi pemilik 2026-10-24): pengaju tidak boleh memverifikasi pajak dokumennya sendiri. BLOKIR KERAS. */
export const PESAN_I6 = 'Anda mengajukan dokumen ini, jadi tidak boleh memverifikasi pajaknya sendiri. Sesuai pemisahan tugas (pengaju ≠ verifikator), minta rekan Finance lain memprosesnya.';
/** Status yang boleh dikembalikan Finance ke PIC (financeReject lama: semua tahap Finance yang alurnya mengizinkan Revision Needed). */
export const STATUS_BOLEH_KEMBALI_FINANCE: readonly Status[] = [STATUS.MANAGER_APPROVED, STATUS.TAX_VERIFIED, STATUS.WET_SIGNED, STATUS.COA_POSTED];

// ------------------------------------------------------------------ F2-C: e-approve Fin. Mgr (L4) & CFO (L5) — O4: menggantikan TTD basah
export type Sebagai = 'finmgr' | 'cfo';
export interface BarisApproval { level: unknown; action: unknown; nama: unknown; email: unknown; timestamp: unknown }
export interface Penyetuju { nama: string; email: string }
export interface StatusPersetujuan { finMgr: Penyetuju | null; cfo: Penyetuju | null; verifikator: Penyetuju | null }

const lvl = (v: unknown): number => (typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? ''), 10));
const ts = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : -Infinity; };
const ok = (r: BarisApproval): boolean => String(r.action ?? '').trim().toUpperCase() === 'APPROVED';

/**
 * Persetujuan L4/L5 yang berlaku untuk SIKLUS verifikasi sekarang: hanya yang dicatat SETELAH verifikasi pajak (L3 APPROVED) terakhir.
 * Dokumen yang pernah dikembalikan lalu diverifikasi ulang tidak boleh terbawa persetujuan lama.
 */
export function statusPersetujuan(rows: readonly BarisApproval[]): StatusPersetujuan {
  const l3 = rows.filter((r) => ok(r) && lvl(r.level) === 3).sort((a, b) => ts(a.timestamp) - ts(b.timestamp)).at(-1);
  const mulai = l3 ? ts(l3.timestamp) : -Infinity;
  const ambil = (level: number): Penyetuju | null => {
    const r = rows.filter((x) => ok(x) && lvl(x.level) === level && ts(x.timestamp) >= mulai).sort((a, b) => ts(a.timestamp) - ts(b.timestamp)).at(-1);
    return r ? { nama: String(r.nama ?? '').trim(), email: String(r.email ?? '').trim() } : null;
  };
  return { finMgr: ambil(4), cfo: ambil(5), verifikator: l3 ? { nama: String(l3.nama ?? '').trim(), email: String(l3.email ?? '').trim() } : null };
}

const samaEmail = (a: string, b: string): boolean => a.trim().toLowerCase() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Aturan e-approve (urutan L4 -> L5). Mengembalikan alasan penolakan atau null. CFO hanya bila REQUIRE_CFO (I1), setelah Fin. Mgr,
 * dan oleh orang yang BERBEDA dari Fin. Mgr (dua tanda tangan = dua orang).
 */
export function cekEApprove(sebagai: Sebagai, roles: readonly Role[], email: string, perluCFO: boolean, st: StatusPersetujuan): { kode: 'FORBIDDEN' | 'CONFLICT' | 'RULE_VIOLATION'; pesan: string } | null {
  if (sebagai === 'finmgr') {
    if (!can(roles, 'sign.eapprove.finmgr')) return { kode: 'FORBIDDEN', pesan: 'Hanya Fin. Mgr yang bisa memberi persetujuan ini.' };
    if (st.finMgr) return { kode: 'CONFLICT', pesan: `Dokumen ini sudah disetujui Fin. Mgr (${st.finMgr.nama}). Muat ulang daftar.` };
    return null;
  }
  if (!can(roles, 'sign.eapprove.cfo')) return { kode: 'FORBIDDEN', pesan: 'Hanya CFO yang bisa memberi persetujuan ini.' };
  if (!perluCFO) return { kode: 'RULE_VIOLATION', pesan: 'Dokumen ini tidak membutuhkan persetujuan CFO (nominal di bawah Rp 5.000.000).' };
  if (!st.finMgr) return { kode: 'RULE_VIOLATION', pesan: 'Menunggu persetujuan Fin. Mgr lebih dulu.' };
  if (st.cfo) return { kode: 'CONFLICT', pesan: `Dokumen ini sudah disetujui CFO (${st.cfo.nama}). Muat ulang daftar.` };
  if (samaEmail(st.finMgr.email, email)) return { kode: 'RULE_VIOLATION', pesan: 'Persetujuan CFO harus oleh orang yang berbeda dari Fin. Mgr.' };
  return null;
}

/** Setelah persetujuan ini, apakah tahap persetujuan selesai (lanjut ke Jurnal COA / status Wet Signed)? */
export const persetujuanLengkap = (sebagai: Sebagai, perluCFO: boolean): boolean => sebagai === 'cfo' || !perluCFO;

/** Penanda pemisahan tugas (bukan blokir, selaras O5b): penyetuju L4/L5 = pengaju atau verifikator pajak. */
export function penandaTugasRangkap(email: string, pengajuEmail: string, st: StatusPersetujuan): string {
  const p: string[] = [];
  if (samaEmail(pengajuEmail, email)) p.push('penyetuju = pengaju');
  if (st.verifikator && samaEmail(st.verifikator.email, email)) p.push('penyetuju = verifikator pajak');
  return p.length ? `[Penanda SoD: ${p.join(', ')}]` : '';
}
