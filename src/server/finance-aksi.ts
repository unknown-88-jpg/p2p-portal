import { can } from '@/domain/capabilities';
import { etagCocok, milikSendiri, PREFIX_TOLAK_FINANCE } from '@/domain/approval';
import { butuhCFO, LEVEL } from '@/domain/config';
import { LEVEL_LABEL } from '@/domain/dokumen';
import { RuleError } from '@/domain/errors';
import { PESAN_I6, STATUS_BOLEH_KEMBALI_FINANCE } from '@/domain/finance';
import { num, str, upper } from '@/domain/legacy-parse';
import { rupiah } from '@/domain/pengajuan-form';
import { checkTransition, STATUS } from '@/domain/status';
import { hitungPajak } from '@/domain/tax';
import { AppError } from '@/lib/errors';
import { toSheetSerial } from '@/lib/time';
import type { Clock } from '@/lib/clock';
import type { CellValue, Mutation, RawRow } from '@/ports/store';
import { TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { z } from 'zod';
import { etagOf } from './approval';
import { appendAudit, auditMutation } from './audit';
import type { AuthDeps, SessionData } from './auth';
import type { kembalikanFinanceSchema, verifikasiPajakSchema } from './finance-schema';
import { readPph } from './master-read';
import { findRowById } from './row-index';
import { runAction } from './uow';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const cell = (r: RawRow, k: string): CellValue => r[T(k)] ?? null;
const idemOf = (k: string | undefined): { idempotencyKey?: string } => (k ? { idempotencyKey: k } : {});
const CONFLICT = 'Dokumen berubah sejak Anda membukanya. Muat ulang lalu periksa lagi.';

function approvalL3(idTrx: string, s: SessionData, action: 'APPROVED' | 'REJECTED', notes: string, now: number): Mutation {
  return {
    kind: 'append', schema: TRX_APPROVAL, cells: {
      ID_Approval: `APR-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, ID_Trx: idTrx, Level: LEVEL.FINANCE_STAFF, Role_Label: LEVEL_LABEL[LEVEL.FINANCE_STAFF]!,
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
  if (!can(s.roles, 'tax.verify')) throw new AppError('FORBIDDEN', 'Hanya Finance Staff yang bisa mengembalikan dokumen ke PIC.');
  const alasan = input.alasan.trim();
  return runAction(d, {
    name: 'finance.kembalikan', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: [`trx:${idTrx}`],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
      const r = f.data, dari = str(cell(r, 'STATUS'));
      if (!(STATUS_BOLEH_KEMBALI_FINANCE as readonly string[]).includes(dari)) throw new AppError('CONFLICT', `Dokumen ini tidak sedang di tahap Finance (status: ${dari || '-'}). Muat ulang daftar.`);
      const tr = checkTransition(dari, STATUS.REVISION);
      if (tr) throw new AppError('RULE_VIOLATION', tr);
      if (!etagCocok(input.etag, etagOf(r))) throw new AppError('CONFLICT', CONFLICT);
      const now = toSheetSerial(clock.now());
      return {
        mutations: [
          { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { STATUS: STATUS.REVISION, LAST_UPDATE: now, NOTES_FINANCE: PREFIX_TOLAK_FINANCE + alasan } },
          approvalL3(idTrx, s, 'REJECTED', alasan, now),
          statusChange(s, idTrx, dari, STATUS.REVISION, alasan, clock),
        ],
        result: { id: idTrx, status: STATUS.REVISION as string },
      };
    },
  });
}
