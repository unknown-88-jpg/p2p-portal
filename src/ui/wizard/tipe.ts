import type { Org } from '@/domain/master';

export interface VendorOpsi { kode: string; namaAsli: string; namaLengkap: string; npwp: string; bank: string; namaRekening: string; noRekening: string }
export interface VendorPo { kode: string; nama: string; tipe: string; npwp: string; bank: string; namaRekening: string; noRekening: string; status: string }
export interface DokumenPo { idTrx: string; noInvoice: string; jenis: string; amount: number; status: string }
/** Respons GET /api/po/:po (lihat getPoDetails). */
export interface DataPo {
  poNumber: string; companyName: string; statusPPN: string; subtotalPO: number; grandTotalPO: number; description: string; qtyPO: number; kodeVendor: string; brandName: string;
  qtySJ: number; qtyKurang: number; plafonSJ: number; sisaBolehTagih: number;
  billing: { totalDiajukan: number; totalDibayar: number; dokumen: DokumenPo[] };
  vendor: VendorPo;
}
export type StatusMuat = 'idle' | 'memuat' | 'siap' | 'galat';
export interface Muat<T> { status: StatusMuat; data: T | null; galat: string | null }
export type { Org };
export interface HasilSimpan { id: string; finalAmount: number; perluCFO: boolean }
export interface HasilAjukan { id: string; status: string; finalAmount: number; perluCFO: boolean; plafon: number | null; sisaBolehTagih: number | null }
