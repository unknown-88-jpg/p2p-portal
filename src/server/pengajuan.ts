import { can } from '@/domain/capabilities';
import { LEVEL } from '@/domain/config';
import { RuleError } from '@/domain/errors';
import { num, str, upper } from '@/domain/legacy-parse';
import { bangunEntitas, cariVendor, type Vendor } from '@/domain/master';
import {
  cariInvoiceDuplikat, cekHakPengaju, hitungDraft, ID_PREFIX, invoiceLockName, pesanInvoiceDuplikat,
  validatePengajuan, type BarisRingkas, type PengajuanInput,
} from '@/domain/pengajuan';
import { gatePoSubmit, type PoLookup } from '@/domain/po';
import { hasAuthority, normEmail } from '@/domain/roles';
import { checkTransition, STATUS } from '@/domain/status';
import { AppError } from '@/lib/errors';
import { serialToYmd, toSheetSerial, ymdToSerial } from '@/lib/time';
import type { CellValue, Mutation, RawRow, TableStore } from '@/ports/store';
import { MASTER_SETTING, MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { auditMutation } from './audit';
import { idLockName, nextId } from './id-gen';
import { findRowById } from './row-index';
import { lookupPo, readBilling } from './po-read';
import type { SessionData } from './auth';
import { sodAktif } from './approval';
import { loadAccounts } from './users';
import { bacaTampilan } from './view-cache';
import { runAction, type UowDeps } from './uow';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const cell = (r: RawRow, k: string): CellValue => r[T(k)] ?? null;
const BOLEH_EDIT: readonly string[] = [STATUS.DRAFT, STATUS.REVISION];

const RULE = (e: unknown): never => {
  if (e instanceof RuleError) throw new AppError('RULE_VIOLATION', e.message);
  throw e;
};
const guardRule = async <T>(fn: () => T | Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { return RULE(e); } };

const isOwner = (s: SessionData, r: RawRow): boolean => !!normEmail(s.email) && normEmail(str(cell(r, 'CREATED_BY'))) === normEmail(s.email);
function assertOwner(s: SessionData, r: RawRow): void {
  if (!isOwner(s, r)) throw new AppError('FORBIDDEN', 'Dokumen ini bukan milik Anda.');
}
function assertEmail(s: SessionData): void {
  if (!normEmail(s.email)) throw new AppError('FORBIDDEN', 'Email Anda belum terdaftar di Master_User_TTD, jadi belum bisa membuat pengajuan. Hubungi admin.');
}

/** Master_Vendor SEGAR -> vendor sah (Approved + tipe sama) untuk pengajuan. Bukan dari cache (I8). */
async function vendorSah(store: TableStore, kode: string, tipe: string): Promise<Vendor> {
  const v = cariVendor(await store.readRows(MASTER_VENDOR), kode);
  if (!v || upper(v.status) !== 'APPROVED' || str(v.tipe).toLowerCase() !== tipe.toLowerCase()) {
    throw new AppError('RULE_VIOLATION', `Vendor "${kode}" tidak terdaftar atau belum disahkan Finance.`);
  }
  return v;
}
async function companyOf(store: TableStore, brand: string): Promise<string> {
  const ent = bangunEntitas(await store.readRows(MASTER_SETTING));
  return ent.brandCompanyMap[upper(brand)] ?? '';
}
const ringkas = (rows: readonly RawRow[]): BarisRingkas[] =>
  rows.map((r) => ({ idTrx: str(cell(r, 'ID_TRX')), vendorKode: str(cell(r, 'VENDOR_CODE')), vendorNama: str(cell(r, 'VENDOR_NAME')), noInvoice: str(cell(r, 'NO_INVOICE')), status: str(cell(r, 'STATUS')) }));

/** Draft/revisi Trade: cari PO (best-effort). Tak ketemu = tolak. Tak terbaca = lanjut tanpa snapshot (submit TETAP wajib baca segar). */
async function periksaPoUntukDraft(store: TableStore, po: string, vendor: Vendor): Promise<{ qtyPO: number; qtySJ: number }> {
  const lk = await lookupPo(store, po);
  if (lk.status === 'notFound') throw new AppError('NOT_FOUND', `Nomor P.O "${upper(po)}" tidak ditemukan di DB_PO.`);
  if (lk.status === 'unreadable') return { qtyPO: 0, qtySJ: 0 };
  if (upper(lk.po.kodeVendor) !== upper(vendor.kode)) throw new AppError('RULE_VIOLATION', `Vendor pada P.O ini adalah "${lk.po.kodeVendor}", bukan "${vendor.kode}".`);
  return { qtyPO: lk.po.qtyPO, qtySJ: lk.qtySJ };
}

const idemOf = (k?: string): { idempotencyKey?: string } => (k ? { idempotencyKey: k } : {});

// ---------------------------------------------------------------- buat draft
export async function createDraft(d: UowDeps, s: SessionData, input: PengajuanInput, idemKey?: string) {
  assertEmail(s);
  const hak = cekHakPengaju(s.roles, input.brand, input.departement);
  if (hak) throw new AppError('FORBIDDEN', hak);
  const prefix = ID_PREFIX[input.tipe];

  return runAction(d, {
    name: 'pengajuan.create', actor: s.email, ...idemOf(idemKey),
    lockKeys: [idLockName(prefix), invoiceLockName(input.vendorKode, input.noInvoice)],
    execute: async ({ store, clock }) => {
      const company = await companyOf(store, input.brand);
      const vendor = await vendorSah(store, input.vendorKode, input.tipe);
      await guardRule(() => validatePengajuan(input, company));
      const dup = cariInvoiceDuplikat(ringkas(await store.readRows(TRX_PENGAJUAN)), vendor, input.noInvoice);
      if (dup) throw new AppError('RULE_VIOLATION', pesanInvoiceDuplikat(input.noInvoice, vendor.nama, dup.idTrx));
      const qty = input.tipe === 'Trade' ? await periksaPoUntukDraft(store, str(input.poNumber), vendor) : { qtyPO: 0, qtySJ: 0 };
      const calc = await guardRule(() => hitungDraft({ ...input, npwpVendor: vendor.npwp }));
      const id = await nextId(d.redis, store, { prefix, pad: 5, schema: TRX_PENGAJUAN, keyCol: 'ID_TRX' });
      const now = toSheetSerial(clock.now());
      const cells: Record<string, CellValue> = {
        ...isiBaris(input, vendor, company, s.nama, calc, qty),
        ID_TRX: id, TIMESTAMP: now, TIPE: input.tipe, STATUS: STATUS.DRAFT, CREATED_BY: s.email.trim(), LAST_UPDATE: now,
        TOTAL_PAID: 0, PAY_STATUS: 'Outstanding', LINK_TTD: '',
      };
      const mutations: Mutation[] = [
        { kind: 'append', schema: TRX_PENGAJUAN, cells },
        auditMutation({ actor: s.email, idTrx: id, action: 'CREATE', field: 'Pengajuan', newValue: calc.finalAmount, notes: 'Draft dibuat' }, clock),
      ];
      return { mutations, result: { id, finalAmount: calc.finalAmount, perluCFO: calc.perluCFO } };
    },
  });
}

/** Sel data pengajuan yang berasal dari input + turunan server (dipakai create & update; identik dengan urutan field sistem lama). */
function isiBaris(i: PengajuanInput, v: Vendor, company: string, picNama: string, c: ReturnType<typeof hitungDraft>, qty: { qtyPO: number; qtySJ: number }): Record<string, CellValue> {
  return {
    COMPANY: company, BRAND: upper(i.brand), DEPARTEMENT: upper(i.departement), PIC: picNama, DESCRIPTION: i.description,
    EVENT_PROJECT: str(i.eventProject) || '-', NOTES_USER: str(i.notesUser), PO_NUMBER: str(i.poNumber) ? upper(i.poNumber) : '-',
    VENDOR_NAME: v.nama, NPWP_VENDOR: v.npwp || '-', BANK: v.bank, NAMA_REKENING: v.namaRekening, NO_REKENING: v.noRekening,
    NO_INVOICE: str(i.noInvoice), DATE_INVOICE: ymdToSerial(i.dateInvoice), DUE_DATE: ymdToSerial(i.dueDate), VENDOR_CODE: v.kode,
    INV_AMOUNT: num(i.invoiceAmount), DISKON: num(i.diskon), BIAYA_LAIN: num(i.biayaLainnya), STATUS_PPN: str(i.statusPPN) || 'Non PPN',
    DPP: c.dpp, PPN_AMOUNT: c.ppnAmount, JENIS_PPH: '-', PPH_AMOUNT: 0, PPH_RATE: 0, FINAL_AMOUNT: c.finalAmount,
    JENIS_PEMBAYARAN: i.jenisPembayaran, REQUIRE_CFO: c.perluCFO ? 'YES' : 'NO', OS_BALANCE: c.finalAmount,
    QTY_PO: qty.qtyPO, QTY_SJ: qty.qtySJ,
  };
}

// ---------------------------------------------------------------- update draft / revisi
export async function updateDraft(d: UowDeps, s: SessionData, idTrx: string, input: PengajuanInput, idemKey?: string) {
  assertEmail(s);
  const hak = cekHakPengaju(s.roles, input.brand, input.departement);
  if (hak) throw new AppError('FORBIDDEN', hak);

  return runAction(d, {
    name: 'pengajuan.update', actor: s.email, ...idemOf(idemKey),
    lockKeys: [`trx:${idTrx}`, invoiceLockName(input.vendorKode, input.noInvoice)],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'ID transaksi tidak ditemukan.');
      assertOwner(s, f.data);
      const status = str(cell(f.data, 'STATUS'));
      if (!BOLEH_EDIT.includes(status)) throw new AppError('CONFLICT', `Dokumen berstatus "${status}" sudah terkunci dan tidak bisa diedit.`);
      if (str(cell(f.data, 'TIPE')) !== input.tipe) throw new AppError('RULE_VIOLATION', 'Tipe pengajuan tidak bisa diubah. Buat pengajuan baru.');

      const company = await companyOf(store, input.brand);
      const vendor = await vendorSah(store, input.vendorKode, input.tipe);
      await guardRule(() => validatePengajuan(input, company));
      const dup = cariInvoiceDuplikat(ringkas(await store.readRows(TRX_PENGAJUAN)), vendor, input.noInvoice, idTrx);
      if (dup) throw new AppError('RULE_VIOLATION', pesanInvoiceDuplikat(input.noInvoice, vendor.nama, dup.idTrx));
      const qty = input.tipe === 'Trade' ? await periksaPoUntukDraft(store, str(input.poNumber), vendor) : { qtyPO: 0, qtySJ: 0 };
      const calc = await guardRule(() => hitungDraft({ ...input, npwpVendor: vendor.npwp }));
      const oldAmount = num(cell(f.data, 'FINAL_AMOUNT'));
      const cells: Record<string, CellValue> = {
        ...isiBaris(input, vendor, company, s.nama, calc, qty),
        NOTES_FINANCE: '', LAST_UPDATE: toSheetSerial(clock.now()),
        // Revisi mengubah nominal: angka pajak lama (mis. dari verifikasi Finance sebelum ditolak) basi -> kosongkan (I12, perilaku lama).
        JENIS_PPH: '-', PPH_RATE: 0, PPH_AMOUNT: 0,
      };
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells },
        auditMutation({ actor: s.email, idTrx, action: 'UPDATE', field: 'Final Amount', oldValue: oldAmount, newValue: calc.finalAmount, notes: 'Revisi oleh PIC' }, clock),
      ];
      return { mutations, result: { id: idTrx, finalAmount: calc.finalAmount, perluCFO: calc.perluCFO } };
    },
  });
}

