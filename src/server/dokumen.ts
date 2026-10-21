// Detail dokumen, voucher, pencarian, dashboard (M7). Semua jalur baca lewat canViewDocument (I13); tak berhak / tak ada = 404 (bukan 403).
import { canViewDocument } from '@/domain/capabilities';
import { CONFIG, LEVEL } from '@/domain/config';
import {
  bangunKotakTTD, cocokCari, maskRekening, petaPersetujuan, posisiAlur, susunTimeline, umurHari,
  type ApprovalBaris, type AuditBaris, type BarisCari, type BarisUserTTD,
} from '@/domain/dokumen';
import { num, str, upper } from '@/domain/legacy-parse';
import { hasAuthority } from '@/domain/roles';
import { STATUS } from '@/domain/status';
import { milikSendiri } from '@/domain/approval';

const TIDAK_DIAJUKAN: ReadonlySet<string> = new Set([STATUS.DRAFT, STATUS.REVISION, STATUS.REJECTED]);
import { AppError } from '@/lib/errors';
import { fmtTanggal, fmtWaktu, fromSheetSerial, serialToYmd, awalBulanWib, toSheetSerial } from '@/lib/time';
import type { CellValue, RawRow } from '@/ports/store';
import { AUDIT_LOG, MASTER_USER_TTD, TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex, type TabSchema } from '@/repo/schema';
import type { SessionData, AuthDeps } from './auth';
import { findRowById } from './row-index';
import { loadAccounts } from './users';
import { bacaTampilan } from './view-cache';

const cellOf = (schema: TabSchema) => (r: RawRow, k: string): CellValue => r[colIndex(schema, k)] ?? null;
const P = cellOf(TRX_PENGAJUAN), A = cellOf(TRX_APPROVAL), L = cellOf(AUDIT_LOG), Y = cellOf(TRX_PAYMENT_LOG), U = cellOf(MASTER_USER_TTD);
const NF = (): never => { throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.'); };
const dokOf = (r: RawRow) => ({ createdBy: str(P(r, 'CREATED_BY')), brand: upper(str(P(r, 'BRAND'))), dept: upper(str(P(r, 'DEPARTEMENT'))) });
const msOf = (v: CellValue): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) && n > 0 ? fromSheetSerial(n) : null; };

async function muatBoleh(d: AuthDeps, s: SessionData, idTrx: string): Promise<RawRow> {
  const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  if (!f || !canViewDocument(s.roles, s.email, dokOf(f.data))) return NF();
  return f.data;
}

function ringkasan(r: RawRow, rekening: 'penuh' | 'mask') {
  const status = str(P(r, 'STATUS'));
  const noRek = str(P(r, 'NO_REKENING'));
  return {
    id: str(P(r, 'ID_TRX')), tanggal: fmtTanggal(P(r, 'TIMESTAMP')), company: str(P(r, 'COMPANY')), brand: str(P(r, 'BRAND')), departement: str(P(r, 'DEPARTEMENT')),
    tipe: str(P(r, 'TIPE')), pic: str(P(r, 'PIC')), description: str(P(r, 'DESCRIPTION')), eventProject: str(P(r, 'EVENT_PROJECT')), notesUser: str(P(r, 'NOTES_USER')),
    notesFinance: str(P(r, 'NOTES_FINANCE')), poNumber: str(P(r, 'PO_NUMBER')), vendorKode: str(P(r, 'VENDOR_CODE')), vendorNama: str(P(r, 'VENDOR_NAME')),
    npwp: str(P(r, 'NPWP_VENDOR')), bank: str(P(r, 'BANK')), namaRekening: str(P(r, 'NAMA_REKENING')), noRekening: rekening === 'penuh' ? (noRek || '-') : maskRekening(noRek),
    noInvoice: str(P(r, 'NO_INVOICE')), dateInvoice: fmtTanggal(P(r, 'DATE_INVOICE')), dueDate: fmtTanggal(P(r, 'DUE_DATE')), jenisPembayaran: str(P(r, 'JENIS_PEMBAYARAN')),
    invoiceAmount: num(P(r, 'INV_AMOUNT')), diskon: num(P(r, 'DISKON')), biayaLainnya: num(P(r, 'BIAYA_LAIN')), statusPPN: str(P(r, 'STATUS_PPN')),
    dpp: num(P(r, 'DPP')), ppnAmount: num(P(r, 'PPN_AMOUNT')), jenisPPh: str(P(r, 'JENIS_PPH')), pphAmount: num(P(r, 'PPH_AMOUNT')), pphRate: num(P(r, 'PPH_RATE')),
    nominal: num(P(r, 'FINAL_AMOUNT')), totalPaid: num(P(r, 'TOTAL_PAID')), osBalance: num(P(r, 'OS_BALANCE')),
    status, perluCFO: upper(P(r, 'REQUIRE_CFO')) === 'YES', punyaLampiran: !!str(P(r, 'FILE_URL')),
    coa: str(P(r, 'SUB_COA')) ? { kategori: str(P(r, 'CATEGORY_COA')), head: str(P(r, 'HEAD_COA')), sub: str(P(r, 'SUB_COA')) } : null,
    editable: status === STATUS.DRAFT || status === STATUS.REVISION,
  };
}

