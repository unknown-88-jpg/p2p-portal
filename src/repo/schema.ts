// Schema registry — menggantikan COL/COL_USER/COL_APPROVAL/COL_PAYLOG/COL_AUDIT di Config.gs.
// Urutan kolom lama dipertahankan PERSIS (kolom baru hanya ditambah di paling kanan).
export type ColType = 'text' | 'money' | 'date' | 'datetime' | 'enum' | 'bool';
export interface Col { readonly key: string; readonly type: ColType; /** header lain yang sah untuk posisi ini */ readonly aliases?: readonly string[] }
export interface TabSchema {
  readonly tab: string;
  readonly cols: readonly Col[];
  /** false = header tab belum didaftarkan penuh (hanya posisi yang disebut eksplisit yang dicek). */
  readonly strictHeader: boolean;
}

const c = (key: string, type: ColType = 'text', aliases?: readonly string[]): Col => ({ key, type, aliases });

// Trx_Pengajuan: header di sheet = nama kunci COL (lihat headerPengajuan_() di Setup.gs).
// FILE_URL (T) & LINK_TTD (AH) sengaja boleh berheader "Soft File" (permintaan user).
export const TRX_PENGAJUAN: TabSchema = {
  tab: 'Trx_Pengajuan',
  strictHeader: true,
  cols: [
    c('ID_TRX'), c('TIMESTAMP', 'datetime'), c('COMPANY'), c('BRAND'), c('DEPARTEMENT'), c('TIPE', 'enum'),
    c('PIC'), c('DESCRIPTION'), c('EVENT_PROJECT'), c('NOTES_USER'), c('PO_NUMBER'), c('VENDOR_NAME'),
    c('NPWP_VENDOR'), c('BANK'), c('NAMA_REKENING'), c('NO_REKENING'), c('NO_INVOICE'), c('DATE_INVOICE', 'date'),
    c('DUE_DATE', 'date'), c('FILE_URL', 'text', ['Soft File']), c('VENDOR_CODE'), c('INV_AMOUNT', 'money'),
    c('DISKON', 'money'), c('BIAYA_LAIN', 'money'), c('STATUS_PPN', 'enum'), c('DPP', 'money'),
    c('PPN_AMOUNT', 'money'), c('JENIS_PPH'), c('PPH_AMOUNT', 'money'), c('PPH_RATE'), c('FINAL_AMOUNT', 'money'),
    c('STATUS', 'enum'), c('CREATED_BY'), c('LINK_TTD', 'text', ['Soft File']), c('JENIS_PEMBAYARAN', 'enum'),
    c('CATEGORY_COA'), c('HEAD_COA'), c('SUB_COA'), c('BUDGET'), c('NOTES_FINANCE'), c('REQUIRE_CFO', 'enum'),
    c('LAST_UPDATE', 'datetime'), c('LAST_PAY_DATE', 'datetime'), c('TOTAL_PAID', 'money'), c('OS_BALANCE', 'money'),
    c('PAY_STATUS', 'enum'), c('QTY_PO', 'money'), c('QTY_SJ', 'money'),
  ],
};

export const TRX_APPROVAL: TabSchema = {
  tab: 'Trx_Approval', strictHeader: true,
  cols: [c('ID_Approval'), c('ID_Trx'), c('Level'), c('Role_Label'), c('Approver_Name'), c('Approver_Email'),
    c('Jabatan'), c('Method'), c('Action'), c('Timestamp', 'datetime'), c('Notes'), c('Signature_URL')],
};

export const TRX_PAYMENT_LOG: TabSchema = {
  tab: 'Trx_Payment_Log', strictHeader: true,
  cols: [c('Log_ID'), c('ID_Trx'), c('Tgl_Bayar', 'date'), c('Nominal', 'money'), c('Sumber_Rekening'),
    c('Ref_No'), c('Created_By'), c('Timestamp', 'datetime')],
};

