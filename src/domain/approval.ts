import { CONFIG, LEVEL } from './config';
import { hasAuthority, normEmail, type Role } from './roles';
import { checkTransition, STATUS, type Status } from './status';

// Aturan approval Manager (Level 2). Murni: tanpa I/O. Perilaku lama: Approval.gs (managerApprove/managerReject).

export const ALASAN_MAX = 500;
export const CATATAN_MAX = 300;
export const LABEL_L2 = 'Diperiksa Oleh,'; // LEVEL_LABEL[2] di Config.gs
export const CATATAN_PORTAL = '[Portal-HP]'; // penanda lama pada Trx_Approval (identityOverride)
export const PREFIX_TOLAK = '[DITOLAK MANAGER] ';

/** Template alasan umum untuk UI (design 7.x E). Hanya bantuan ketik; server tetap hanya menerima teks bebas. */
export const TEMPLATE_ALASAN = [
  'Lampiran invoice tidak jelas / tidak terbaca',
  'Nominal tidak sesuai dengan invoice',
  'Vendor atau nomor invoice perlu dicek ulang',
  'Deskripsi keperluan kurang jelas',
] as const;

/** I14/D9: step-up password untuk approve di web pada nominal >= ambang. Dievaluasi dari nominal TERSIMPAN. */
export const butuhStepUp = (nominalTersimpan: number): boolean => nominalTersimpan >= CONFIG.APPROVE_STEPUP_MIN;

/** Nilai yang menentukan "dokumen yang sama persis dengan yang dilihat manager". Berubah bila status/isi/nominal berubah. */
export interface VersiDokumen {
  status: string; lastUpdate: string | number | null; finalAmount: number; invAmount: number; diskon: number; biayaLain: number;
  vendorKode: string; noInvoice: string; tipe: string; poNumber: string; statusPPN: string; fileAda: boolean;
}
export function kunciVersi(v: VersiDokumen): string {
  return [v.status, String(v.lastUpdate ?? ''), v.finalAmount, v.invAmount, v.diskon, v.biayaLain, v.vendorKode, v.noInvoice, v.tipe, v.poNumber, v.statusPPN, v.fileAda ? 1 : 0].join('|');
}

export type Tolak = { code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN'; message: string };
const NF: Tolak = { code: 'NOT_FOUND', message: 'Dokumen tidak ditemukan.' };

/** Wewenang atas brand/dept. Di luar wewenang = 404 (tidak membocorkan keberadaan ID), konsisten dengan I13. */
export function cekWewenang(roles: readonly Role[], doc: { brand: string; dept: string }): Tolak | null {
  return hasAuthority(roles, doc.brand, doc.dept, LEVEL.MANAGER) ? null : NF;
}

/** I3: hanya lewat STATUS_FLOW. Approve = ke Manager Approved; tolak = ke Revision Needed (perilaku lama, BUKAN Rejected). */
export function cekStatus(aksi: 'approve' | 'reject', statusSekarang: string): Tolak | null {
  const tujuan: Status = aksi === 'approve' ? STATUS.MANAGER_APPROVED : STATUS.REVISION;
  if (statusSekarang !== STATUS.SUBMITTED) {
    return { code: 'CONFLICT', message: `Dokumen ini sudah tidak menunggu persetujuan Manager (status: ${statusSekarang || '-'}). Muat ulang daftar.` };
  }
  const tr = checkTransition(statusSekarang, tujuan);
  return tr ? { code: 'CONFLICT', message: tr } : null;
}

export const etagCocok = (dikirim: string, sekarang: string): boolean => dikirim.length > 0 && dikirim === sekarang;

export type HasilSoD = { ok: true; penanda: string } | { ok: false; tolak: Tolak };
/**
 * O5a: approver Level 2 != pembuat dokumen. `aktif` = flag SOD_APPROVER_NOT_CREATOR.
 * Penanda (masuk Audit_Log) selalu mencatat kondisi; self-approval dengan flag OFF diberi penanda eksplisit.
 */
export function cekSoD(pembuatEmail: string, approverEmail: string, aktif: boolean): HasilSoD {
  const a = normEmail(approverEmail), p = normEmail(pembuatEmail);
  const sama = !!a && a === p;
  if (aktif && !a) return { ok: false, tolak: { code: 'FORBIDDEN', message: 'Email Anda belum terdaftar di Master_User_TTD, jadi persetujuan tidak bisa diverifikasi. Hubungi admin.' } };
  if (aktif && sama) return { ok: false, tolak: { code: 'FORBIDDEN', message: 'Anda adalah pembuat dokumen ini. Persetujuan harus dari Manager lain (pemisahan tugas).' } };
  if (sama) return { ok: true, penanda: 'SELF-APPROVAL (SoD nonaktif)' };
  return { ok: true, penanda: aktif ? 'SoD: approver bukan pembuat' : 'SoD nonaktif; approver bukan pembuat' };
}

/** Alasan keterkuncian satu item inbox untuk tampilan (bukan penjaga; penjaga = server saat aksi). */
export function alasanTerkunci(pembuatEmail: string, approverEmail: string, sod: boolean): string | null {
  const r = cekSoD(pembuatEmail, approverEmail, sod);
  return r.ok ? null : r.tolak.message;
}

// ---- Jalur WhatsApp (M6): penanda & awalan dari WA_Approval.gs ----
export const CATATAN_WA = '[via WhatsApp]';
export const PREFIX_TOLAK_WA = '[DITOLAK MANAGER via WA] ';
/** Penanda NOTES_FINANCE saat Finance mengembalikan ke PIC (financeReject lama). */
export const PREFIX_TOLAK_FINANCE = '[DITOLAK FINANCE] ';
export type Via = 'web' | 'wa';

/** Pembuat dokumen = pengguna ini? (email, tanpa beda huruf/spasi). Dipakai menyaring antrean & hitungan Manager (M8 F-05). */
export const milikSendiri = (pembuatEmail: string, email: string): boolean => {
  const a = pembuatEmail.trim().toLowerCase();
  return a !== '' && a === email.trim().toLowerCase();
};

/** Buang awalan teknis "[DITOLAK MANAGER] " / "[DITOLAK MANAGER via WA] " dari catatan untuk ditampilkan; data di Sheet tidak berubah (M8 F-01). */
export function catatanTampil(catatan: string): string {
  const t = catatan.trim();
  for (const p of [PREFIX_TOLAK_WA, PREFIX_TOLAK]) if (t.startsWith(p.trim())) return `Dikembalikan Manager${p === PREFIX_TOLAK_WA ? ' (via WA)' : ''}: ${t.slice(p.trim().length).trim()}`;
  if (t.startsWith(PREFIX_TOLAK_FINANCE.trim())) return `Dikembalikan Finance: ${t.slice(PREFIX_TOLAK_FINANCE.trim().length).trim()}`;
  return t;
}
