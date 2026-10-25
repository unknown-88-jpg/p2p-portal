// Detail dokumen, voucher, timeline, pencarian (M7). Murni: tanpa I/O. Sumber perilaku: API_Print.gs, buildSignatureBlocks (Approval.gs), Config.gs.
import { canViewDocument } from './capabilities';
import { LEVEL } from './config';
import { str } from './legacy-parse';
import type { Role } from './roles';
import { STATUS } from './status';
import { labelStatus } from './status-label';

export const LEVEL_LABEL: Readonly<Record<number, string>> = { 1: 'Dibuat Oleh,', 2: 'Diperiksa Oleh,', 3: 'Diverifikasi Oleh,', 4: 'Disetujui Oleh,', 5: 'Disetujui Oleh,' };
/** O4 (final 2026-10-24): semua level E-SIGN; Level 4/5 lewat e-approve di portal (F2-C). Catatan lama ber-Method "WET" tetap ditampilkan sebagai TTD basah. */
export const SIGN_METHOD: Readonly<Record<number, 'E-SIGN' | 'WET'>> = { 1: 'E-SIGN', 2: 'E-SIGN', 3: 'E-SIGN', 4: 'E-SIGN', 5: 'E-SIGN' };

export interface BarisUserTTD { brand: string; dept: string; level: unknown; jabatan: string; nama: string; aktif: unknown }
export interface Persetujuan { level: number; nama: string; jabatan: string; timestamp: unknown; method?: string }
export interface KotakTTD { level: number; role: string; nama: string; jabatan: string; method: 'E-SIGN' | 'WET'; isSigned: boolean; signedAt: string; label: string }

const up = (v: unknown): string => str(v).toUpperCase();

/**
 * Port buildSignatureBlocks: penandatangan (level 1-5 saja; Admin L9 tidak) dari Master_User_TTD (aktif kecuali NO/TIDAK persis seperti lama; brand/dept cocok atau ALL;
 * nama kosong/"-" dilewati; CFO hanya bila wajib; satu orang pertama per level; urut level), ditempeli persetujuan NYATA (Trx_Approval, status APPROVED;
 * yang terakhir per level menang). Yang tercatat TTD memakai nama/jabatan dari catatan approval, bukan dari master.
 */
export function bangunKotakTTD(users: readonly BarisUserTTD[], approved: ReadonlyMap<number, Persetujuan>, brand: string, dept: string, perluCFO: boolean, fmtTgl: (ts: unknown) => string): KotakTTD[] {
  const b = up(brand), d = up(dept);
  const signers: { level: number; jabatan: string; nama: string }[] = [];
  for (const u of users) {
    const aktif = up(u.aktif);
    if (aktif === 'NO' || aktif === 'TIDAK') continue;
    if (!(up(u.brand) === b || up(u.brand) === 'ALL')) continue;
    if (!(up(u.dept) === d || up(u.dept) === 'ALL')) continue;
    const level = (typeof u.level === 'number' ? Math.trunc(u.level) : parseInt(String(u.level ?? ''), 10)) || 99;
    const nama = up(u.nama);
    if (!nama || nama === '-') continue;
    if (!(level in LEVEL_LABEL)) continue; // hanya level alur P2P (1-5); Admin (L9) mengatur sistem, bukan penandatangan (keputusan user 2026-10-25, beda dari lama)
    if (level === LEVEL.CFO && !perluCFO) continue;
    if (!signers.some((s) => s.level === level)) signers.push({ level, jabatan: str(u.jabatan) || 'Staff', nama });
  }
  signers.sort((a, c) => a.level - c.level);
  return signers.map((s) => {
    const rec = approved.get(s.level);
    // Metode dari CATATAN nyata (data lama bisa "WET"); kotak yang belum ditandatangani mengikuti SIGN_METHOD (kini semua E-SIGN).
    const wet = rec ? up(rec.method) === 'WET' : SIGN_METHOD[s.level] === 'WET';
    return {
      level: s.level, role: LEVEL_LABEL[s.level] ?? 'Mengetahui,', nama: rec ? rec.nama : s.nama, jabatan: rec ? rec.jabatan : s.jabatan,
      method: wet ? 'WET' : 'E-SIGN', isSigned: !!rec, signedAt: rec ? fmtTgl(rec.timestamp) : '',
      label: rec ? (wet ? 'TTD Basah — Terverifikasi' : 'E-Signed') : (wet ? '( TTD Basah )' : '( Menunggu )'),
    };
  });
}

