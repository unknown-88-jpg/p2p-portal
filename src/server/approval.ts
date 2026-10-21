import { createHash } from 'node:crypto';
import { can } from '@/domain/capabilities';
import {
  alasanTerkunci, butuhStepUp, milikSendiri, CATATAN_PORTAL, CATATAN_WA, PREFIX_TOLAK_WA, type Via, cekSoD, cekStatus, cekWewenang, etagCocok, kunciVersi, LABEL_L2, PREFIX_TOLAK, type Tolak,
} from '@/domain/approval';
import { bolehApproveViaWA, LEVEL } from '@/domain/config';
import { num, str, upper } from '@/domain/legacy-parse';
import { STATUS } from '@/domain/status';
import { AppError } from '@/lib/errors';
import { serialToYmd, toSheetSerial } from '@/lib/time';
import type { CellValue, Mutation, RawRow } from '@/ports/store';
import { TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { auditMutation, appendAudit } from './audit';
import { requireStepUp, type AuthDeps, type SessionData } from './auth';
import { findRowById } from './row-index';
import { bacaTampilan } from './view-cache';
import { runAction } from './uow';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const cell = (r: RawRow, k: string): CellValue => r[T(k)] ?? null;

/** O5a: default ON. Hanya nilai persis `off` yang mematikan (salah ketik = tetap ON). */
export const sodAktif = (): boolean => (process.env.SOD_APPROVER_NOT_CREATOR ?? 'on').trim().toLowerCase() !== 'off';

const gagal = (t: Tolak): never => { throw new AppError(t.code, t.message); };

/** Versi dokumen (If-Match). Hash dari nilai yang menentukan keputusan approve; dihitung server, tak pernah dipercaya dari klien. */
export function etagOf(r: RawRow): string {
  const k = kunciVersi({
    status: str(cell(r, 'STATUS')), lastUpdate: cell(r, 'LAST_UPDATE') as string | number | null, finalAmount: num(cell(r, 'FINAL_AMOUNT')),
    invAmount: num(cell(r, 'INV_AMOUNT')), diskon: num(cell(r, 'DISKON')), biayaLain: num(cell(r, 'BIAYA_LAIN')), vendorKode: str(cell(r, 'VENDOR_CODE')),
    noInvoice: str(cell(r, 'NO_INVOICE')), tipe: str(cell(r, 'TIPE')), poNumber: str(cell(r, 'PO_NUMBER')), statusPPN: str(cell(r, 'STATUS_PPN')),
    fileAda: !!str(cell(r, 'FILE_URL')),
  });
  return createHash('sha256').update(k).digest('base64url').slice(0, 22);
}

function assertManager(s: SessionData): void {
  if (!can(s.roles, 'approve.manager')) throw new AppError('FORBIDDEN', 'Akun Anda bukan Manager (Level 2).');
}

function itemOf(r: RawRow, s: SessionData, sod: boolean) {
  const nominal = num(cell(r, 'FINAL_AMOUNT'));
  return {
    id: str(cell(r, 'ID_TRX')), tanggal: serialToYmd(cell(r, 'TIMESTAMP')), company: str(cell(r, 'COMPANY')), brand: str(cell(r, 'BRAND')),
    departement: str(cell(r, 'DEPARTEMENT')), tipe: str(cell(r, 'TIPE')), pic: str(cell(r, 'PIC')), description: str(cell(r, 'DESCRIPTION')),
    eventProject: str(cell(r, 'EVENT_PROJECT')), notesUser: str(cell(r, 'NOTES_USER')), poNumber: str(cell(r, 'PO_NUMBER')),
    vendorNama: str(cell(r, 'VENDOR_NAME')), noInvoice: str(cell(r, 'NO_INVOICE')), dateInvoice: serialToYmd(cell(r, 'DATE_INVOICE')),
    dueDate: serialToYmd(cell(r, 'DUE_DATE')), jenisPembayaran: str(cell(r, 'JENIS_PEMBAYARAN')), invoiceAmount: num(cell(r, 'INV_AMOUNT')),
    diskon: num(cell(r, 'DISKON')), biayaLainnya: num(cell(r, 'BIAYA_LAIN')), statusPPN: str(cell(r, 'STATUS_PPN')), dpp: num(cell(r, 'DPP')),
    ppnAmount: num(cell(r, 'PPN_AMOUNT')), nominal, perluCFO: upper(cell(r, 'REQUIRE_CFO')) === 'YES', punyaLampiran: !!str(cell(r, 'FILE_URL')),
    etag: etagOf(r), butuhStepUp: butuhStepUp(nominal),
    // Hanya tampilan; penjaga sebenarnya di approve(). Email pembuat TIDAK dikirim ke klien.
    terkunci: alasanTerkunci(str(cell(r, 'CREATED_BY')), s.email, sod),
  };
}

/** Antrean Manager: status Submitted & berwenang atas brand/dept, tertua dulu (urutan baris = urutan submit/buat). */
export async function inbox(d: AuthDeps, s: SessionData, sod = sodAktif()) {
  assertManager(s);
  const rows = await bacaTampilan(d, TRX_PENGAJUAN); // tampilan saja; approve() selalu baca segar & cek etag
  // Dokumen buatan sendiri tidak masuk antrean (M8 F-05); tetap ada di "Pengajuan saya". Penjaga SoD sebenarnya tetap di approve().
  return rows
    .filter((r) => str(cell(r, 'ID_TRX')) && str(cell(r, 'STATUS')) === STATUS.SUBMITTED && !milikSendiri(str(cell(r, 'CREATED_BY')), s.email) && !cekWewenang(s.roles, { brand: str(cell(r, 'BRAND')), dept: str(cell(r, 'DEPARTEMENT')) }))
    .map((r) => itemOf(r, s, sod))
    .slice(0, 200);
}

interface InputAksi { etag: string; notes?: string | undefined; alasan?: string }
const idemOf = (k: string | undefined): { idempotencyKey?: string } => (k ? { idempotencyKey: k } : {});
const approvalRow = (idTrx: string, s: SessionData, action: 'APPROVED' | 'REJECTED', notes: string, now: number, via: Via = 'web'): Mutation => ({
  kind: 'append', schema: TRX_APPROVAL, cells: {
    ID_Approval: `APR-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, ID_Trx: idTrx, Level: LEVEL.MANAGER, Role_Label: LABEL_L2,
    Approver_Name: s.nama, Approver_Email: s.email.trim(), Jabatan: s.jabatan, Method: via === 'wa' ? 'WA' : 'E-SIGN', Action: action, Timestamp: now,
    Notes: `${notes} ${via === 'wa' ? CATATAN_WA : CATATAN_PORTAL}`.trim(), Signature_URL: '',
  },
});

/** Urutan penjagaan (semua di dalam lock, dari baca segar): wewenang -> status (I3) -> etag -> [approve] SoD -> step-up. */
export async function approve(d: AuthDeps, s: SessionData, token: string, idTrx: string, input: InputAksi, idemKey: string | undefined, sod = sodAktif(), via: Via = 'web') {
  assertManager(s);
  return runAction(d, {
    name: 'approval.approve', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: [`trx:${idTrx}`],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
      const r = f.data;
      const tolak = cekWewenang(s.roles, { brand: str(cell(r, 'BRAND')), dept: str(cell(r, 'DEPARTEMENT')) }) ?? cekStatus('approve', str(cell(r, 'STATUS')));
      if (tolak) gagal(tolak);
      if (!etagCocok(input.etag, etagOf(r))) throw new AppError('CONFLICT', 'Dokumen berubah sejak Anda membukanya. Muat ulang lalu periksa lagi.');
      const so = cekSoD(str(cell(r, 'CREATED_BY')), s.email, sod);
      if (!so.ok) {
        // Percobaan ditolak SoD dicatat (bukan di dalam batch ini karena batch tidak berjalan). Best-effort: kegagalan audit tidak mengubah penolakan.
        await appendAudit(store, clock, { actor: s.email || s.phone, idTrx, action: 'APPROVAL_BLOCKED_SOD', field: 'Level 2', newValue: 'BLOCKED', notes: 'Approver = pembuat dokumen' }).catch(() => undefined);
        return gagal(so.tolak);
      }
      const nominal = num(cell(r, 'FINAL_AMOUNT'));
      // WA (D9/I14): nominal >= ambang TIDAK boleh lewat WA, dihitung dari nominal TERSIMPAN. Web: step-up password.
      if (via === 'wa') {
        if (!bolehApproveViaWA(nominal)) throw new AppError('RULE_VIOLATION', 'Nominal ≥ Rp 5.000.000 harus disetujui lewat web (dengan konfirmasi password).');
      } else if (butuhStepUp(nominal)) await requireStepUp(d, token);

      const notes = input.notes ?? '';
      const now = toSheetSerial(clock.now());
      const catatan = [notes, so.penanda].filter(Boolean).join(' · ');
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { STATUS: STATUS.MANAGER_APPROVED, LAST_UPDATE: now } },
        approvalRow(idTrx, s, 'APPROVED', notes, now, via),
        auditMutation({ actor: s.email, idTrx, action: 'STATUS_CHANGE', field: 'Status', oldValue: STATUS.SUBMITTED, newValue: STATUS.MANAGER_APPROVED, notes: catatan }, clock),
        auditMutation({ actor: s.email, idTrx, action: 'APPROVAL', field: via === 'wa' ? 'Level 2 (WA)' : 'Level 2 (Portal-HP)', newValue: 'APPROVED', notes: catatan }, clock),
      ];
      return { mutations, result: { id: idTrx, status: STATUS.MANAGER_APPROVED as string, finalAmount: nominal, perluCFO: upper(cell(r, 'REQUIRE_CFO')) === 'YES' } };
    },
  });
}

/** Tolak = kembalikan ke PIC (Revision Needed), alasan wajib. Tanpa step-up & tanpa SoD: aksi ini tidak melepaskan uang. */
export async function reject(d: AuthDeps, s: SessionData, idTrx: string, input: InputAksi, idemKey: string | undefined, via: Via = 'web') {
  assertManager(s);
  const alasan = (input.alasan ?? '').trim();
  if (!alasan) throw new AppError('VALIDATION', 'Alasan penolakan wajib diisi.');
  return runAction(d, {
    name: 'approval.reject', actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: [`trx:${idTrx}`],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
      if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
      const r = f.data;
      const tolak = cekWewenang(s.roles, { brand: str(cell(r, 'BRAND')), dept: str(cell(r, 'DEPARTEMENT')) }) ?? cekStatus('reject', str(cell(r, 'STATUS')));
      if (tolak) gagal(tolak);
      if (!etagCocok(input.etag, etagOf(r))) throw new AppError('CONFLICT', 'Dokumen berubah sejak Anda membukanya. Muat ulang lalu periksa lagi.');
      const now = toSheetSerial(clock.now());
      const mutations: Mutation[] = [
        { kind: 'update', schema: TRX_PENGAJUAN, row: f.row, cells: { STATUS: STATUS.REVISION, LAST_UPDATE: now, NOTES_FINANCE: (via === 'wa' ? PREFIX_TOLAK_WA : PREFIX_TOLAK) + alasan } },
        approvalRow(idTrx, s, 'REJECTED', alasan, now, via),
        auditMutation({ actor: s.email, idTrx, action: 'STATUS_CHANGE', field: 'Status', oldValue: STATUS.SUBMITTED, newValue: STATUS.REVISION, notes: alasan }, clock),
        auditMutation({ actor: s.email, idTrx, action: 'APPROVAL', field: via === 'wa' ? 'Level 2 (WA)' : 'Level 2 (Portal-HP)', newValue: 'REJECTED', notes: alasan }, clock),
      ];
      return { mutations, result: { id: idTrx, status: STATUS.REVISION as string } };
    },
  });
}
