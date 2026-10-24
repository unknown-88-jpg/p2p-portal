// F3-D: laporan AP & viewer audit — murni. Semua angka dihitung dari baris yang sama (Trx_Pengajuan + Trx_Payment_Log),
// tidak ada kolom ringkasan terpisah: "dibayar" selalu = jumlah Trx_Payment_Log (sumber kebenaran pembayaran, sama dengan rekonsiliasi).
import { petaDibayar } from './admin';
import { num, str, upper } from './legacy-parse';
import { tglYmd } from './odoo';
import { STATUS } from './status';

type Baris = Readonly<Record<string, unknown>>;

/** Dokumen yang sudah menjadi kewajiban (lolos Manager) dan belum lunas. Draft/Submitted/Revision/Rejected/Paid tidak termasuk. */
export const STATUS_HUTANG: readonly string[] = [STATUS.MANAGER_APPROVED, STATUS.TAX_VERIFIED, STATUS.WET_SIGNED, STATUS.COA_POSTED, STATUS.PARTIALLY_PAID];
/** Dokumen yang dihitung di rekap periode (sudah diajukan & tidak ditolak). */
const STATUS_REKAP: readonly string[] = [STATUS.SUBMITTED, ...STATUS_HUTANG, STATUS.PAID];

export const BUCKET_AGING = ['Belum jatuh tempo', '0–30 hari', '31–60 hari', '> 60 hari', 'Tanpa jatuh tempo'] as const;
export type BucketAging = (typeof BUCKET_AGING)[number];

