import { bisaLihatFinance, isKunciTahap, ringkasTahap, tahapDariStatus, type KunciTahap, type RingkasTahap } from '@/domain/finance';
import { milikSendiri } from '@/domain/approval';
import { umurHari } from '@/domain/dokumen';
import { num, str, upper } from '@/domain/legacy-parse';
import { AppError } from '@/lib/errors';
import { fromSheetSerial, serialToYmd, wibDate } from '@/lib/time';
import type { CellValue, RawRow } from '@/ports/store';
import { TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { AuthDeps, SessionData } from './auth';
import { bacaTampilanDetail } from './view-cache';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const cell = (r: RawRow, k: string): CellValue => r[T(k)] ?? null;
const msOf = (v: CellValue): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) && n > 0 ? fromSheetSerial(n) : null; };

/** Kolom ringkas antrean (hemat kuota & data): TANPA NPWP, rekening, email pembuat. Detail lengkap lewat /pengajuan/{id} (I13). */
export interface ItemFinance {
  id: string; tahap: KunciTahap; status: string; tanggal: string; brand: string; departement: string; tipe: string; pic: string;
  vendorNama: string; noInvoice: string; poNumber: string; description: string; dueDate: string; jatuhTempoLewat: boolean;
  statusPPN: string; dpp: number; ppnAmount: number; jenisPPh: string; pphAmount: number; nominal: number; totalPaid: number; sisa: number;
  perluCFO: boolean; punyaLampiran: boolean; umurHari: number | null;
  /** Dokumen ini diajukan oleh pengguna yang sedang login (I6: tidak boleh memverifikasi pajaknya sendiri; penjaga di F2-B). */
  ajuanSendiri: boolean;
}
export interface AntreanFinance { tahap: RingkasTahap[]; items: ItemFinance[]; basi: boolean }

export function assertFinance(s: SessionData): void {
  if (!bisaLihatFinance(s.roles)) throw new AppError('FORBIDDEN', 'Halaman ini khusus Finance (Finance Staff, Fin. Mgr, CFO).');
}

function itemOf(r: RawRow, s: SessionData, now: number, hariIni: string): ItemFinance | null {
  const status = str(cell(r, 'STATUS'));
  const t = tahapDariStatus(status);
  if (!t || !str(cell(r, 'ID_TRX'))) return null;
  const nominal = num(cell(r, 'FINAL_AMOUNT')), totalPaid = num(cell(r, 'TOTAL_PAID'));
  const dueDate = serialToYmd(cell(r, 'DUE_DATE'));
  return {
    id: str(cell(r, 'ID_TRX')), tahap: t.kunci, status, tanggal: serialToYmd(cell(r, 'TIMESTAMP')), brand: str(cell(r, 'BRAND')),
    departement: str(cell(r, 'DEPARTEMENT')), tipe: str(cell(r, 'TIPE')), pic: str(cell(r, 'PIC')), vendorNama: str(cell(r, 'VENDOR_NAME')),
    noInvoice: str(cell(r, 'NO_INVOICE')), poNumber: str(cell(r, 'PO_NUMBER')), description: str(cell(r, 'DESCRIPTION')),
    dueDate, jatuhTempoLewat: !!dueDate && dueDate < hariIni,
    statusPPN: str(cell(r, 'STATUS_PPN')), dpp: num(cell(r, 'DPP')), ppnAmount: num(cell(r, 'PPN_AMOUNT')),
    jenisPPh: str(cell(r, 'JENIS_PPH')), pphAmount: num(cell(r, 'PPH_AMOUNT')), nominal, totalPaid,
    // Sisa tagihan untuk TAMPILAN saja. Aksi bayar (F2-E, I5) menghitung dari Trx_Payment_Log, bukan kolom ringkasan.
    sisa: Math.max(nominal - totalPaid, 0),
    perluCFO: upper(cell(r, 'REQUIRE_CFO')) === 'YES', punyaLampiran: !!str(cell(r, 'FILE_URL')),
    umurHari: umurHari(msOf(cell(r, 'LAST_UPDATE')), now), ajuanSendiri: milikSendiri(str(cell(r, 'CREATED_BY')), s.email),
  };
}

/**
 * Antrean Finance per tahap (port getFinanceQueues): lintas brand/divisi seperti sistem lama, hanya untuk L3/L4/L5 (lainnya 403).
 * Bacaan TAMPILAN ber-cache (15 dtk); aksi Finance (F2-B..F2-E) selalu baca segar di dalam lock. `basi` = salinan lama dipakai karena Sheets gagal.
 * Urutan: tertua di tahap dulu. `tahap` opsional menyaring item (ringkasan tetap semua tahap).
 */
export async function antreanFinance(d: AuthDeps, s: SessionData, tahap?: string | null): Promise<AntreanFinance> {
  assertFinance(s);
  if (tahap && !isKunciTahap(tahap)) throw new AppError('VALIDATION', 'Tahap tidak dikenal.');
  const { rows, basi } = await bacaTampilanDetail(d, TRX_PENGAJUAN);
  const now = d.clock.now(), hariIni = wibDate(now);
  const semua = rows.map((r) => itemOf(r, s, now, hariIni)).filter((x): x is ItemFinance => x !== null)
    .sort((a, b) => (b.umurHari ?? -1) - (a.umurHari ?? -1));
  return { tahap: ringkasTahap(semua, s.roles), items: (tahap ? semua.filter((i) => i.tahap === tahap) : semua).slice(0, 500), basi };
}