async function namaPeta(d: AuthDeps): Promise<(email: string) => string> {
  const m = new Map<string, string>();
  for (const a of (await loadAccounts({ readRows: (sc) => bacaTampilan(d, sc) })).values()) if (a.email) m.set(a.email.trim().toLowerCase(), a.nama);
  return (email) => m.get(email.trim().toLowerCase()) ?? (email || 'Sistem');
}

async function tarikApprovals(d: AuthDeps, idTrx: string) {
  const rows = (await bacaTampilan(d, TRX_APPROVAL)).filter((r) => str(A(r, 'ID_Trx')) === idTrx);
  return rows;
}

/** Detail untuk layar: ringkasan (rekening disamarkan), stepper, timeline. */
export async function detail(d: AuthDeps, s: SessionData, idTrx: string) {
  const r = await muatBoleh(d, s, idTrx);
  const nama = await namaPeta(d);
  const approvals = await tarikApprovals(d, idTrx);
  const audit = (await bacaTampilan(d, AUDIT_LOG)).filter((x) => str(L(x, 'ID_Trx')) === idTrx);
  const aBaris: ApprovalBaris[] = approvals.map((x) => ({
    ts: msOf(A(x, 'Timestamp')) ?? 0, waktu: fmtWaktu(A(x, 'Timestamp')), email: str(A(x, 'Approver_Email')), nama: str(A(x, 'Approver_Name')),
    level: num(A(x, 'Level')), label: str(A(x, 'Role_Label')), method: str(A(x, 'Method')), action: str(A(x, 'Action')), notes: str(A(x, 'Notes')),
  }));
  const lBaris: AuditBaris[] = audit.map((x) => ({
    ts: msOf(L(x, 'Timestamp')) ?? 0, waktu: fmtWaktu(L(x, 'Timestamp')), email: str(L(x, 'User_Email')), action: str(L(x, 'Action')),
    field: str(L(x, 'Field')), oldV: str(L(x, 'Old_Value')), newV: str(L(x, 'New_Value')),
  }));
  const rk = ringkasan(r, 'mask');
  return {
    ...rk, milikSaya: !!s.email && str(P(r, 'CREATED_BY')).trim().toLowerCase() === s.email.trim().toLowerCase(),
    alur: posisiAlur(rk.status), umurHari: umurHari(msOf(P(r, 'LAST_UPDATE')), d.clock.now()),
    timeline: susunTimeline(lBaris, aBaris, nama),
  };
}

/** Data voucher cetak (paritas getPrintData lama): rekening PENUH, kotak TTD, riwayat bayar. */
export async function voucher(d: AuthDeps, s: SessionData, idTrx: string) {
  const r = await muatBoleh(d, s, idTrx);
  const rk = ringkasan(r, 'penuh');
  const approvals = await tarikApprovals(d, idTrx);
  const peta = petaPersetujuan(approvals.map((x) => ({ level: A(x, 'Level'), action: A(x, 'Action'), nama: A(x, 'Approver_Name'), jabatan: A(x, 'Jabatan'), timestamp: A(x, 'Timestamp') })));
  const users: BarisUserTTD[] = (await bacaTampilan(d, MASTER_USER_TTD)).map((x) => ({
    brand: str(U(x, 'Brand')), dept: str(U(x, 'Departement')), level: U(x, 'Level'), jabatan: str(U(x, 'Jabatan')), nama: str(U(x, 'Nama')), aktif: U(x, 'Aktif'),
  }));
  const ttd = bangunKotakTTD(users, peta, rk.brand, rk.departement, rk.perluCFO, (ts) => fmtTanggal(ts));
  const pembayaran = (await bacaTampilan(d, TRX_PAYMENT_LOG)).filter((x) => str(Y(x, 'ID_Trx')) === idTrx)
    .map((x) => ({ tgl: fmtTanggal(Y(x, 'Tgl_Bayar')), nominal: num(Y(x, 'Nominal')), sumber: str(Y(x, 'Sumber_Rekening')), ref: str(Y(x, 'Ref_No')) }));
  return { ...rk, ttd, pembayaran, ambangCFO: CONFIG.CFO_THRESHOLD, dicetak: fmtWaktu(toSheetSerial(d.clock.now())) };
}