/**
 * Peta persetujuan per level dari baris Trx_Approval: hanya APPROVED, yang terakhir menang (getApprovalMap lama), TAPI hanya dari
 * SIKLUS sekarang (beda dari lama, diputuskan pemilik 2026-10-25, temuan C7): baris sebelum pengajuan (L1 APPROVED) terakhir diabaikan,
 * dan L4/L5 hanya yang dicatat setelah verifikasi pajak (L3 APPROVED) terakhir — sama dengan gerbang server `statusPersetujuan`.
 * Dokumen yang dikembalikan lalu diajukan ulang tidak menampilkan tanda tangan lama yang sudah batal.
 * Waktu L1/L3 tak terbaca (sel rusak) = gagal tertutup: level sesudahnya dianggap belum ditandatangani.
 */
export function petaPersetujuan(rows: readonly { level: unknown; action: unknown; nama: unknown; jabatan: unknown; timestamp: unknown; method?: unknown }[]): Map<number, Persetujuan> {
  const lv = (v: unknown): number => (typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? ''), 10));
  const wkt = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : NaN; };
  const ok = rows.filter((r) => up(r.action) === 'APPROVED' && Number.isFinite(lv(r.level)));
  /** Waktu baris APPROVED terakhir di level itu: -Infinity bila tidak ada, NaN bila ada yang waktunya tak terbaca. */
  const terakhir = (level: number): number => {
    const t = ok.filter((r) => lv(r.level) === level).map((r) => wkt(r.timestamp));
    return t.length === 0 ? -Infinity : t.some(Number.isNaN) ? NaN : Math.max(...t);
  };
  const mulaiSiklus = terakhir(LEVEL.PIC);
  const mulaiPersetujuan = terakhir(LEVEL.FINANCE_STAFF);
  const m = new Map<number, Persetujuan>();
  for (const r of ok) { // urutan baris = urutan append (kronologis); yang terakhir menang
    const level = lv(r.level);
    const t = wkt(r.timestamp);
    const batas = level >= LEVEL.FINANCE_MGR ? Math.max(mulaiSiklus, mulaiPersetujuan) : mulaiSiklus;
    if (level !== LEVEL.PIC && Number.isNaN(batas)) continue;
    if (batas > -Infinity && !(t >= batas)) continue;
    m.set(level, { level, nama: str(r.nama), jabatan: str(r.jabatan), timestamp: r.timestamp, method: str(r.method) });
  }
  return m;
}