export const AUDIT_LOG: TabSchema = {
  tab: 'Audit_Log', strictHeader: true,
  cols: [c('Log_ID'), c('Timestamp', 'datetime'), c('User_Email'), c('ID_Trx'), c('Action'), c('Field'),
    c('Old_Value'), c('New_Value'), c('Notes')],
};

// Master_User_TTD: setupDatabase() memaksa header ini.
export const MASTER_USER_TTD: TabSchema = {
  tab: 'Master_User_TTD', strictHeader: true,
  cols: [c('Brand'), c('Departement'), c('Level'), c('Jabatan'), c('Nama'), c('Email'), c('Aktif', 'bool'),
    c('No_HP'), c('Password_Hash'), c('Password_Salt')],
};

// Master_Vendor: label header asli dari salinan dummy (2026-10-08). Posisi sesuai CRUD_Vendor.gs (A..J).
export const MASTER_VENDOR: TabSchema = {
  tab: 'Master_Vendor', strictHeader: true,
  cols: [c('Kode Vendor'), c('Nama Vendor'), c('Tipe Vendor', 'enum'), c('NPWP'), c('Bank'), c('Nama Pemilik Rekening'),
    c('No Rekening'), c('Status', 'enum'), c('Didaftarkan_Oleh'), c('Tgl_Daftar', 'datetime')],
};

// DB_PO & DB_SJ = IMPORTRANGE dari sistem PO lain (header datang dari sumber -> validator menangkap bila sumber mengubah kolom).
export const DB_PO: TabSchema = {
  tab: 'DB_PO', strictHeader: true,
  cols: [c('PO'), c('PO_Date', 'date'), c('RFQ_Ref_ID'), c('Vendor_Name'), c('Vendor_Quote_No'), c('Status', 'enum'),
    c('Company_Name'), c('PIC_Admin'), c('Tax_Status', 'enum'), c('Subtotal', 'money'), c('PPN_Amount', 'money'),
    c('Service Fee', 'money'), c('Grand_Total', 'money'), c('PO_File_Link'), c('Item_Name'), c('QTY PO', 'money'),
    c('Kode Vendor')],
};

export const DB_SJ: TabSchema = {
  tab: 'DB_SJ', strictHeader: true,
  cols: [c('GR_ID'), c('PO_ID'), c('DELIVERY_NOTE_NO'), c('RECEIVED_DATE', 'date'), c('RECEIVED_BY'),
    c('Total_Qty_Received', 'money'), c('Remarks')],
};

// Master_Setting / Master_COA / Master_PPh: header asli BELUM diketahui (hanya posisi kolom dari kode lama) -> strictHeader:false,
// kunci bersifat posisional. Cukup tab-nya ada; kolom dibaca per posisi persis seperti API_Master.gs.
export const MASTER_SETTING: TabSchema = {
  tab: 'Master_Setting', strictHeader: false,
  cols: [c('Company'), c('Brand'), c('Kolom_C'), c('Kolom_D'), c('Prefix_PO')], // C & D diabaikan sistem lama
};
export const MASTER_COA: TabSchema = {
  tab: 'Master_COA', strictHeader: false,
  cols: [c('Level_1'), c('Level_2'), c('Level_3'), c('Level_4'), c('Level_5')],
};
export const MASTER_PPH: TabSchema = {
  tab: 'Master_PPh', strictHeader: false,
  cols: [c('Jenis'), c('Tarif_NPWP', 'money'), c('Tarif_Non_NPWP', 'money')],
};

export const SCHEMAS: readonly TabSchema[] = [
  TRX_PENGAJUAN, TRX_APPROVAL, TRX_PAYMENT_LOG, AUDIT_LOG, MASTER_USER_TTD, MASTER_VENDOR, MASTER_SETTING, MASTER_COA, MASTER_PPH, DB_PO, DB_SJ,
];

/** Indeks kolom 0-based dari key — dipakai repo, tidak ada angka magic. */
export function colIndex(schema: TabSchema, key: string): number {
  const i = schema.cols.findIndex((x) => x.key === key);
  if (i < 0) throw new Error(`Kolom ${key} tidak ada di ${schema.tab}`);
  return i;
}
