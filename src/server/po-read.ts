import { isSheetError, num, str, upper } from '@/domain/legacy-parse';
import { cocokkanPrefix, type PoLookup } from '@/domain/po';
import { STATUS } from '@/domain/status';
import type { RawRow, TableStore } from '@/ports/store';
import { DB_PO, DB_SJ, MASTER_SETTING, TRX_PENGAJUAN, colIndex } from '@/repo/schema';

const P = (k: string): number => colIndex(DB_PO, k);
const J = (k: string): number => colIndex(DB_SJ, k);
const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);

/**
 * Cari PO di DB_PO (+ qty diterima dari DB_SJ). Keduanya IMPORTRANGE: sel error/"Loading..." => 'unreadable' (BUKAN notFound).
 * Deteksi error dipersempit supaya satu sel #N/A di kolom yang tak dipakai tidak memblokir semua PO:
 *  - kolom kunci (PO / PO_ID) di SEMUA baris - kegagalan IMPORTRANGE biasanya menjangkiti kolom pertama;
 *  - kolom yang dipakai pada baris yang COCOK.
 */
export async function lookupPo(store: TableStore, poNumber: string): Promise<PoLookup> {
  const poClean = upper(poNumber);
  const [po, sj] = await Promise.all([store.readRows(DB_PO), store.readRows(DB_SJ)]);

  if (po.some((r) => isSheetError(r[P('PO')]))) return { status: 'unreadable' };
  if (sj.some((r) => isSheetError(r[J('PO_ID')]))) return { status: 'unreadable' };

  const row = po.find((r) => upper(r[P('PO')]) === poClean);
  if (!row) return { status: 'notFound' };
  const usedPo = ['Company_Name', 'Tax_Status', 'Subtotal', 'Grand_Total', 'Item_Name', 'QTY PO', 'Kode Vendor'];
  if (usedPo.some((k) => isSheetError(row[P(k)]))) return { status: 'unreadable' };

  let qtySJ = 0;
  for (const r of sj) {
    if (upper(r[J('PO_ID')]) !== poClean) continue;
    if (isSheetError(r[J('Total_Qty_Received')])) return { status: 'unreadable' };
    qtySJ += num(r[J('Total_Qty_Received')]);
  }
  return {
    status: 'found', qtySJ,
    po: {
      poNumber: poClean, companyName: str(row[P('Company_Name')]), statusPPN: str(row[P('Tax_Status')]) || 'Non PPN',
      subtotalPO: num(row[P('Subtotal')]), grandTotalPO: num(row[P('Grand_Total')]), description: str(row[P('Item_Name')]),
      qtyPO: num(row[P('QTY PO')]), kodeVendor: str(row[P('Kode Vendor')]),
    },
  };
}

export async function readSettingRows(store: TableStore): Promise<RawRow[]> { return store.readRows(MASTER_SETTING); }
export { cocokkanPrefix };

export interface BillingDoc { idTrx: string; noInvoice: string; jenis: string; amount: number; status: string }
export interface Billing { totalDiajukan: number; totalDibayar: number; dokumen: BillingDoc[] }

/**
 * Kumulatif tagihan atas PO = dokumen yang SUDAH DIAJUKAN (Submitted ke atas). Tidak dihitung: Draft, Revision Needed (kembali ke tangan PIC), Rejected.
 * Keputusan 2026-10-21: beda dari sistem lama yang ikut menghitung Draft (draft menganggur menahan kuota PO). Kuota diperebutkan saat SUBMIT, dijaga lock `po:`.
 * Tampilan (/api/po) dan guard submit memakai fungsi yang sama. `excludeIdTrx` = dokumen yang sedang dihitung ulang (nilai barunya ditambahkan pemanggil).
 */
const TIDAK_MENAHAN_KUOTA: readonly string[] = [STATUS.REJECTED, STATUS.DRAFT, STATUS.REVISION];
export async function readBilling(store: TableStore, poNumber: string, excludeIdTrx?: string): Promise<Billing> {
  const rows = await store.readRows(TRX_PENGAJUAN);
  const target = upper(poNumber), ex = excludeIdTrx ? str(excludeIdTrx) : '';
  let totalDiajukan = 0, totalDibayar = 0;
  const dokumen: BillingDoc[] = [];
  for (const r of rows) {
    if (upper(r[T('PO_NUMBER')]) !== target) continue;
    const status = str(r[T('STATUS')]);
    if (TIDAK_MENAHAN_KUOTA.includes(status)) continue;
    if (ex && str(r[T('ID_TRX')]) === ex) continue;
    const amount = num(r[T('FINAL_AMOUNT')]);
    totalDiajukan += amount;
    totalDibayar += num(r[T('TOTAL_PAID')]);
    dokumen.push({ idTrx: str(r[T('ID_TRX')]), noInvoice: str(r[T('NO_INVOICE')]) || '-', jenis: str(r[T('JENIS_PEMBAYARAN')]) || '-', amount, status });
  }
  return { totalDiajukan, totalDibayar, dokumen };
}
