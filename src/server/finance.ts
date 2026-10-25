import { can } from '@/domain/capabilities';
import { wajibCFO, bisaLihatFinance, cekBolehDibayar, isKunciTahap, ringkasTahap, statusPersetujuan, tahapDariStatus, tugasRangkapBayar, type KunciTahap, type RingkasTahap } from '@/domain/finance';
import { LEVEL } from '@/domain/config';
import { milikSendiri } from '@/domain/approval';
import { umurHari } from '@/domain/dokumen';
import { clean, num, str, upper } from '@/domain/legacy-parse';
import { AppError } from '@/lib/errors';
import { fromSheetSerial, serialToYmd, wibDate } from '@/lib/time';
import type { CellValue, RawRow } from '@/ports/store';
import { TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { etagOf } from './approval';
import type { AuthDeps, SessionData } from './auth';
import { statusWaFinance } from './wa-manual-finance';
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
  /** Isian awal form verifikasi pajak (F2-B) + versi dokumen untuk etag. `punyaNPWP` saja (nomornya tidak dikirim) untuk pratinjau tarif PPh. */
  etag: string; invoiceAmount: number; diskon: number; biayaLainnya: number; punyaNPWP: boolean; jenisPembayaran: string;
  /** Dokumen ini diajukan oleh pengguna yang sedang login (I6: tidak boleh memverifikasi pajaknya sendiri; penjaga di F2-B). */
  ajuanSendiri: boolean;
  /** Tahap persetujuan (F2-C): siapa yang sudah menyetujui di siklus verifikasi sekarang (nama saja). */
  persetujuan?: { finMgr: string | null; cfo: string | null; finMgrSaya: boolean; /** tombol Kirim WA: tujuan berikutnya & jatah manual sudah terpakai */ wa: { target: 'finmgr' | 'cfo'; terkirim: boolean } | null };
  /** Tahap bayar (F2-E): alasan gerbang I4 bila belum boleh dibayar (tampilan), dan peran rangkap pengguna ini (peringatan O5b). */
  blokirBayar?: string | null; tugasRangkap?: string[];
}
/** Peran Finance pengguna (untuk tombol yang ditampilkan; penjaga sebenarnya di server). */
export interface PeranFinance { staff: boolean; finMgr: boolean; cfo: boolean }
export interface AntreanFinance { tahap: RingkasTahap[]; items: ItemFinance[]; basi: boolean; peran: PeranFinance }

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
    perluCFO: wajibCFO(cell(r, 'REQUIRE_CFO'), nominal), punyaLampiran: !!str(cell(r, 'FILE_URL')),
    umurHari: umurHari(msOf(cell(r, 'LAST_UPDATE')), now), ajuanSendiri: milikSendiri(str(cell(r, 'CREATED_BY')), s.email),
    etag: etagOf(r), invoiceAmount: num(cell(r, 'INV_AMOUNT')), diskon: num(cell(r, 'DISKON')), biayaLainnya: num(cell(r, 'BIAYA_LAIN')),
    punyaNPWP: !['', '-'].includes(clean(cell(r, 'NPWP_VENDOR'))), jenisPembayaran: str(cell(r, 'JENIS_PEMBAYARAN')), // punyaNPWP: aturan sama dengan hitungPajak
  };
}

/**
 * Antrean Finance per tahap (port getFinanceQueues): lintas brand/divisi seperti sistem lama, hanya untuk L3/L4/L5 (lainnya 403).
 * Bacaan TAMPILAN ber-cache (15 dtk); aksi Finance (F2-B..F2-E) selalu baca segar di dalam lock. `basi` = salinan lama dipakai karena Sheets gagal.
 * Urutan: terbaru dulu. `tahap` opsional menyaring item (ringkasan tetap semua tahap).
 */
export async function antreanFinance(d: AuthDeps, s: SessionData, tahap?: string | null): Promise<AntreanFinance> {
  assertFinance(s);
  if (tahap && !isKunciTahap(tahap)) throw new AppError('VALIDATION', 'Tahap tidak dikenal.');
  const { rows, basi } = await bacaTampilanDetail(d, TRX_PENGAJUAN);
  const now = d.clock.now(), hariIni = wibDate(now);
  const semua = rows.map((r) => itemOf(r, s, now, hariIni)).filter((x): x is ItemFinance => x !== null)
    .sort((a, b) => (a.umurHari ?? 1e9) - (b.umurHari ?? 1e9) || b.id.localeCompare(a.id)); // terbaru dulu (UI bisa urut ulang)
  const tunggu = semua.filter((i) => i.tahap === 'persetujuan' || i.tahap === 'bayar');
  if (tunggu.length) {
    const baris = new Map(rows.map((r) => [str(cell(r, 'ID_TRX')).toUpperCase(), r]));
    const A = (x: RawRow, k: string): CellValue => x[colIndex(TRX_APPROVAL, k)] ?? null;
    const per = new Map<string, RawRow[]>();
    for (const x of await bacaTampilanDetail(d, TRX_APPROVAL).then((h) => h.rows)) {
      const id = str(A(x, 'ID_Trx')).toUpperCase();
      if (id) per.set(id, [...(per.get(id) ?? []), x]);
    }
    for (const i of tunggu) {
      const ba = (per.get(i.id.toUpperCase()) ?? []).map((x) => ({ level: A(x, 'Level'), action: A(x, 'Action'), nama: A(x, 'Approver_Name'), email: A(x, 'Approver_Email'), timestamp: A(x, 'Timestamp') }));
      const st = statusPersetujuan(ba);
      if (i.tahap === 'persetujuan') {
        i.persetujuan = { finMgr: st.finMgr?.nama ?? null, cfo: st.cfo?.nama ?? null, finMgrSaya: !!st.finMgr && milikSendiri(st.finMgr.email, s.email), wa: await statusWaFinance(d.redis, i.id, i.perluCFO, ba) };
        continue;
      }
      const r = baris.get(i.id.toUpperCase());
      const apr = per.get(i.id.toUpperCase()) ?? [];
      i.blokirBayar = r ? cekBolehDibayar({ status: i.status, perluCFO: i.perluCFO, subCoa: str(cell(r, 'SUB_COA')), st,
        manager: apr.some((x) => Number(A(x, 'Level')) === LEVEL.MANAGER && upper(A(x, 'Action')) === 'APPROVED') }) : null;
      i.tugasRangkap = tugasRangkapBayar(s.email, st);
    }
  }
  const peran = { staff: can(s.roles, 'tax.verify'), finMgr: can(s.roles, 'sign.eapprove.finmgr'), cfo: can(s.roles, 'sign.eapprove.cfo') };
  return { tahap: ringkasTahap(semua, s.roles), items: (tahap ? semua.filter((i) => i.tahap === tahap) : semua).slice(0, 500), basi, peran };
}