/** No. rekening untuk tampilan detail: hanya 4 digit terakhir. Voucher cetak memuat nomor penuh (memang dibutuhkan untuk transfer). */
export function maskRekening(no: string): string {
  const s = no.replace(/\s+/g, '');
  if (!s) return '-';
  return s.length <= 4 ? '****' : `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

// ------------------------------------------------------------------ stepper
export interface LangkahAlur { status: string; label: string; pj: string; state: 'selesai' | 'sekarang' | 'menunggu' }
const ALUR: readonly { status: string; pj: string }[] = [
  { status: STATUS.DRAFT, pj: 'PIC' }, { status: STATUS.SUBMITTED, pj: 'Manager' }, { status: STATUS.MANAGER_APPROVED, pj: 'Finance (pajak)' },
  { status: STATUS.TAX_VERIFIED, pj: 'Fin. Mgr / CFO' }, { status: STATUS.WET_SIGNED, pj: 'Finance (jurnal)' }, { status: STATUS.COA_POSTED, pj: 'Treasury' }, { status: STATUS.PAID, pj: 'Selesai' },
];
/**
 * Posisi dokumen di alur. Revision Needed = kembali ke PIC (langkah Draft jadi "sekarang"); Rejected = alur berhenti (tak ada langkah "sekarang").
 * Partially Paid dihitung sebagai di tahap Treasury (COA Posted).
 */
export function posisiAlur(status: string): LangkahAlur[] {
  const aktif = status === STATUS.REVISION ? STATUS.DRAFT : status === STATUS.PARTIALLY_PAID ? STATUS.COA_POSTED : status;
  const idx = ALUR.findIndex((a) => a.status === aktif);
  return ALUR.map((a, i) => ({
    status: a.status, label: a.status === STATUS.DRAFT && status === STATUS.REVISION ? 'Perlu Revisi' : labelStatus(a.status).label, pj: a.pj,
    state: status === STATUS.REJECTED ? (i < 2 ? 'selesai' : 'menunggu') : status === STATUS.PAID ? 'selesai' : idx < 0 ? 'menunggu' : i < idx ? 'selesai' : i === idx ? 'sekarang' : 'menunggu',
  }));
}

/** Umur di tahap (hari penuh) dari LAST_UPDATE; null bila tak terbaca. */
export function umurHari(lastUpdateMs: number | null, nowMs: number): number | null {
  return lastUpdateMs === null || !Number.isFinite(lastUpdateMs) ? null : Math.max(0, Math.floor((nowMs - lastUpdateMs) / 86_400_000));
}

// ------------------------------------------------------------------ timeline
export interface PeristiwaTimeline { waktu: string; ts: number; jenis: 'status' | 'persetujuan'; judul: string; oleh: string; catatan: string; metode?: string }
const SUFIKS = /\s*\[(Portal-HP|via WhatsApp)\]\s*$/;
export const bersihkanCatatan = (n: string): string => n.replace(SUFIKS, '').trim();

export interface AuditBaris { ts: number; waktu: string; email: string; action: string; field: string; oldV: string; newV: string }
export interface ApprovalBaris { ts: number; waktu: string; email: string; nama: string; level: number; label: string; method: string; action: string; notes: string }

/** Gabungan transisi status (Audit_Log STATUS_CHANGE) + keputusan approval (Trx_Approval), terlama dulu. Email diganti nama bila dikenal. */
export function susunTimeline(audit: readonly AuditBaris[], approvals: readonly ApprovalBaris[], namaDari: (email: string) => string): PeristiwaTimeline[] {
  const out: PeristiwaTimeline[] = [];
  for (const a of audit) {
    if (a.action !== 'STATUS_CHANGE' || a.field !== 'Status') continue;
    const dari = a.oldV && a.oldV !== '-' ? labelStatus(a.oldV).label : '';
    out.push({ waktu: a.waktu, ts: a.ts, jenis: 'status', judul: dari ? `${dari} → ${labelStatus(a.newV).label}` : labelStatus(a.newV).label, oleh: namaDari(a.email), catatan: '' });
  }
  for (const p of approvals) {
    const aksi = p.action.toUpperCase() === 'APPROVED' ? 'Disetujui' : p.action.toUpperCase() === 'REJECTED' ? 'Dikembalikan' : p.action;
    out.push({ waktu: p.waktu, ts: p.ts, jenis: 'persetujuan', judul: `${aksi} — ${p.label.replace(/,$/, '')}`, oleh: p.nama || namaDari(p.email), catatan: bersihkanCatatan(p.notes), metode: p.method });
  }
  return out.sort((a, b) => a.ts - b.ts || (a.jenis === 'status' ? -1 : 1));
}

// ------------------------------------------------------------------ pencarian (Ctrl+K)
export interface BarisCari { id: string; vendor: string; noInvoice: string; poNumber: string; description: string; createdBy: string; brand: string; dept: string }
/** Cocok bila SEMUA kata (>= 2 huruf total) ada di salah satu kolom: ID, vendor, invoice, P.O, keperluan. Hanya dokumen yang boleh dilihat (I13). */
export function cocokCari(roles: readonly Role[], email: string, q: string, r: BarisCari): boolean {
  const kata = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!kata.length || q.trim().length < 2) return false;
  if (!canViewDocument(roles, email, { createdBy: r.createdBy, brand: r.brand.toUpperCase(), dept: r.dept.toUpperCase() })) return false;
  const hay = [r.id, r.vendor, r.noInvoice, r.poNumber, r.description].join(' \n ').toLowerCase();
  return kata.every((k) => hay.includes(k));
}
