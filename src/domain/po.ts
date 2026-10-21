import { CONFIG } from './config';
import { num, upper } from './legacy-parse';

// Padanan hitungPlafonSJ_ + assertPOTidakOverbilling_ (API_PO.gs). Satu-satunya sumber kebenaran plafon (tampilan = enforcement).

/** Plafon nilai yang boleh ditagih atas PO. 90% bebas (DP/cicilan tanpa syarat SJ); 10% terakhir (retensi) baru boleh bila qtySJ >= qtyPO. qtyPO<=0 (jasa): penuh. */
export function hitungPlafonSJ(grandTotal: unknown, qtyPO: unknown, qtySJ: unknown): number {
  const gt = num(grandTotal), qPO = num(qtyPO), qSJ = num(qtySJ);
  if (gt <= 0) return 0;
  if (qPO <= 0) return gt;
  const plafonBebas = Math.round(gt * (1 - num(CONFIG.PO_RETENSI_PELUNASAN_PCT)));
  return qSJ >= qPO ? gt : plafonBebas;
}

export interface PoRecord {
  poNumber: string; companyName: string; statusPPN: string; subtotalPO: number; grandTotalPO: number;
  description: string; qtyPO: number; kodeVendor: string;
}
/** Hasil pencarian PO. 'unreadable' = DB_PO/DB_SJ (IMPORTRANGE) error/loading: BUKAN "PO tidak ada". */
export type PoLookup =
  | { status: 'found'; po: PoRecord; qtySJ: number }
  | { status: 'notFound' }
  | { status: 'unreadable' };

const rp = (n: unknown): string => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

export type CeilingResult = { ok: true; plafon: number; sisaBoleh: number } | { ok: false; plafon: number; message: string };

/** `totalDiajukan` = kumulatif non-Rejected atas PO ini, TERMASUK dokumen yang sedang disubmit. */
export function cekPlafonPO(a: { poNumber: string; grandTotal: number; qtyPO: number; qtySJ: number; totalDiajukan: number }): CeilingResult {
  const plafon = hitungPlafonSJ(a.grandTotal, a.qtyPO, a.qtySJ);
  if (a.totalDiajukan > plafon) {
    const poClean = upper(a.poNumber);
    const diterimaPenuh = a.qtyPO > 0 && a.qtySJ >= a.qtyPO;
    const saran = diterimaPenuh
      ? 'Cek Surat Jalan atau kurangi nominal invoice.'
      : `Ini sudah masuk porsi pelunasan terakhir (retensi ${Math.round(CONFIG.PO_RETENSI_PELUNASAN_PCT * 100)}%) - ` +
        'baru bisa ditagih penuh setelah Surat Jalan menunjukkan barang diterima LENGKAP.';
    return { ok: false, plafon, message: `Melebihi plafon P.O "${poClean}". Total yang diajukan atas PO ini (${rp(a.totalDiajukan)}, termasuk dokumen ini) melebihi plafon saat ini (${rp(plafon)}). ${saran}` };
  }
  return { ok: true, plafon, sisaBoleh: Math.max(plafon - a.totalDiajukan, 0) };
}

export type PoSubmitDecision =
  | { ok: true; plafon: number; sisaBoleh: number }
  | { ok: false; code: 'PO_NOT_FOUND' | 'PO_UNREADABLE' | 'OVER_CEILING'; message: string };

/**
 * GATE SUBMIT (keputusan user 2026-10-12): PO tak ketemu ATAU tak terbaca -> TOLAK. (Kode lama meloloskan - celah yang ditutup.)
 * Tak terbaca = sementara ("coba lagi"), bukan "PO tidak ada". Dipanggil M4 saat submit tipe Trade.
 */
export function gatePoSubmit(poNumber: string, lookup: PoLookup, totalDiajukan: number): PoSubmitDecision {
  if (lookup.status === 'unreadable') return { ok: false, code: 'PO_UNREADABLE', message: 'Data P.O sedang disinkronkan dari sistem sumber. Coba lagi sebentar.' };
  if (lookup.status === 'notFound') return { ok: false, code: 'PO_NOT_FOUND', message: `Nomor P.O "${upper(poNumber)}" tidak ditemukan di DB_PO.` };
  const c = cekPlafonPO({ poNumber, grandTotal: lookup.po.grandTotalPO, qtyPO: lookup.po.qtyPO, qtySJ: lookup.qtySJ, totalDiajukan });
  return c.ok ? c : { ok: false, code: 'OVER_CEILING', message: c.message };
}

/** Padanan loop prefix di searchPODetails: baris Master_Setting berurutan, prefix = kolom E, cocok bila nomor PO MENGANDUNG prefix; yang pertama menang. */
export function cocokkanPrefix(rows: readonly (readonly unknown[])[], poClean: string): { company: string; brand: string } {
  for (const r of rows) {
    const prefix = upper(r[4]);
    if (prefix && poClean.indexOf(prefix) !== -1) return { company: String(r[0] ?? '').trim(), brand: String(r[1] ?? '').trim() };
  }
  return { company: '', brand: '' };
}