// ---------------------------------------------------------------- submit (aksi uang: I1 I2 I8 I9 I10 I12; I11 dihapus 2026-10-24)
export async function submitPengajuan(d: UowDeps, s: SessionData, idTrx: string, idemKey: string | undefined, sod: boolean = sodAktif()) {
  assertEmail(s);
  // Pra-baca (tanpa lock) HANYA untuk menentukan nama lock; semua keputusan diambil ulang dari baca segar DI DALAM lock.
  const pre = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  if (!pre) throw new AppError('NOT_FOUND', 'ID transaksi tidak ditemukan.');
  assertOwner(s, pre.data);
  const tipe = str(cell(pre.data, 'TIPE'));
  const poPre = upper(str(cell(pre.data, 'PO_NUMBER')));
  const vendorPre = str(cell(pre.data, 'VENDOR_CODE'));
  const invPre = str(cell(pre.data, 'NO_INVOICE'));
  const locks = [`trx:${idTrx}`, invoiceLockName(vendorPre, invPre)];
  if (tipe === 'Trade' && poPre && poPre !== '-') locks.push(`po:${poPre}`);

  return runAction(d, {
    name: 'pengajuan.submit', actor: s.email, money: true, ...idemOf(idemKey), lockKeys: locks,
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'ID transaksi tidak ditemukan.');
      const r = f.data;
      assertOwner(s, r);
      // Baris berubah antara pra-baca dan lock (mis. diedit di tab lain): kunci yang dipegang bisa salah -> minta ulang.
      if (upper(str(cell(r, 'PO_NUMBER'))) !== poPre || str(cell(r, 'VENDOR_CODE')) !== vendorPre || str(cell(r, 'NO_INVOICE')) !== invPre) {
        throw new AppError('CONFLICT', 'Dokumen baru saja berubah. Muat ulang lalu ajukan lagi.', undefined, 1);
      }
      const dari = str(cell(r, 'STATUS'));
      const tr = checkTransition(dari, STATUS.SUBMITTED);
      if (tr) throw new AppError('CONFLICT', dari === STATUS.SUBMITTED ? 'Dokumen ini sudah diajukan.' : tr);
      if (!str(cell(r, 'FILE_URL'))) throw new AppError('RULE_VIOLATION', 'Soft file invoice belum diupload.');

      // Manager harus ada, atau dokumen tertahan permanen (lama: hanya tombol UI yang dimatikan).
      const akunAktif = [...(await loadAccounts(store)).values()].filter((a) => a.aktif);
      const brand = upper(str(cell(r, 'BRAND'))), dept = upper(str(cell(r, 'DEPARTEMENT')));
      if (!hasAuthority(akunAktif.flatMap((a) => a.roles), brand, dept, LEVEL.MANAGER)) {
        throw new AppError('RULE_VIOLATION', `Divisi ${dept} belum punya Manager (Level 2) di Master_User_TTD. Pengajuan akan tertahan permanen. Hubungi admin.`);
      }
      // O5a: approver != pembuat. Tanpa Manager lain, dokumen tak akan pernah bisa disetujui (tertahan permanen) -> tolak sekarang.
      if (sod && !hasAuthority(akunAktif.filter((a) => normEmail(a.email) !== normEmail(s.email)).flatMap((a) => a.roles), brand, dept, LEVEL.MANAGER)) {
        throw new AppError('RULE_VIOLATION', `Divisi ${dept} tidak punya Manager (Level 2) selain Anda sendiri. Persetujuan harus dari Manager lain (pemisahan tugas), jadi pengajuan akan tertahan. Hubungi admin.`);
      }
      // Hak PIC masih berlaku saat submit (peran bisa dicabut setelah draft dibuat).
      const hak = cekHakPengaju(s.roles, brand, dept);
      if (hak) throw new AppError('FORBIDDEN', hak);

      const vendor = await vendorSah(store, vendorPre, tipe);
      const company = await companyOf(store, brand);
      const input: PengajuanInput = {
        tipe: tipe as PengajuanInput['tipe'], brand, departement: dept, description: str(cell(r, 'DESCRIPTION')), poNumber: poPre === '-' ? '' : poPre,
        vendorKode: vendor.kode, noInvoice: invPre, dateInvoice: serialToYmd(cell(r, 'DATE_INVOICE')), dueDate: serialToYmd(cell(r, 'DUE_DATE')),
        jenisPembayaran: str(cell(r, 'JENIS_PEMBAYARAN')), invoiceAmount: num(cell(r, 'INV_AMOUNT')), diskon: num(cell(r, 'DISKON')),
        biayaLainnya: num(cell(r, 'BIAYA_LAIN')), statusPPN: str(cell(r, 'STATUS_PPN')),
      };
      await guardRule(() => validatePengajuan(input, company));
      const dup = cariInvoiceDuplikat(ringkas(await store.readRows(TRX_PENGAJUAN)), vendor, invPre, idTrx);
      if (dup) throw new AppError('RULE_VIOLATION', pesanInvoiceDuplikat(invPre, vendor.nama, dup.idTrx));

      // I2 + I1: nominal dihitung ULANG dari nilai mentah; flag CFO dikunci di sini (threshold tak bisa "digeser" belakangan).
      const calc = await guardRule(() => hitungDraft({ ...input, npwpVendor: vendor.npwp }));

      let qtyPO = 0, qtySJ = 0, plafon: number | null = null, sisa: number | null = null;
      if (tipe === 'Trade') {
        const lk: PoLookup = await lookupPo(store, poPre);
        const billing = await readBilling(store, poPre, idTrx);
        const dec = gatePoSubmit(poPre, lk, billing.totalDiajukan + calc.finalAmount);
        if (!dec.ok) {
          // Tak terbaca = sementara (503 "coba lagi"); tak ketemu / lewat plafon = penolakan aturan (422). Keduanya: submit TIDAK jalan.
          if (dec.code === 'PO_UNREADABLE') throw new AppError('UPSTREAM_BUSY', dec.message, undefined, 3);
          throw new AppError('RULE_VIOLATION', dec.message);
        }
        if (lk.status !== 'found') throw new AppError('INTERNAL', 'Status PO tidak konsisten.');
        if (upper(lk.po.kodeVendor) !== upper(vendor.kode)) throw new AppError('RULE_VIOLATION', `Vendor pada P.O ini adalah "${lk.po.kodeVendor}", bukan "${vendor.kode}".`);
        qtyPO = lk.po.qtyPO; qtySJ = lk.qtySJ; plafon = dec.plafon; sisa = dec.sisaBoleh;
      }

      const oldFinal = num(cell(r, 'FINAL_AMOUNT'));
      const now = toSheetSerial(clock.now());
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: {
          STATUS: STATUS.SUBMITTED, LAST_UPDATE: now, DPP: calc.dpp, PPN_AMOUNT: calc.ppnAmount, FINAL_AMOUNT: calc.finalAmount,
          REQUIRE_CFO: calc.perluCFO ? 'YES' : 'NO', OS_BALANCE: calc.finalAmount - num(cell(r, 'TOTAL_PAID')), QTY_PO: qtyPO, QTY_SJ: qtySJ,
        } },
        { kind: 'append', schema: TRX_APPROVAL, cells: {
          ID_Approval: `APR-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, ID_Trx: idTrx, Level: LEVEL.PIC, Role_Label: 'Dibuat Oleh,',
          Approver_Name: s.nama, Approver_Email: s.email.trim(), Jabatan: s.jabatan, Method: 'E-SIGN', Action: 'APPROVED', Timestamp: now,
          Notes: 'Diajukan & e-sign otomatis [Portal-HP]', Signature_URL: '',
        } },
        auditMutation({ actor: s.email, idTrx, action: 'STATUS_CHANGE', field: 'Status', oldValue: dari, newValue: STATUS.SUBMITTED,
          notes: oldFinal !== calc.finalAmount ? `Diajukan oleh PIC; nominal dihitung ulang server ${oldFinal} -> ${calc.finalAmount}` : 'Diajukan oleh PIC' }, clock),
        auditMutation({ actor: s.email, idTrx, action: 'APPROVAL', field: 'Level 1 (Portal-HP)', newValue: 'APPROVED', notes: 'Diajukan & e-sign otomatis' }, clock),
      ];
      return { mutations, result: { id: idTrx, status: STATUS.SUBMITTED as string, finalAmount: calc.finalAmount, perluCFO: calc.perluCFO, plafon, sisaBolehTagih: sisa } };
    },
  });
}

// ---------------------------------------------------------------- cek duplikat invoice (saran saat blur; BUKAN penjaga)
/**
 * Cek inline untuk wizard (design 7.6). Hanya saran dini: penjaga sebenarnya tetap di create/update/submit (lock `inv:` + baca segar).
 * Tanpa lock & tanpa audit (hanya baca). Pesan & cakupan sama dengan penolakan create (vendor yang sama, selain Rejected, selain dokumen sendiri).
 * Hanya untuk pengaju (Level 1): ID dokumen lain di pesan sudah terlihat oleh pengaju lewat penolakan create, jadi tidak ada informasi baru.
 */
export async function cekInvoice(d: UowDeps, s: SessionData, q: { vendorKode: string; noInvoice: string; excludeId?: string }): Promise<{ duplikat: { id: string; pesan: string } | null }> {
  if (!can(s.roles, 'pengajuan.write')) throw new AppError('FORBIDDEN', 'Akun Anda tidak berwenang membuat pengajuan.');
  const vendor = cariVendor(await d.store.readRows(MASTER_VENDOR), q.vendorKode);
  if (!vendor) return { duplikat: null }; // vendor tak dikenal: bukan urusan cek ini (create akan menolaknya dengan pesan yang tepat)
  const dup = cariInvoiceDuplikat(ringkas(await d.store.readRows(TRX_PENGAJUAN)), vendor, q.noInvoice, q.excludeId);
  return { duplikat: dup ? { id: dup.idTrx, pesan: pesanInvoiceDuplikat(q.noInvoice, vendor.nama, dup.idTrx) } : null };
}

// ---------------------------------------------------------------- baca
function dto(r: RawRow) {
  const status = str(cell(r, 'STATUS'));
  return {
    id: str(cell(r, 'ID_TRX')), tanggal: serialToYmd(cell(r, 'TIMESTAMP')), company: str(cell(r, 'COMPANY')), brand: str(cell(r, 'BRAND')),
    departement: str(cell(r, 'DEPARTEMENT')), tipe: str(cell(r, 'TIPE')), pic: str(cell(r, 'PIC')), description: str(cell(r, 'DESCRIPTION')),
    eventProject: str(cell(r, 'EVENT_PROJECT')), notesUser: str(cell(r, 'NOTES_USER')), poNumber: str(cell(r, 'PO_NUMBER')),
    vendorKode: str(cell(r, 'VENDOR_CODE')), vendorNama: str(cell(r, 'VENDOR_NAME')), noInvoice: str(cell(r, 'NO_INVOICE')),
    dateInvoice: serialToYmd(cell(r, 'DATE_INVOICE')), dueDate: serialToYmd(cell(r, 'DUE_DATE')), jenisPembayaran: str(cell(r, 'JENIS_PEMBAYARAN')),
    invoiceAmount: num(cell(r, 'INV_AMOUNT')), diskon: num(cell(r, 'DISKON')), biayaLainnya: num(cell(r, 'BIAYA_LAIN')), statusPPN: str(cell(r, 'STATUS_PPN')),
    dpp: num(cell(r, 'DPP')), ppnAmount: num(cell(r, 'PPN_AMOUNT')), nominal: num(cell(r, 'FINAL_AMOUNT')), status,
    notesFinance: str(cell(r, 'NOTES_FINANCE')), perluCFO: upper(cell(r, 'REQUIRE_CFO')) === 'YES', qtyPO: num(cell(r, 'QTY_PO')), qtySJ: num(cell(r, 'QTY_SJ')),
    punyaLampiran: !!str(cell(r, 'FILE_URL')), // link Drive mentah TIDAK dikirim ke klien (lampiran lewat proxy ber-otorisasi, M4b/M7)
    editable: BOLEH_EDIT.includes(status), submittable: BOLEH_EDIT.includes(status),
  };
}

/** Daftar milik pengguna (terbaru dulu). */
export async function listMine(d: UowDeps, s: SessionData) {
  const rows = await bacaTampilan(d, TRX_PENGAJUAN); // tampilan: cache pendek (naik versi tiap tulis)
  return rows.filter((r) => str(cell(r, 'ID_TRX')) && isOwner(s, r)).map(dto).reverse().slice(0, 300);
}

/** Detail satu dokumen - HANYA pemilik (M4). Akses manager/Finance (I13) menyusul di M5/M7. */
export async function getMine(d: UowDeps, s: SessionData, idTrx: string) {
  const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
  if (!isOwner(s, f.data)) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.'); // 404, bukan 403: tidak membocorkan keberadaan ID
  return dto(f.data);
}

