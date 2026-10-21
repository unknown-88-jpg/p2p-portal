import { AUDIT_LOG, DB_PO, DB_SJ, MASTER_USER_TTD, MASTER_VENDOR, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex, type TabSchema } from './schema';

// Anonimisasi SALINAN spreadsheet menjadi DUMMY (design 10, Fase 0). Pemetaan konsisten: nilai asli yang sama -> nilai palsu yang sama,
// Nomor HP palsu memakai 0800000NNNN (BUKAN rentang seluler 08xx nyata) supaya WA tak pernah nyasar ke orang asli.
// sehingga kepemilikan dokumen (CREATED_BY), nama vendor di pengajuan vs master, dan rekening unik tetap utuh.
export type Kind = 'name' | 'email' | 'vendor' | 'npwp' | 'rek' | 'phone' | 'blank' | 'ref';

export interface ColumnRule { schema: TabSchema; key: string; kind: Kind }

export const RULES: readonly ColumnRule[] = [
  { schema: TRX_PENGAJUAN, key: 'PIC', kind: 'name' },
  { schema: TRX_PENGAJUAN, key: 'VENDOR_NAME', kind: 'vendor' },
  { schema: TRX_PENGAJUAN, key: 'NPWP_VENDOR', kind: 'npwp' },
  { schema: TRX_PENGAJUAN, key: 'NAMA_REKENING', kind: 'name' },
  { schema: TRX_PENGAJUAN, key: 'NO_REKENING', kind: 'rek' },
  { schema: TRX_PENGAJUAN, key: 'FILE_URL', kind: 'blank' },
  { schema: TRX_PENGAJUAN, key: 'LINK_TTD', kind: 'blank' },
  { schema: TRX_PENGAJUAN, key: 'CREATED_BY', kind: 'email' },
  { schema: TRX_PENGAJUAN, key: 'NOTES_USER', kind: 'blank' },
  { schema: TRX_PENGAJUAN, key: 'NOTES_FINANCE', kind: 'blank' },
  { schema: TRX_APPROVAL, key: 'Approver_Name', kind: 'name' },
  { schema: TRX_APPROVAL, key: 'Approver_Email', kind: 'email' },
  { schema: TRX_APPROVAL, key: 'Notes', kind: 'blank' },
  { schema: TRX_APPROVAL, key: 'Signature_URL', kind: 'blank' },
  { schema: TRX_PAYMENT_LOG, key: 'Ref_No', kind: 'ref' },
  { schema: TRX_PAYMENT_LOG, key: 'Created_By', kind: 'email' },
  { schema: AUDIT_LOG, key: 'User_Email', kind: 'email' },
  { schema: AUDIT_LOG, key: 'Old_Value', kind: 'blank' },
  { schema: AUDIT_LOG, key: 'New_Value', kind: 'blank' },
  { schema: AUDIT_LOG, key: 'Notes', kind: 'blank' },
  { schema: MASTER_USER_TTD, key: 'Nama', kind: 'name' },
  { schema: MASTER_USER_TTD, key: 'Email', kind: 'email' },
  { schema: MASTER_USER_TTD, key: 'No_HP', kind: 'phone' },
  { schema: MASTER_USER_TTD, key: 'Password_Hash', kind: 'blank' }, // user dummy set password lewat link
  { schema: MASTER_USER_TTD, key: 'Password_Salt', kind: 'blank' },
  { schema: MASTER_VENDOR, key: 'Nama Vendor', kind: 'vendor' },
  { schema: MASTER_VENDOR, key: 'NPWP', kind: 'npwp' },
  { schema: MASTER_VENDOR, key: 'Nama Pemilik Rekening', kind: 'name' },
  { schema: MASTER_VENDOR, key: 'No Rekening', kind: 'rek' },
  { schema: MASTER_VENDOR, key: 'Didaftarkan_Oleh', kind: 'email' },
  { schema: DB_PO, key: 'Vendor_Name', kind: 'vendor' },
  { schema: DB_PO, key: 'PIC_Admin', kind: 'name' },
  { schema: DB_PO, key: 'PO_File_Link', kind: 'blank' },
  { schema: DB_SJ, key: 'RECEIVED_BY', kind: 'name' },
  { schema: DB_SJ, key: 'Remarks', kind: 'blank' },
];

