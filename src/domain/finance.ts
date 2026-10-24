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

// ------------------------------------------------------------------ F2-D: jurnal COA (port postJournalBulk)
export const JURNAL_MAKS = 30;
export interface IsianJurnal { lvl1: string; lvl2: string; lvl3: string; lvl4: string; lvl5: string; budget: string }
export type BarisCoa = readonly [string, string, string, string, string];
const isi = (v: string): string => (v ?? '').trim() || '-';

/**
 * Validasi isian jurnal terhadap Master_COA (aturan lama): Level 1 & 2 wajib, budget wajib, kombinasi harus ada di master
 * (level yang "-" = tidak dipilih). Akun yang dijurnal (SUB_COA) = level terdalam yang dipilih. Mengembalikan alasan gagal atau hasil.
 */
export function validasiJurnal(coa: readonly BarisCoa[], j: IsianJurnal): { ok: false; alasan: string } | { ok: true; kategori: string; head: string; akun: string; budget: string } {
  const l = [j.lvl1.trim(), j.lvl2.trim(), isi(j.lvl3), isi(j.lvl4), isi(j.lvl5)] as const;
  if (!l[0] || !l[1] || l[1] === '-') return { ok: false, alasan: 'COA level 1 & 2 wajib diisi.' };
  const budget = j.budget.trim().toUpperCase();
  if (!budget) return { ok: false, alasan: 'Plafon budget wajib diisi.' };
  const cocok = coa.some((c) => c[0] === l[0] && c[1] === l[1] && (l[2] === '-' || c[2] === l[2]) && (l[3] === '-' || c[3] === l[3]) && (l[4] === '-' || c[4] === l[4]));
  if (!cocok) return { ok: false, alasan: 'Kombinasi akun COA tidak ada di Master_COA.' };
  const akun = [...l].reverse().find((x) => x && x !== '-')!;
  return { ok: true, kategori: l[0], head: l[1], akun, budget };
}

/** Pilihan untuk dropdown bertingkat: nilai unik di level `n` (0..4) di bawah pilihan level sebelumnya. Level tanpa turunan = []. */
export function opsiCoa(coa: readonly BarisCoa[], pilihan: readonly string[], n: number): string[] {
  const set = new Set<string>();
  for (const c of coa) {
    if (pilihan.slice(0, n).every((p, i) => c[i] === p) && c[n] && c[n] !== '-') set.add(c[n]);
  }
  return [...set];
}

// ------------------------------------------------------------------ F2-E: pembayaran (port executePaymentCore_ + bolehDibayar)
export const BAYAR_MAKS = 30;
/** Fingerprint pembayaran kembar (R-04): ID, tanggal, nominal, ref sama dalam jendela ini -> butuh konfirmasi eksplisit. */
export const JENDELA_DUPLIKAT_MS = 10 * 60_000;

export interface GerbangBayar {
  status: string; perluCFO: boolean; subCoa: string; budget: string;
  /** Ada approval Manager (L2) APPROVED. */ manager: boolean;
  /** Persetujuan siklus verifikasi sekarang (L3/L4/L5). */ st: StatusPersetujuan;
}
/**
 * I4 (bolehDibayar): status COA Posted / Partially Paid; approval Manager, verifikasi pajak, Fin. Mgr (+ CFO bila wajib) tercatat;
 * Sub COA & budget terisi. O4: syarat "scan TTD basah diunggah" DIHAPUS (diganti e-approve L4/L5 atas nama penandatangan).
 */
export function cekBolehDibayar(g: GerbangBayar): string | null {
  if (g.status !== STATUS.COA_POSTED && g.status !== STATUS.PARTIALLY_PAID) return `Status "${g.status || '-'}" belum boleh dibayar. Harus sudah Siap Dibayar.`;
  if (!g.manager) return 'Belum ada persetujuan Manager divisi.';
  if (!g.st.verifikator) return 'Belum diverifikasi pajak oleh Finance Staff.';
  if (!g.st.finMgr) return 'Belum ada persetujuan Fin. Mgr.';
  if (g.perluCFO && !g.st.cfo) return 'Nominal ≥ Rp 5.000.000 wajib disetujui CFO.';
  if (!g.subCoa.trim() || g.subCoa.trim() === '-') return 'Jurnal COA belum diposting.';
  if (!g.budget.trim()) return 'Plafon budget belum diisi.';
  return null;
}

/** I5 anti-overpay: total dibayar dari Trx_Payment_Log (bukan kolom ringkasan); nominal <= sisa + toleransi; sisa dalam toleransi = lunas. */
export function hitungBayar(finalAmount: number, sudahDibayar: number, nominal: number, toleransi: number):
  { ok: false; alasan: string } | { ok: true; totalBaru: number; osBaru: number; lunas: boolean } {
  if (!Number.isInteger(nominal) || nominal <= 0) return { ok: false, alasan: 'Nominal pembayaran harus bilangan bulat lebih dari nol.' };
  const sisa = finalAmount - sudahDibayar;
  if (sisa <= toleransi) return { ok: false, alasan: 'Sisa tagihan sudah nol (lunas).' };
  if (nominal > sisa + toleransi) return { ok: false, alasan: `Melebihi sisa tagihan. Sisa ${fmt(sisa)}, input ${fmt(nominal)}.` };
  const totalBaru = sudahDibayar + nominal;
  let osBaru = finalAmount - totalBaru;
  if (Math.abs(osBaru) <= toleransi) osBaru = 0;
  return { ok: true, totalBaru, osBaru, lunas: osBaru <= 0 };
}
const fmt = (n: number): string => `Rp ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** O5b (final 2026-10-24): pembayar = verifikator pajak / penyetuju L4/L5 -> PERINGATAN + penanda audit, bukan blokir. */
export function tugasRangkapBayar(email: string, st: StatusPersetujuan): string[] {
  const t: string[] = [];
  if (st.verifikator && samaEmail(st.verifikator.email, email)) t.push('verifikator pajak');
  if (st.finMgr && samaEmail(st.finMgr.email, email)) t.push('Fin. Mgr');
  if (st.cfo && samaEmail(st.cfo.email, email)) t.push('CFO');
  return t;
}
