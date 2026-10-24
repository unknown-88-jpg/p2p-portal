import { can } from '@/domain/capabilities';
import { str, upper } from '@/domain/legacy-parse';
import { bangunVendor, type Vendor } from '@/domain/master';
import { bersihRekening, peringatanVendor, pendaftarSama, rekeningSama, validasiVendor, VENDOR_STATUS } from '@/domain/vendor';
import { AppError } from '@/lib/errors';
import { fmtWaktu, toSheetSerial } from '@/lib/time';
import type { CellValue, RawRow } from '@/ports/store';
import { MASTER_VENDOR, colIndex } from '@/repo/schema';
import type { z } from 'zod';
import { auditMutation } from './audit';
import type { AuthDeps, SessionData } from './auth';
import { idLockName, nextId } from './id-gen';
import { findRowById } from './row-index';
import { runAction } from './uow';
import { loadAccounts } from './users';
import { bacaTampilan } from './view-cache';
import type { daftarVendorSchema, sahkanVendorSchema } from './vendor-schema';

const V = (r: RawRow, k: string): CellValue => r[colIndex(MASTER_VENDOR, k)] ?? null;
const idemOf = (k: string | undefined): { idempotencyKey?: string } => (k ? { idempotencyKey: k } : {});
const kunciRek = (bank: string, noRek: string): string => `vendor-rek:${upper(bank)}:${bersihRekening(noRek)}`;
const wajibEmail = (s: SessionData): void => { if (!s.email.trim()) throw new AppError('FORBIDDEN', 'Akun Anda belum punya email di Master_User_TTD. Hubungi admin.'); };

/**
 * F3-A (port submitNewVendor): daftar vendor baru -> status Pending. PIC/Manager/Finance Staff/Admin.
 * Lock `seq:VND` + `vendor-rek:{bank}:{no}` (dua pendaftaran rekening sama bersamaan -> satu saja). I7 dicek dari baca SEGAR.
 * Duplikat: Finance melihat vendor mana; pendaftar lain hanya pesan umum (tidak membocorkan data vendor lain).
 */
export async function daftarVendor(d: AuthDeps, s: SessionData, input: z.infer<typeof daftarVendorSchema>, idemKey?: string) {
  if (!can(s.roles, 'vendor.register')) throw new AppError('FORBIDDEN', 'Akun Anda tidak berwenang mendaftarkan vendor.');
  wajibEmail(s);
  const val = validasiVendor(input);
  if (!val.ok) throw new AppError('VALIDATION', Object.values(val.galat)[0]!, val.galat);
  const v = val.v;
  return runAction(d, {
    name: 'vendor.daftar', actor: s.email, ...idemOf(idemKey), lockKeys: [idLockName('VND'), kunciRek(v.bank, v.noRekening)],
    execute: async ({ store, clock }) => {
      const rows = await store.readRows(MASTER_VENDOR);
      const dup = rekeningSama(rows, v.bank, v.noRekening);
      if (dup) {
        throw new AppError('RULE_VIOLATION', can(s.roles, 'vendor.approve')
          ? `Rekening ${v.bank} ${v.noRekening} sudah terdaftar atas nama "${dup.nama}" (${dup.kode}, ${dup.status}). Kalau ini vendor yang sama, pakai data yang sudah ada.`
          : `Rekening ${v.bank} ${v.noRekening} sudah terdaftar untuk vendor lain. Hubungi Finance bila ini vendor yang sama.`);
      }
      const kode = await nextId(d.redis, store, { prefix: 'VND', pad: 4, schema: MASTER_VENDOR, keyCol: 'Kode Vendor' });
      return {
        mutations: [
          { kind: 'append', schema: MASTER_VENDOR, cells: {
            'Kode Vendor': kode, 'Nama Vendor': v.nama, 'Tipe Vendor': v.tipe, NPWP: v.npwp, Bank: v.bank, 'Nama Pemilik Rekening': v.namaRekening,
            'No Rekening': v.noRekening, Status: VENDOR_STATUS.PENDING, Didaftarkan_Oleh: s.email.trim(), Tgl_Daftar: toSheetSerial(clock.now()),
          } },
          auditMutation({ actor: s.email, idTrx: kode, action: 'VENDOR_CREATE', field: 'Vendor', newValue: `${kode} ${v.nama}`, notes: `${v.bank} ${v.noRekening.slice(-4).padStart(v.noRekening.length, '*')}` }, clock),
        ],
        result: { kode, nama: v.nama, status: VENDOR_STATUS.PENDING },
      };
    },
  });
}

export interface ItemVendor { kode: string; nama: string; tipe: string; npwp: string; bank: string; namaRekening: string; noRekening: string; status: string; didaftarkanOleh: string; tglDaftar: string; milikSaya: boolean; peringatan: string[] }