const hariAntara = (dari: string, sampai: string): number => Math.round((Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000);
export function bucketAging(due: string, hariIni: string): { bucket: BucketAging; hariLewat: number | null } {
  if (!due) return { bucket: 'Tanpa jatuh tempo', hariLewat: null };
  const h = hariAntara(due, hariIni);
  if (h <= 0) return { bucket: 'Belum jatuh tempo', hariLewat: h };
  return { bucket: h <= 30 ? '0–30 hari' : h <= 60 ? '31–60 hari' : '> 60 hari', hariLewat: h };
}

export interface BarisAging { id: string; vendor: string; brand: string; dept: string; status: string; dueDate: string; hariLewat: number | null; bucket: BucketAging; total: number; dibayar: number; sisa: number }
export interface Aging { baris: BarisAging[]; perBucket: { bucket: BucketAging; jumlah: number; sisa: number }[]; perVendor: { vendor: string; jumlah: number; sisa: number; terlama: number | null }[]; totalSisa: number }

/** Aging AP: sisa = nominal akhir − pembayaran di log; umur dari jatuh tempo (WIB). Sisa ≤ 0 (lunas lewat log) tidak dihitung. */
export function agingAP(pengajuan: readonly Baris[], pembayaran: readonly Baris[], hariIni: string): Aging {
  const paid = petaDibayar(pembayaran);
  const baris: BarisAging[] = [];
  for (const r of pengajuan) {
    const id = str(r.ID_TRX), status = str(r.STATUS);
    if (!id || !STATUS_HUTANG.includes(status)) continue;
    const total = num(r.FINAL_AMOUNT), dibayar = paid.get(upper(id)) ?? 0, sisa = total - dibayar;
    if (sisa <= 0) continue;
    const dueDate = tglYmd(r.DUE_DATE);
    baris.push({ id, vendor: str(r.VENDOR_NAME) || '(tanpa vendor)', brand: str(r.BRAND), dept: str(r.DEPARTEMENT), status, dueDate, ...bucketAging(dueDate, hariIni), total, dibayar, sisa });
  }
  baris.sort((a, b) => (b.dueDate || '0000').localeCompare(a.dueDate || '0000') || b.id.localeCompare(a.id)); // jatuh tempo terbaru dulu
  const perBucket = BUCKET_AGING.map((bucket) => { const xs = baris.filter((x) => x.bucket === bucket); return { bucket, jumlah: xs.length, sisa: xs.reduce((s, x) => s + x.sisa, 0) }; });
  const pv = new Map<string, { vendor: string; jumlah: number; sisa: number; terlama: number | null }>();
  for (const x of baris) {
    const k = upper(x.vendor), v = pv.get(k) ?? { vendor: x.vendor, jumlah: 0, sisa: 0, terlama: null };
    v.jumlah++; v.sisa += x.sisa;
    if (x.hariLewat !== null && (v.terlama === null || x.hariLewat > v.terlama)) v.terlama = x.hariLewat;
    pv.set(k, v);
  }
  return { baris, perBucket, perVendor: [...pv.values()].sort((a, b) => b.sisa - a.sisa || a.vendor.localeCompare(b.vendor)), totalSisa: baris.reduce((s, x) => s + x.sisa, 0) };
}

export const DIMENSI_REKAP = ['brand', 'dept', 'coa', 'budget', 'vendor'] as const;
export type DimensiRekap = (typeof DIMENSI_REKAP)[number];
const nilaiDimensi = (r: Baris, d: DimensiRekap): string => {
  const v = d === 'brand' ? str(r.BRAND) : d === 'dept' ? str(r.DEPARTEMENT) : d === 'coa' ? str(r.SUB_COA) : d === 'budget' ? str(r.BUDGET) : str(r.VENDOR_NAME);
  return v && v !== '-' ? v : d === 'coa' ? '(belum dijurnal)' : '(kosong)';
};

export interface BarisRekap { kunci: string; jumlah: number; total: number; dibayar: number; sisa: number }
/** Rekap per dimensi untuk dokumen bertanggal invoice (kosong → tanggal submit) di rentang WIB inklusif — tanggal sama dengan export Odoo. */
export function rekapPeriode(pengajuan: readonly Baris[], pembayaran: readonly Baris[], a: { dari: string; sampai: string; dimensi: DimensiRekap }): { baris: BarisRekap[]; total: BarisRekap } {
  const paid = petaDibayar(pembayaran);
  const m = new Map<string, BarisRekap>();
  const total: BarisRekap = { kunci: 'Total', jumlah: 0, total: 0, dibayar: 0, sisa: 0 };
  for (const r of pengajuan) {
    const id = str(r.ID_TRX);
    if (!id || !STATUS_REKAP.includes(str(r.STATUS))) continue;
    const tgl = tglYmd(r.DATE_INVOICE) || tglYmd(r.TIMESTAMP);
    if (!tgl || tgl < a.dari || tgl > a.sampai) continue;
    const k = nilaiDimensi(r, a.dimensi), nominal = num(r.FINAL_AMOUNT), dibayar = paid.get(upper(id)) ?? 0, sisa = str(r.STATUS) === STATUS.PAID ? 0 : Math.max(0, nominal - dibayar);
    const g = m.get(upper(k)) ?? { kunci: k, jumlah: 0, total: 0, dibayar: 0, sisa: 0 };
    for (const x of [g, total]) { x.jumlah++; x.total += nominal; x.dibayar += dibayar; x.sisa += sisa; }
    m.set(upper(k), g);
  }
  return { baris: [...m.values()].sort((x, y) => y.total - x.total || x.kunci.localeCompare(y.kunci)), total };
}

export interface BarisBayar { logId: string; tgl: string; idTrx: string; vendor: string; brand: string; nominal: number; sumber: string; ref: string; oleh: string }
/** Log pembayaran per tanggal bayar (WIB, inklusif), terbaru dulu. */
export function logPembayaran(pembayaran: readonly Baris[], pengajuan: readonly Baris[], a: { dari: string; sampai: string }): { baris: BarisBayar[]; total: number } {
  const meta = new Map(pengajuan.map((r) => [upper(r.ID_TRX), { vendor: str(r.VENDOR_NAME), brand: str(r.BRAND) }]));
  const baris: BarisBayar[] = [];
  for (const p of pembayaran) {
    const tgl = tglYmd(p.Tgl_Bayar);
    if (!tgl || tgl < a.dari || tgl > a.sampai) continue;
    const idTrx = upper(p.ID_Trx), m = meta.get(idTrx);
    baris.push({ logId: str(p.Log_ID), tgl, idTrx, vendor: m?.vendor ?? '', brand: m?.brand ?? '', nominal: num(p.Nominal), sumber: str(p.Sumber_Rekening), ref: str(p.Ref_No), oleh: str(p.Created_By) });
  }
  baris.sort((x, y) => y.tgl.localeCompare(x.tgl) || y.logId.localeCompare(x.logId));
  return { baris, total: baris.reduce((s, x) => s + x.nominal, 0) };
}

// ---------- viewer Audit_Log ----------
export interface FilterAudit { id?: string; aktor?: string; aksi?: string; dari?: string; sampai?: string }
export interface BarisAuditView { logId: string; waktuSerial: number; idTrx: string; aktor: string; aksi: string; field: string; lama: string; baru: string; catatan: string }
export const AUDIT_MAKS = 300;

/** Filter Audit_Log (terbaru dulu, maks. 300 baris). Tanggal = WIB inklusif dari kolom Timestamp (serial). */
export function cariAudit(rows: readonly Baris[], f: FilterAudit): { baris: BarisAuditView[]; cocok: number } {
  const id = upper(f.id ?? ''), aktor = (f.aktor ?? '').trim().toLowerCase(), aksi = upper(f.aksi ?? '');
  const out: BarisAuditView[] = [];
  let cocok = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (!str(r.Log_ID) && !str(r.Action)) continue;
    if (id && !upper(r.ID_Trx).includes(id)) continue;
    if (aktor && !str(r.User_Email).toLowerCase().includes(aktor)) continue;
    if (aksi && upper(r.Action) !== aksi) continue;
    const tgl = tglYmd(r.Timestamp);
    if ((f.dari && (!tgl || tgl < f.dari)) || (f.sampai && (!tgl || tgl > f.sampai))) continue;
    cocok++;
    if (out.length < AUDIT_MAKS) {
      out.push({ logId: str(r.Log_ID), waktuSerial: num(r.Timestamp), idTrx: str(r.ID_Trx), aktor: str(r.User_Email), aksi: str(r.Action), field: str(r.Field), lama: str(r.Old_Value), baru: str(r.New_Value), catatan: str(r.Notes).replace(/\s*\[idem:[^\]]*\]/g, '') });
    }
  }
  return { baris: out, cocok };
}
