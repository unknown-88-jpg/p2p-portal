import { can } from '@/domain/capabilities';
import { etagCocok, milikSendiri, PREFIX_TOLAK_FINANCE } from '@/domain/approval';
import { butuhCFO, CONFIG, LEVEL } from '@/domain/config';
import { isValidYmd } from '@/domain/pengajuan';
import { LEVEL_LABEL } from '@/domain/dokumen';
import { RuleError } from '@/domain/errors';
import { wajibCFO, cekBolehDibayar, cekEApprove, hitungBayar, JENDELA_DUPLIKAT_MS, penandaTugasRangkap, persetujuanLengkap, PESAN_I6, statusPersetujuan, STATUS_BOLEH_KEMBALI_FINANCE, tugasRangkapBayar, validasiJurnal, type Sebagai } from '@/domain/finance';
import { num, str, upper } from '@/domain/legacy-parse';
import { rupiah } from '@/domain/pengajuan-form';
import { checkTransition, STATUS } from '@/domain/status';
import { hitungPajak } from '@/domain/tax';
import { AppError } from '@/lib/errors';
import { fromSheetSerial, serialToYmd, toSheetSerial, wibDate, ymdToSerial } from '@/lib/time';
import type { Clock } from '@/lib/clock';
import { FIRST_DATA_ROW, type CellValue, type Mutation, type RawRow } from '@/ports/store';
import { TRX_APPROVAL, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { z } from 'zod';
import { etagOf } from './approval';
import { appendAudit, auditMutation } from './audit';
import { requireStepUp, type AuthDeps, type SessionData } from './auth';
import type { bayarSchema, jurnalSchema, kembalikanFinanceSchema, setujuiFinanceSchema, verifikasiPajakSchema } from './finance-schema';
import { readCoa, readKas, readPph } from './master-read';
import { findRowById } from './row-index';
import { runAction } from './uow';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const cell = (r: RawRow, k: string): CellValue => r[T(k)] ?? null;
const idemOf = (k: string | undefined): { idempotencyKey?: string } => (k ? { idempotencyKey: k } : {});
const CONFLICT = 'Dokumen berubah sejak Anda membukanya. Muat ulang lalu periksa lagi.';
/** Identitas penandatangan/pembayar dicatat lewat email; akun tanpa email tidak boleh bertindak di jalur uang (pemisahan tugas & jejak audit bergantung padanya). */
function wajibEmail(s: SessionData): void {
  if (!s.email.trim()) throw new AppError('FORBIDDEN', 'Akun Anda belum punya email di Master_User_TTD. Hubungi admin sebelum memproses dokumen Finance.');
}

function approvalL3(idTrx: string, s: SessionData, action: 'APPROVED' | 'REJECTED', notes: string, now: number, level: number = LEVEL.FINANCE_STAFF): Mutation {
  return {
    kind: 'append', schema: TRX_APPROVAL, cells: {
      ID_Approval: `APR-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, ID_Trx: idTrx, Level: level, Role_Label: LEVEL_LABEL[level] ?? 'Mengetahui,',
      Approver_Name: s.nama, Approver_Email: s.email.trim(), Jabatan: s.jabatan, Method: 'E-SIGN', Action: action, Timestamp: now, Notes: `${notes} [Portal-HP]`.trim(), Signature_URL: '',
    },
  };
}
const statusChange = (s: SessionData, idTrx: string, dari: string, ke: string, notes: string, clock: Clock): Mutation =>
  auditMutation({ actor: s.email, idTrx, action: 'STATUS_CHANGE', field: 'Status', oldValue: dari, newValue: ke, notes }, clock);

/**
 * F2-B: verifikasi pajak (port verifyTax). Urutan penjagaan di dalam lock dari baca SEGAR: capability L3 -> ada -> status (I3) -> etag -> I6 -> hitung.
 * I2: DPP/PPN/PPh/nominal akhir dihitung ulang server dengan tarif PPh SEGAR (bukan cache) & NPWP vendor dari baris. I1: REQUIRE_CFO dihitung ulang.
 * Satu batch: baris + approval L3 + audit STATUS_CHANGE (+ TAX_ADJUST bila nominal berubah). Idempotency-Key wajib (aksi uang).
 */
export async function verifikasiPajak(d: AuthDeps, s: SessionData, idTrx: string, input: z.infer<typeof verifikasiPajakSchema>, idemKey: string | undefined) {
  wajibEmail(s);
  if (!can(s.roles, 'tax.verify')) throw new AppError('FORBIDDEN', 'Hanya Finance Staff yang bisa memverifikasi pajak.');
  return runAction(d, {
    name: 'finance.verifikasiPajak', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: [`trx:${idTrx}`],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
      const r = f.data, dari = str(cell(r, 'STATUS'));
      if (dari !== STATUS.MANAGER_APPROVED) throw new AppError('CONFLICT', `Dokumen ini tidak sedang menunggu verifikasi pajak (status: ${dari || '-'}). Muat ulang daftar.`);
      const tr = checkTransition(dari, STATUS.TAX_VERIFIED);
      if (tr) throw new AppError('RULE_VIOLATION', tr);
      if (!etagCocok(input.etag, etagOf(r))) throw new AppError('CONFLICT', CONFLICT);
      if (milikSendiri(str(cell(r, 'CREATED_BY')), s.email)) {
        await appendAudit(store, clock, { actor: s.email, idTrx, action: 'TAX_VERIFY_BLOCKED_SOD', field: 'Level 3', newValue: 'BLOCKED', notes: 'Verifikator = pengaju (I6)' }).catch(() => undefined);
        throw new AppError('RULE_VIOLATION', PESAN_I6);
      }
      let calc;
      try {
        calc = hitungPajak({ invAmount: input.invAmount, diskon: input.diskon, biayaLain: input.biayaLain, statusPPN: input.statusPPN, jenisPPh: input.jenisPPh || '-', npwpVendor: str(cell(r, 'NPWP_VENDOR')) }, await readPph(store));
      } catch (e) { if (e instanceof RuleError) throw new AppError('RULE_VIOLATION', e.message); throw e; }

      if (calc.finalAmount <= 0) throw new AppError('RULE_VIOLATION', 'Nominal akhir harus lebih dari nol. Periksa nilai invoice, diskon, dan potongan PPh.');
      const oldFinal = num(cell(r, 'FINAL_AMOUNT'));
      const perluCFO = butuhCFO(calc.finalAmount);
      const now = toSheetSerial(clock.now());
      const notes = input.notes ?? '';
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: {
          INV_AMOUNT: input.invAmount, DISKON: input.diskon, BIAYA_LAIN: input.biayaLain, STATUS_PPN: input.statusPPN, DPP: calc.dpp, PPN_AMOUNT: calc.ppnAmount,
          JENIS_PPH: input.jenisPPh || '-', PPH_RATE: calc.pphRate, PPH_AMOUNT: calc.pphAmount, FINAL_AMOUNT: calc.finalAmount,
          OS_BALANCE: calc.finalAmount - num(cell(r, 'TOTAL_PAID')), REQUIRE_CFO: perluCFO ? 'YES' : 'NO', STATUS: STATUS.TAX_VERIFIED, LAST_UPDATE: now,
        } },
        approvalL3(idTrx, s, 'APPROVED', [`Pajak diverifikasi. Final ${rupiah(calc.finalAmount)}`, notes].filter(Boolean).join(' · '), now),
        statusChange(s, idTrx, dari, STATUS.TAX_VERIFIED, notes, clock),
      ];
      if (oldFinal !== calc.finalAmount) mutations.push(auditMutation({ actor: s.email, idTrx, action: 'TAX_ADJUST', field: 'Final Amount', oldValue: oldFinal, newValue: calc.finalAmount, notes: 'Dikoreksi staff finance' }, clock));
      if (upper(cell(r, 'REQUIRE_CFO')) !== (perluCFO ? 'YES' : 'NO')) mutations.push(auditMutation({ actor: s.email, idTrx, action: 'CFO_FLAG', field: 'Require CFO', oldValue: str(cell(r, 'REQUIRE_CFO')), newValue: perluCFO ? 'YES' : 'NO', notes: 'Dihitung ulang saat verifikasi pajak (I1)' }, clock));
      return { mutations, result: { id: idTrx, status: STATUS.TAX_VERIFIED as string, finalAmount: calc.finalAmount, dpp: calc.dpp, ppnAmount: calc.ppnAmount, pphAmount: calc.pphAmount, perluCFO, berubah: oldFinal !== calc.finalAmount } };
    },
  });
}

/**
 * Kembalikan ke PIC (port financeReject): Revision Needed, alasan wajib, NOTES_FINANCE "[DITOLAK FINANCE] alasan", approval L3 REJECTED.
 * Boleh dari tahap Finance yang alurnya mengizinkan revisi (Manager Approved, Tax Verified, Wet Signed, COA Posted). Hanya Finance Staff (L3).
 */
export async function kembalikanFinance(d: AuthDeps, s: SessionData, idTrx: string, input: z.infer<typeof kembalikanFinanceSchema>, idemKey: string | undefined) {
  wajibEmail(s);
  const staff = can(s.roles, 'tax.verify');
  const penyetuju = can(s.roles, 'sign.eapprove.finmgr') ? LEVEL.FINANCE_MGR : can(s.roles, 'sign.eapprove.cfo') ? LEVEL.CFO : null;
  if (!staff && !penyetuju) throw new AppError('FORBIDDEN', 'Hanya Finance yang bisa mengembalikan dokumen ke PIC.');
  const alasan = input.alasan.trim();
  return runAction(d, {
    name: 'finance.kembalikan', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: [`trx:${idTrx}`],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
      const r = f.data, dari = str(cell(r, 'STATUS'));
      if (!(STATUS_BOLEH_KEMBALI_FINANCE as readonly string[]).includes(dari)) throw new AppError('CONFLICT', `Dokumen ini tidak sedang di tahap Finance (status: ${dari || '-'}). Muat ulang daftar.`);
      // F2-C: Fin. Mgr / CFO hanya boleh mengembalikan di tahap persetujuannya sendiri (Tax Verified).
      if (!staff && dari !== STATUS.TAX_VERIFIED) throw new AppError('FORBIDDEN', 'Fin. Mgr / CFO hanya bisa mengembalikan dokumen yang menunggu persetujuannya.');
      const tr = checkTransition(dari, STATUS.REVISION);
      if (tr) throw new AppError('RULE_VIOLATION', tr);
      if (!etagCocok(input.etag, etagOf(r))) throw new AppError('CONFLICT', CONFLICT);
      const now = toSheetSerial(clock.now());
      return {
        mutations: [
          { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { STATUS: STATUS.REVISION, LAST_UPDATE: now, NOTES_FINANCE: PREFIX_TOLAK_FINANCE + alasan } },
          approvalL3(idTrx, s, 'REJECTED', alasan, now, staff ? LEVEL.FINANCE_STAFF : penyetuju!),
          statusChange(s, idTrx, dari, STATUS.REVISION, alasan, clock),
        ],
        result: { id: idTrx, status: STATUS.REVISION as string },
      };
    },
  });
}

/**
 * F2-C (O4): e-approve Fin. Mgr (L4) lalu CFO (L5, hanya bila REQUIRE_CFO). Menggantikan unggah scan TTD basah (submitWetSignature TIDAK diport).
 * Identitas penyetuju dari SESI (menutup R-17). Step-up password WAJIB untuk setiap e-approve. Persetujuan dibaca SEGAR dari Trx_Approval
 * untuk siklus verifikasi terakhir. Fin. Mgr tanpa CFO, atau CFO -> Wet Signed (enum lama; label "Menunggu Jurnal COA").
 * Fin. Mgr saat CFO wajib -> status tetap Tax Verified, LAST_UPDATE berubah (etag ikut berubah).
 */
export async function setujuiFinance(d: AuthDeps, s: SessionData, token: string, idTrx: string, input: z.infer<typeof setujuiFinanceSchema>, idemKey: string | undefined) {
  wajibEmail(s);
  const sebagai: Sebagai = input.sebagai;
  const capOk = can(s.roles, sebagai === 'finmgr' ? 'sign.eapprove.finmgr' : 'sign.eapprove.cfo');
  if (!capOk) throw new AppError('FORBIDDEN', sebagai === 'finmgr' ? 'Hanya Fin. Mgr yang bisa memberi persetujuan ini.' : 'Hanya CFO yang bisa memberi persetujuan ini.');
  return runAction(d, {
    name: `finance.setujui.${sebagai}`, actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: [`trx:${idTrx}`],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
      const r = f.data, dari = str(cell(r, 'STATUS'));
      if (dari !== STATUS.TAX_VERIFIED) throw new AppError('CONFLICT', `Dokumen ini tidak sedang menunggu persetujuan Fin. Mgr / CFO (status: ${dari || '-'}). Muat ulang daftar.`);
      if (!etagCocok(input.etag, etagOf(r))) throw new AppError('CONFLICT', CONFLICT);
      const A = (x: RawRow, k: string): CellValue => x[colIndex(TRX_APPROVAL, k)] ?? null;
      const rows = (await store.readRows(TRX_APPROVAL)).filter((x) => str(A(x, 'ID_Trx')).toUpperCase() === idTrx.toUpperCase())
        .map((x) => ({ level: A(x, 'Level'), action: A(x, 'Action'), nama: A(x, 'Approver_Name'), email: A(x, 'Approver_Email'), timestamp: A(x, 'Timestamp') }));
      const st = statusPersetujuan(rows);
      const perluCFO = wajibCFO(cell(r, 'REQUIRE_CFO'), num(cell(r, 'FINAL_AMOUNT')));
      const tolak = cekEApprove(sebagai, s.roles, s.email, perluCFO, st);
      if (tolak) throw new AppError(tolak.kode, tolak.pesan);
      await requireStepUp(d, token); // setelah aturan: password tidak diminta untuk aksi yang memang akan ditolak

      const lengkap = persetujuanLengkap(sebagai, perluCFO);
      const level = sebagai === 'finmgr' ? LEVEL.FINANCE_MGR : LEVEL.CFO;
      const now = toSheetSerial(clock.now());
      const penanda = penandaTugasRangkap(s.email, str(cell(r, 'CREATED_BY')), st);
      const notes = input.notes ?? '';
      const catatan = [notes, penanda].filter(Boolean).join(' · ');
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { LAST_UPDATE: now, ...(lengkap ? { STATUS: STATUS.WET_SIGNED } : {}) } },
        approvalL3(idTrx, s, 'APPROVED', [`E-approve ${sebagai === 'finmgr' ? 'Fin. Mgr' : 'CFO'}`, catatan].filter(Boolean).join(' · '), now, level),
        auditMutation({ actor: s.email, idTrx, action: 'APPROVAL', field: `Level ${level} (E-APPROVE)`, newValue: 'APPROVED', notes: catatan }, clock),
      ];
      if (lengkap) mutations.push(statusChange(s, idTrx, dari, STATUS.WET_SIGNED, catatan, clock));
      return { mutations, result: { id: idTrx, status: (lengkap ? STATUS.WET_SIGNED : STATUS.TAX_VERIFIED) as string, sebagai, menungguCFO: !lengkap, penanda } };
    },
  });
}

export interface HasilJurnal { berhasil: { id: string; akun: string }[]; gagal: { id: string; alasan: string }[] }

/**
 * F2-D (port postJournalBulk): jurnal COA untuk 1..30 dokumen Wet Signed. Hanya Finance Staff (L3).
 * Lock semua `trx:` (berurut) -> SATU baca segar Trx_Pengajuan + Master_COA -> validasi per dokumen (status, etag, COA, budget) ->
 * yang valid diterapkan dalam SATU batch; yang gagal dilaporkan per dokumen dan tidak menggagalkan sisanya. Semua gagal = 422.
 * ID ganda dalam satu permintaan ditolak (R-04). Idempotency-Key wajib untuk seluruh batch.
 */
export async function jurnalCoa(d: AuthDeps, s: SessionData, input: z.infer<typeof jurnalSchema>, idemKey: string | undefined): Promise<HasilJurnal> {
  wajibEmail(s);
  if (!can(s.roles, 'journal.post')) throw new AppError('FORBIDDEN', 'Hanya Finance Staff yang bisa memposting jurnal COA.');
  const ids = input.items.map((i) => i.id.toUpperCase());
  if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION', 'Ada dokumen yang sama lebih dari sekali dalam satu jurnal.');
  return runAction(d, {
    name: 'finance.jurnal', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: ids.map((id) => `trx:${id}`),
    execute: async ({ store, clock }) => {
      const [rows, coa] = await Promise.all([store.readRows(TRX_PENGAJUAN), readCoa(store)]);
      const posisi = new Map<string, number[]>();
      rows.forEach((r, i) => { const id = str(cell(r, 'ID_TRX')).toUpperCase(); if (id) posisi.set(id, [...(posisi.get(id) ?? []), i]); });
      const now = toSheetSerial(clock.now());
      const mutations: Mutation[] = [];
      const hasil: HasilJurnal = { berhasil: [], gagal: [] };
      for (const it of input.items) {
        const id = it.id.toUpperCase();
        const idx = posisi.get(id) ?? [];
        if (idx.length !== 1) { hasil.gagal.push({ id, alasan: idx.length ? 'ID ganda di sheet. Hubungi admin.' : 'Dokumen tidak ditemukan.' }); continue; }
        const r = rows[idx[0]!]!, dari = str(cell(r, 'STATUS'));
        if (dari !== STATUS.WET_SIGNED) { hasil.gagal.push({ id, alasan: `Tidak sedang menunggu jurnal (status: ${dari || '-'}).` }); continue; }
        if (!etagCocok(it.etag, etagOf(r))) { hasil.gagal.push({ id, alasan: 'Dokumen berubah sejak dibuka. Muat ulang.' }); continue; }
        const v = validasiJurnal(coa, it);
        if (!v.ok) { hasil.gagal.push({ id, alasan: v.alasan }); continue; }
        mutations.push(
          { kind: 'update', schema: TRX_PENGAJUAN, row: idx[0]! + FIRST_DATA_ROW, cells: { CATEGORY_COA: v.kategori, HEAD_COA: v.head, SUB_COA: v.akun, BUDGET: v.budget, NOTES_FINANCE: it.notes ?? '', STATUS: STATUS.COA_POSTED, LAST_UPDATE: now } },
          statusChange(s, id, dari, STATUS.COA_POSTED, `Jurnal: ${v.akun}`, clock),
          auditMutation({ actor: s.email, idTrx: id, action: 'COA_POST', field: 'Sub COA', oldValue: '', newValue: v.akun, notes: `Budget: ${v.budget}` }, clock),
        );
        hasil.berhasil.push({ id, akun: v.akun });
      }
      if (!hasil.berhasil.length) throw new AppError('RULE_VIOLATION', `Tidak ada dokumen yang bisa dijurnal: ${hasil.gagal.map((g) => `${g.id} (${g.alasan})`).join('; ')}`);
      return { mutations, result: hasil };
    },
  });
}

export interface HasilBayar {
  berhasil: { id: string; nominal: number; lunas: boolean; sisa: number; tugasRangkap: string[] }[];
  gagal: { id: string; alasan: string; duplikat?: boolean }[];
  total: number;
}

/**
 * F2-E (port executePayment / executePaymentBulk): bayar 1..30 dokumen. Finance Staff (L3) + step-up password WAJIB. Idempotency-Key wajib.
 * Lock semua `trx:` -> SATU baca segar Trx_Pengajuan, Trx_Approval, Trx_Payment_Log, Master_COA -> per dokumen: I4 (cekBolehDibayar),
 * etag, I5 (total dibayar dari LOG, nominal <= sisa + toleransi), fingerprint kembar 10 menit (R-04). Yang valid: SATU batch
 * (log pembayaran + ringkasan + status + audit). O5b: pembayar = verifikator/penyetuju -> penanda di audit, bukan blokir.
 */
export async function bayar(d: AuthDeps, s: SessionData, token: string, input: z.infer<typeof bayarSchema>, idemKey: string | undefined): Promise<HasilBayar> {
  wajibEmail(s);
  if (!can(s.roles, 'payment.execute')) throw new AppError('FORBIDDEN', 'Hanya Finance Staff yang bisa mengeksekusi pembayaran.');
  if (!isValidYmd(input.tglBayar)) throw new AppError('VALIDATION', 'Tanggal bayar tidak valid.');
  if (input.tglBayar > wibDate(d.clock.now())) throw new AppError('VALIDATION', 'Tanggal bayar tidak boleh di masa depan.');
  const ids = input.items.map((i) => i.id.toUpperCase());
  if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION', 'Ada dokumen yang sama lebih dari sekali dalam satu pembayaran.');
  const ref = input.refNo?.trim() || '-';
  return runAction(d, {
    name: 'finance.bayar', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: ids.map((id) => `trx:${id}`),
    execute: async ({ store, clock }) => {
      await requireStepUp(d, token);
      const [rows, apr, log, kas] = await Promise.all([store.readRows(TRX_PENGAJUAN), store.readRows(TRX_APPROVAL), store.readRows(TRX_PAYMENT_LOG), readKas(store)]);
      if (!kas.some((k) => k.akun === input.sumberRekening.trim())) throw new AppError('VALIDATION', 'Sumber rekening tidak ada di daftar kas (Master_COA).');
      const A = (x: RawRow, k: string): CellValue => x[colIndex(TRX_APPROVAL, k)] ?? null;
      const Y = (x: RawRow, k: string): CellValue => x[colIndex(TRX_PAYMENT_LOG, k)] ?? null;
      const posisi = new Map<string, number[]>();
      rows.forEach((r, i) => { const id = str(cell(r, 'ID_TRX')).toUpperCase(); if (id) posisi.set(id, [...(posisi.get(id) ?? []), i]); });
      const now = clock.now(), nowSerial = toSheetSerial(now), tglSerial = ymdToSerial(input.tglBayar);
      const mutations: Mutation[] = [];
      const hasil: HasilBayar = { berhasil: [], gagal: [], total: 0 };
      for (const it of input.items) {
        const id = it.id.toUpperCase();
        const idx = posisi.get(id) ?? [];
        if (idx.length !== 1) { hasil.gagal.push({ id, alasan: idx.length ? 'ID ganda di sheet. Hubungi admin.' : 'Dokumen tidak ditemukan.' }); continue; }
        const r = rows[idx[0]!]!, dari = str(cell(r, 'STATUS'));
        const aprDok = apr.filter((x) => str(A(x, 'ID_Trx')).toUpperCase() === id);
        const st = statusPersetujuan(aprDok.map((x) => ({ level: A(x, 'Level'), action: A(x, 'Action'), nama: A(x, 'Approver_Name'), email: A(x, 'Approver_Email'), timestamp: A(x, 'Timestamp') })));
        const gerbang = cekBolehDibayar({
          status: dari, perluCFO: wajibCFO(cell(r, 'REQUIRE_CFO'), num(cell(r, 'FINAL_AMOUNT'))), subCoa: str(cell(r, 'SUB_COA')), budget: str(cell(r, 'BUDGET')), st,
          manager: aprDok.some((x) => Number(A(x, 'Level')) === LEVEL.MANAGER && upper(A(x, 'Action')) === 'APPROVED'),
        });
        if (gerbang) { hasil.gagal.push({ id, alasan: `Pembayaran diblokir: ${gerbang}` }); continue; }
        if (!etagCocok(it.etag, etagOf(r))) { hasil.gagal.push({ id, alasan: 'Dokumen berubah sejak dibuka. Muat ulang.' }); continue; }
        const logDok = log.filter((x) => str(Y(x, 'ID_Trx')).toUpperCase() === id);
        const kembar = logDok.some((x) => num(Y(x, 'Nominal')) === it.nominal && serialToYmd(Y(x, 'Tgl_Bayar')) === input.tglBayar && (str(Y(x, 'Ref_No')) || '-') === ref
          && now - fromSheetSerial(num(Y(x, 'Timestamp'))) < JENDELA_DUPLIKAT_MS);
        if (kembar && !input.konfirmasiDuplikat) { hasil.gagal.push({ id, duplikat: true, alasan: 'Pembayaran yang sama (tanggal, nominal, ref) baru saja dicatat. Konfirmasi bila memang pembayaran terpisah.' }); continue; }
        const h = hitungBayar(num(cell(r, 'FINAL_AMOUNT')), logDok.reduce((t, x) => t + num(Y(x, 'Nominal')), 0), it.nominal, CONFIG.PAYMENT_TOLERANCE);
        if (!h.ok) { hasil.gagal.push({ id, alasan: h.alasan }); continue; }
        const ke = h.lunas ? STATUS.PAID : STATUS.PARTIALLY_PAID;
        const tr = checkTransition(dari, ke);
        if (tr) { hasil.gagal.push({ id, alasan: tr }); continue; }
        const rangkap = tugasRangkapBayar(s.email, st);
        const penanda = rangkap.length ? `[Penanda SoD O5b: pembayar = ${rangkap.join(', ')}]` : '';
        const ket = `Bayar ${rupiah(it.nominal)} via ${input.sumberRekening.trim()}${ref !== '-' ? ` (Ref: ${ref})` : ''}`;
        mutations.push(
          { kind: 'append', schema: TRX_PAYMENT_LOG, cells: {
            Log_ID: `PAY-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, ID_Trx: id, Tgl_Bayar: tglSerial, Nominal: it.nominal,
            Sumber_Rekening: input.sumberRekening.trim(), Ref_No: ref, Created_By: s.email.trim(), Timestamp: nowSerial,
          } },
          { kind: 'update', schema: TRX_PENGAJUAN, row: idx[0]! + FIRST_DATA_ROW, cells: {
            LAST_PAY_DATE: tglSerial, TOTAL_PAID: h.totalBaru, OS_BALANCE: h.osBaru, PAY_STATUS: h.lunas ? 'Paid' : 'Partially Paid', STATUS: ke, LAST_UPDATE: nowSerial,
          } },
          statusChange(s, id, dari, ke, [ket, penanda].filter(Boolean).join(' · '), clock),
          auditMutation({ actor: s.email, idTrx: id, action: 'PAYMENT', field: 'Total Paid', oldValue: h.totalBaru - it.nominal, newValue: h.totalBaru, notes: [input.sumberRekening.trim(), penanda].filter(Boolean).join(' · ') }, clock),
        );
        hasil.berhasil.push({ id, nominal: it.nominal, lunas: h.lunas, sisa: h.osBaru, tugasRangkap: rangkap });
        hasil.total += it.nominal;
      }
      if (!hasil.berhasil.length) {
        const dup = hasil.gagal.some((g) => g.duplikat);
        throw new AppError(dup ? 'CONFLICT' : 'RULE_VIOLATION', `Tidak ada pembayaran yang diproses: ${hasil.gagal.map((g) => `${g.id} (${g.alasan})`).join('; ')}`, dup ? { duplikat: 'konfirmasi' } : undefined);
      }
      return { mutations, result: hasil };
    },
  });
}