/** Ctrl+K: hanya dokumen yang boleh dilihat pengguna (I13). Maks 8 hasil, terbaru dulu. */
export async function cari(d: AuthDeps, s: SessionData, q: string) {
  const query = q.trim().slice(0, 60);
  if (query.length < 2) return [];
  // Pembatas per pengguna: 40 pencarian/menit (cegah ketikan beruntun/skrip memindai seluruh tab).
  const rk = `srch:${s.email.trim().toLowerCase() || s.phone}:${Math.floor(d.clock.now() / 60_000)}`;
  const hit = await d.redis.incr(rk);
  if (hit === 1) await d.redis.pexpire(rk, 120_000);
  if (hit > 40) throw new AppError('RATE_LIMITED', 'Terlalu banyak pencarian. Coba lagi sebentar.', undefined, 30);
  const out: { id: string; vendor: string; invoice: string; status: string; nominal: number }[] = [];
  const rows = await bacaTampilan(d, TRX_PENGAJUAN);
  for (let i = rows.length - 1; i >= 0 && out.length < 8; i--) {
    const r = rows[i]!;
    const id = str(P(r, 'ID_TRX'));
    if (!id) continue;
    const b: BarisCari = {
      id, vendor: str(P(r, 'VENDOR_NAME')), noInvoice: str(P(r, 'NO_INVOICE')), poNumber: str(P(r, 'PO_NUMBER')), description: str(P(r, 'DESCRIPTION')),
      createdBy: str(P(r, 'CREATED_BY')), brand: str(P(r, 'BRAND')), dept: str(P(r, 'DEPARTEMENT')),
    };
    if (cocokCari(s.roles, s.email, query, b)) out.push({ id, vendor: b.vendor, invoice: b.noInvoice, status: str(P(r, 'STATUS')), nominal: num(P(r, 'FINAL_AMOUNT')) });
  }
  return out;
}

/** Ringkasan dashboard. PIC: dokumen miliknya; Manager: antrean berwenang + ringkasan divisi bulan ini. */
export async function dashboard(d: AuthDeps, s: SessionData) {
  const rows = (await bacaTampilan(d, TRX_PENGAJUAN)).filter((r) => str(P(r, 'ID_TRX')));
  const email = s.email.trim().toLowerCase();
  const milik = rows.filter((r) => email && str(P(r, 'CREATED_BY')).trim().toLowerCase() === email);
  const terbaru = milik.slice(-5).reverse().map((r) => ({ id: str(P(r, 'ID_TRX')), vendor: str(P(r, 'VENDOR_NAME')), status: str(P(r, 'STATUS')), nominal: num(P(r, 'FINAL_AMOUNT')), waktu: fmtWaktu(P(r, 'LAST_UPDATE')) }));
  const perStatus = (st: string) => milik.filter((r) => str(P(r, 'STATUS')) === st).length;
  const pic = { revisi: perStatus(STATUS.REVISION), draft: perStatus(STATUS.DRAFT), menunggu: perStatus(STATUS.SUBMITTED), terbaru };

  let manager = null as null | { antrean: number; totalNominal: number; tertuaHari: number | null; divisi: { nama: string; jumlah: number; nominal: number }[] };
  if (s.roles.some((x) => x.level === LEVEL.MANAGER)) {
    const berwenang = (r: RawRow): boolean => hasAuthority(s.roles, upper(str(P(r, 'BRAND'))), upper(str(P(r, 'DEPARTEMENT'))), LEVEL.MANAGER);
    const antre = rows.filter((r) => str(P(r, 'STATUS')) === STATUS.SUBMITTED && berwenang(r) && !milikSendiri(str(P(r, 'CREATED_BY')), s.email));
    const bln = awalBulanWib(d.clock.now());
    const peta = new Map<string, { jumlah: number; nominal: number }>();
    for (const r of rows) {
      // F-06: hanya dokumen yang pernah diajukan (bukan Draft/Revision Needed/Rejected: tidak memegang kuota).
      if (TIDAK_DIAJUKAN.has(str(P(r, 'STATUS'))) || !berwenang(r) || (serialToYmd(P(r, 'TIMESTAMP')) ?? '') < bln) continue;
      const k = `${upper(str(P(r, 'BRAND')))} / ${upper(str(P(r, 'DEPARTEMENT')))}`;
      const v = peta.get(k) ?? { jumlah: 0, nominal: 0 };
      v.jumlah += 1; v.nominal += num(P(r, 'FINAL_AMOUNT')); peta.set(k, v);
    }
    const umur = antre.map((r) => umurHari(msOf(P(r, 'LAST_UPDATE')), d.clock.now())).filter((x): x is number => x !== null);
    manager = { antrean: antre.length, totalNominal: antre.reduce((a, r) => a + num(P(r, 'FINAL_AMOUNT')), 0), tertuaHari: umur.length ? Math.max(...umur) : null, divisi: [...peta].map(([nama, v]) => ({ nama, ...v })).sort((a, b) => b.nominal - a.nominal) };
  }
  return { pic, manager };
}