/**
 * DB_PO & DB_SJ di sistem asli = IMPORTRANGE LIVE dari spreadsheet sistem PO. Salinan dummy masih menarik data NYATA.
 * Sebelum anonimisasi, tab ini dibekukan jadi nilai statis (memutus tautan). `range` = lebar spill yang dibaca.
 */
export const FREEZE_TABS = [
  { tab: 'DB_PO', range: 'A1:Z' },
  { tab: 'DB_SJ', range: 'A1:J' },
] as const;

/** Nilai error rumus (hasil IMPORTRANGE/lookup) -> dikosongkan saat membekukan. */
export const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|ERROR!|DIV\/0!|NAME\?|NUM!|NULL!)$/;
export const STILL_LOADING = /^Loading\.\.\.$/i;

/** Tab/kolom yang TIDAK ditangani (data bisa memuat info nyata) -> script mencetak peringatan. */
export const NOT_HANDLED = [
  'DB_PO.Item_Name/nomor PO/RFQ, Master_COA, Master_PPh, Master_Setting (nama perusahaan/brand): tidak dianonimkan — cek manual.',
  'WA_Pending_Approval: kosongkan manual (berisi nomor HP & kode); tab ini tidak dipakai di sistem baru.',
] as const;

const digitsOnly = (s: string): string => s.replace(/\D/g, '');
const normPhone = (s: string): string => {
  const d = digitsOnly(s);
  if (d.startsWith('62')) return '0' + d.slice(2);
  if (d.startsWith('8')) return '0' + d;
  return d;
};

export class Anonymizer {
  private maps: Record<Kind, Map<string, string>> = {
    name: new Map(), email: new Map(), vendor: new Map(), npwp: new Map(), rek: new Map(), phone: new Map(), blank: new Map(), ref: new Map(),
  };

  private pick(kind: Kind, key: string, make: (n: number) => string): string {
    const m = this.maps[kind];
    const hit = m.get(key);
    if (hit !== undefined) return hit;
    const v = make(m.size + 1);
    m.set(key, v);
    return v;
  }

  /** Nilai kosong tetap kosong. Mengembalikan string (ditulis RAW sebagai teks — nol di depan aman). */
  apply(kind: Kind, value: unknown): string {
    const raw = String(value ?? '').trim();
    if (kind === 'blank') return '';
    if (!raw || raw === '-') return raw;
    const pad = (n: number, w: number): string => String(n).padStart(w, '0');
    switch (kind) {
      case 'name': return this.pick('name', raw.toLowerCase(), (n) => `Pengguna Dummy ${pad(n, 3)}`);
      case 'email': return this.pick('email', raw.toLowerCase(), (n) => `user${pad(n, 3)}@dummy.test`);
      case 'vendor': return this.pick('vendor', raw.toUpperCase(), (n) => `VENDOR DUMMY ${pad(n, 3)}`);
      case 'npwp': return this.pick('npwp', digitsOnly(raw) || raw, (n) => `99${pad(n, 13)}`);
      case 'rek': return this.pick('rek', digitsOnly(raw) || raw, (n) => `9${pad(n, 9)}`);
      case 'phone': return this.pick('phone', normPhone(raw), (n) => `0800000${pad(n, 4)}`);
      case 'ref': return this.pick('ref', raw, (n) => `REF-DUMMY-${pad(n, 5)}`);
    }
  }
}

export interface ColumnPlan { tab: string; key: string; index: number; kind: Kind }

export function plan(): ColumnPlan[] {
  return RULES.map((r) => ({ tab: r.schema.tab, key: r.key, index: colIndex(r.schema, r.key), kind: r.kind }));
}

/** Terapkan satu kolom (nilai tanpa header). Urutan pemanggilan menentukan nomor dummy -> deterministik untuk input yang sama. */
export function anonymizeColumn(a: Anonymizer, kind: Kind, values: readonly unknown[]): string[] {
  return values.map((v) => a.apply(kind, v));
}