/** Antrean pengesahan (getPendingVendors): hanya Finance Staff (pengesah). Rekening penuh ditampilkan karena memang harus diperiksa. */
export async function antreanVendor(d: AuthDeps, s: SessionData): Promise<ItemVendor[]> {
  if (!can(s.roles, 'vendor.approve')) throw new AppError('FORBIDDEN', 'Hanya Finance Staff yang bisa mengesahkan vendor.');
  const rows = await bacaTampilan(d, MASTER_VENDOR);
  const nama = new Map([...(await loadAccounts({ readRows: (sc) => bacaTampilan(d, sc) })).values()].map((a) => [a.email.trim().toLowerCase(), a.nama]));
  return rows.filter((r) => upper(V(r, 'Status')) === upper(VENDOR_STATUS.PENDING) && str(V(r, 'Kode Vendor'))).map((r) => {
    const v = bangunVendor(r), oleh = str(V(r, 'Didaftarkan_Oleh'));
    return { ...v, didaftarkanOleh: nama.get(oleh.toLowerCase()) ?? (oleh || '-'), tglDaftar: fmtWaktu(V(r, 'Tgl_Daftar')), milikSaya: pendaftarSama(oleh, s.email), peringatan: peringatanVendor(v, rows) };
  }).reverse(); // terbaru dulu
}

/** Vendor yang didaftarkan pengguna ini (status pendaftarannya). Rekening disamarkan. */
export async function vendorSaya(d: AuthDeps, s: SessionData) {
  if (!can(s.roles, 'vendor.register') && !can(s.roles, 'vendor.approve')) throw new AppError('FORBIDDEN', 'Akun Anda tidak berwenang.');
  return (await bacaTampilan(d, MASTER_VENDOR)).filter((r) => pendaftarSama(str(V(r, 'Didaftarkan_Oleh')), s.email)).map((r) => {
    const v = bangunVendor(r);
    return { kode: v.kode, nama: v.nama, tipe: v.tipe, bank: v.bank, noRekening: `••••${v.noRekening.slice(-4)}`, status: v.status, tglDaftar: fmtWaktu(V(r, 'Tgl_Daftar')) };
  }).reverse().slice(0, 100);
}

/**
 * Sahkan / tolak vendor BERDASARKAN KODE (R-21: bukan nomor baris). Di dalam lock dari baca segar: kode cocok, status masih Pending
 * (Rejected tidak bisa "dihidupkan"), rekening yang dilihat pengesah = rekening di sheet (sheet berubah -> 409),
 * maker-checker (pendaftar ≠ pengesah, hanya untuk mengesahkan), dan I7 diperiksa ulang saat mengesahkan.
 */
export async function putuskanVendor(d: AuthDeps, s: SessionData, kode: string, aksi: 'approve' | 'reject', input: z.infer<typeof sahkanVendorSchema> & { alasan?: string }, idemKey?: string) {
  if (!can(s.roles, 'vendor.approve')) throw new AppError('FORBIDDEN', 'Hanya Finance Staff yang bisa mengesahkan vendor.');
  wajibEmail(s);
  const k = kode.toUpperCase();
  return runAction(d, {
    name: `vendor.${aksi}`, actor: s.email, ...idemOf(idemKey), lockKeys: [`vendor:${k}`, kunciRek(input.bank, input.noRekening)],
    execute: async ({ store, clock }) => {
      const f = await findRowById(d.redis, store, MASTER_VENDOR, 'Kode Vendor', k);
      if (!f) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan.');
      const v: Vendor = bangunVendor(f.data);
      if (upper(v.status) !== upper(VENDOR_STATUS.PENDING)) throw new AppError('CONFLICT', `Vendor ${k} sudah ${v.status || 'diproses'}. Muat ulang daftar.`);
      if (upper(v.bank) !== upper(input.bank) || bersihRekening(v.noRekening) !== bersihRekening(input.noRekening)) throw new AppError('CONFLICT', 'Data rekening vendor berubah sejak Anda membukanya. Muat ulang lalu periksa lagi.');
      if (aksi === 'approve') {
        if (pendaftarSama(str(V(f.data, 'Didaftarkan_Oleh')), s.email)) throw new AppError('RULE_VIOLATION', 'Anda yang mendaftarkan vendor ini. Pengesahan harus oleh orang lain (maker-checker).');
        const dup = rekeningSama(await store.readRows(MASTER_VENDOR), v.bank, v.noRekening, k);
        if (dup) throw new AppError('RULE_VIOLATION', `Rekening ini sudah dipakai ${dup.kode} (${dup.nama}, ${dup.status}). Tolak salah satunya.`);
      }
      const baru = aksi === 'approve' ? VENDOR_STATUS.APPROVED : VENDOR_STATUS.REJECTED;
      return {
        mutations: [
          { kind: 'update', schema: MASTER_VENDOR, row: f.row, cells: { Status: baru } },
          auditMutation({ actor: s.email, idTrx: k, action: aksi === 'approve' ? 'VENDOR_APPROVE' : 'VENDOR_REJECT', field: 'Status', oldValue: VENDOR_STATUS.PENDING, newValue: baru, notes: aksi === 'approve' ? `${k} ${v.nama}` : `${k} — ${input.alasan ?? ''}` }, clock),
        ],
        result: { kode: k, nama: v.nama, status: baru },
      };
    },
  });
}
