import { createHash, randomBytes } from 'node:crypto';
import {
  auditIntegritas, rencanaNolRekening, rencanaRekonsiliasi, validasiMaster, validasiUser, type IsianUser, type Temuan, type UbahSel,
} from '@/domain/admin';
import { kandidatArsip } from '@/domain/backup';
import { can } from '@/domain/capabilities';
import { LEVEL } from '@/domain/config';
import { str } from '@/domain/legacy-parse';
import { maskPhone, normalizePhone } from '@/domain/phone';
import { isAktif, parseLevel } from '@/domain/roles';
import { SETPASS_TTL_MS } from '@/infra/link-tokens';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { wibDate } from '@/lib/time';
import { FIRST_DATA_ROW, type Mutation, type RawRow } from '@/ports/store';
import { DB_PO, DB_SJ, MASTER_COA, MASTER_PPH, MASTER_SETTING, MASTER_USER_TTD, MASTER_VENDOR, TRX_PAYMENT_LOG, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { appendAudit, auditMutation } from './audit';
import { requireStepUp, setPasswordLink, type AuthDeps, type SessionData } from './auth';
import { keObjek } from './export-odoo';
import { runAction } from './uow';

function wajibAdmin(s: SessionData): void {
  if (!can(s.roles, 'admin.manage')) throw new AppError('FORBIDDEN', 'Hanya System Admin (Level 9).');
}
const idemOf = (k: string | undefined): { idempotencyKey?: string } => (k ? { idempotencyKey: k } : {});
const U = (r: RawRow, k: string): unknown => r[colIndex(MASTER_USER_TTD, k)];
const hash22 = (s: string): string => createHash('sha256').update(s).digest('base64url').slice(0, 22);

// ---------------------------------------------------------------- user

/** etag baris user = hash isi baris (termasuk ada/tidaknya password, TANPA nilai hash-nya keluar). Baris salah / berubah -> etag beda -> 409. */
export const etagUser = (r: RawRow): string => hash22(JSON.stringify(r.map((v) => v ?? '')));

export interface BarisUser { row: number; etag: string; brand: string; dept: string; level: number; jabatan: string; nama: string; email: string; aktif: boolean; noHp: string; punyaPassword: boolean }

/** Daftar Master_User_TTD (SEGAR). Hash/salt TIDAK PERNAH keluar; hanya penanda punya password. */
export async function daftarUser(d: AuthDeps, s: SessionData): Promise<BarisUser[]> {
  wajibAdmin(s);
  const rows = await d.store.readRows(MASTER_USER_TTD);
  const out: BarisUser[] = [];
  rows.forEach((r, i) => {
    if (r.every((v) => v === null || v === '')) return;
    out.push({
      row: i + FIRST_DATA_ROW, etag: etagUser(r), brand: str(U(r, 'Brand')), dept: str(U(r, 'Departement')), level: parseLevel(U(r, 'Level')),
      jabatan: str(U(r, 'Jabatan')), nama: str(U(r, 'Nama')), email: str(U(r, 'Email')), aktif: isAktif(U(r, 'Aktif')), noHp: normalizePhone(U(r, 'No_HP')) || str(U(r, 'No_HP')),
      punyaPassword: !!str(U(r, 'Password_Hash')),
    });
  });
  return out.reverse(); // baris terbaru (paling bawah di sheet) dulu
}

/** Jumlah System Admin aktif (bernomor HP sah) SESUDAH perubahan diterapkan. */
function adminAktifSesudah(rows: readonly RawRow[], row: number | null, baru: { level: number; aktif: boolean; phone: string }): number {
  const adm = (level: unknown, aktif: unknown, hp: unknown): boolean => parseLevel(level) === LEVEL.ADMIN && isAktif(aktif) && !!normalizePhone(hp);
  const lain = rows.filter((r, i) => i + FIRST_DATA_ROW !== row && adm(U(r, 'Level'), U(r, 'Aktif'), U(r, 'No_HP'))).length;
  return lain + (adm(baru.level, baru.aktif ? 'YES' : 'NO', baru.phone) ? 1 : 0);
}

/**
 * Tambah / ubah satu baris Master_User_TTD (form admin; menggantikan edit manual di Sheet). Wajib step-up password.
 * Ubah = nomor baris + etag dari daftar (diverifikasi dari baca SEGAR di dalam lock: baris lain / berubah -> 409).
 * Password: nomor yang sudah punya password di baris lain -> hash/salt disalin (aturan lama: identik di semua baris nomor itu);
 * nomor baru -> kosong (kirim link set-password). Sesi nomor lama & baru dicabut (peran di sesi harus segar).
 * Tidak boleh menyisakan nol System Admin aktif.
 */
export async function simpanUser(d: AuthDeps, s: SessionData, token: string, input: IsianUser & { row?: number; etag?: string }, idemKey?: string) {
  wajibAdmin(s);
  await requireStepUp(d, token);
  const val = validasiUser(input);
  if (!val.ok) throw new AppError('VALIDATION', Object.values(val.galat)[0]!, val.galat);
  const v = val.v;
  const ubah = input.row !== undefined;
  if (ubah && !input.etag) throw new AppError('VALIDATION', 'etag wajib untuk mengubah user.');
  // Nomor lama hanya PETUNJUK untuk kunci; kebenarannya dicek lewat etag di dalam lock.
  const lama = ubah ? await d.store.readRow(MASTER_USER_TTD, input.row!) : null;
  const hpLama = lama ? normalizePhone(U(lama, 'No_HP')) : '';
  const res = await runAction(d, {
    name: ubah ? 'admin.user.ubah' : 'admin.user.tambah', actor: s.email || s.phone, ...idemOf(idemKey),
    lockKeys: ['admin:users', `user:${v.phone}`, ...(hpLama ? [`user:${hpLama}`] : [])],
    execute: async ({ store, clock }) => {
      const rows = await store.readRows(MASTER_USER_TTD);
      let sebelum: RawRow | null = null;
      if (ubah) {
        sebelum = rows[input.row! - FIRST_DATA_ROW] ?? null;
        if (!sebelum || etagUser(sebelum) !== input.etag) throw new AppError('CONFLICT', 'Data user berubah sejak daftar dimuat. Muat ulang lalu ulangi.');
        if (normalizePhone(U(sebelum, 'No_HP')) !== hpLama) throw new AppError('CONFLICT', 'Data user berubah sejak daftar dimuat. Muat ulang lalu ulangi.');
      }
      const duplikat = rows.findIndex((r, i) => i + FIRST_DATA_ROW !== input.row && normalizePhone(U(r, 'No_HP')) === v.phone
        && str(U(r, 'Brand')).toUpperCase() === v.brand && str(U(r, 'Departement')).toUpperCase() === v.dept && parseLevel(U(r, 'Level')) === v.level);
      if (duplikat >= 0) throw new AppError('RULE_VIOLATION', `Nomor ini sudah punya peran yang sama (baris ${duplikat + FIRST_DATA_ROW}).`);
      if (adminAktifSesudah(rows, ubah ? input.row! : null, v) === 0) throw new AppError('RULE_VIOLATION', 'Perubahan ini menyisakan nol System Admin aktif. Tambahkan admin lain dulu.');

      // Password ikut nomor: salin dari baris lain milik nomor yang sama; nomor tetap -> pertahankan.
      const kembar = rows.find((r, i) => i + FIRST_DATA_ROW !== input.row && normalizePhone(U(r, 'No_HP')) === v.phone && str(U(r, 'Password_Hash')));
      const tetap = sebelum && hpLama === v.phone;
      const pw = kembar ? { h: str(U(kembar, 'Password_Hash')), s: str(U(kembar, 'Password_Salt')) }
        : tetap ? { h: str(U(sebelum!, 'Password_Hash')), s: str(U(sebelum!, 'Password_Salt')) } : { h: '', s: '' };
      const cells = {
        Brand: v.brand, Departement: v.dept, Level: v.level, Jabatan: v.jabatan, Nama: v.nama, Email: v.email, Aktif: v.aktif ? 'YES' : 'NO',
        No_HP: v.phone, Password_Hash: pw.h, Password_Salt: pw.s,
      };
      const ringkas = (x: { brand: unknown; dept: unknown; level: unknown; aktif: unknown; hp: string }): string => `${str(x.brand)}/${str(x.dept)} L${parseLevel(x.level)} ${isAktif(x.aktif) ? 'aktif' : 'nonaktif'} ${maskPhone(x.hp)}`;
      const m: Mutation[] = [
        ubah ? { kind: 'update', schema: MASTER_USER_TTD, row: input.row!, cells } : { kind: 'append', schema: MASTER_USER_TTD, cells },
        auditMutation({
          actor: s.email || s.phone, action: ubah ? 'USER_UPDATE' : 'USER_CREATE', field: ubah ? `Master_User_TTD baris ${input.row}` : 'Master_User_TTD',
          oldValue: sebelum ? ringkas({ brand: U(sebelum, 'Brand'), dept: U(sebelum, 'Departement'), level: U(sebelum, 'Level'), aktif: U(sebelum, 'Aktif'), hp: hpLama }) : '',
          newValue: ringkas({ brand: v.brand, dept: v.dept, level: v.level, aktif: v.aktif ? 'YES' : 'NO', hp: v.phone }), notes: `${v.nama}${pw.h ? '' : ' (belum punya password)'}`,
        }, clock),
      ];
      return { mutations: m, result: { ok: true, perluPassword: !pw.h, phone: v.phone } };
    },
  });
  for (const p of new Set([hpLama, v.phone].filter(Boolean))) await d.sessions.revokeAll(p).catch((e: unknown) => logger.error('revoke_failed', { err: (e as Error).message }));
  return res;
}

async function akunAktif(d: AuthDeps, phoneInput: string): Promise<{ phone: string; nama: string }> {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new AppError('VALIDATION', 'Nomor HP tidak valid.');
  const rows = (await d.store.readRows(MASTER_USER_TTD)).filter((r) => normalizePhone(U(r, 'No_HP')) === phone);
  if (!rows.length) throw new AppError('NOT_FOUND', 'Nomor HP tidak ditemukan di Master_User_TTD.');
  if (!rows.some((r) => isAktif(U(r, 'Aktif')))) throw new AppError('RULE_VIOLATION', 'Semua baris untuk nomor ini nonaktif.');
  return { phone, nama: str(U(rows[0]!, 'Nama')) };
}

/** Kirim link set-password ke WA user (pengganti kirimLinkSetPasswordApprover dari menu admin). Link tidak dikembalikan ke admin. */
export async function kirimLinkPassword(d: AuthDeps, s: SessionData, noHp: string): Promise<{ terkirim: true; nama: string }> {
  wajibAdmin(s);
  const a = await akunAktif(d, noHp);
  const t = await d.tokens.issue(a.phone);
  await d.sender.sendSetPasswordLink(a.phone, a.nama, setPasswordLink(d, t), SETPASS_TTL_MS / 60_000);
  await appendAudit(d.store, d.clock, { actor: s.email || s.phone, action: 'ISSUE_SETPASS_LINK', field: 'Auth', newValue: maskPhone(a.phone), notes: 'admin' });
  return { terkirim: true, nama: a.nama };
}

/** Paksa logout: cabut semua sesi nomor ini. */
export async function paksaLogout(d: AuthDeps, s: SessionData, noHp: string): Promise<{ ok: true }> {
  wajibAdmin(s);
  const phone = normalizePhone(noHp);
  if (!phone) throw new AppError('VALIDATION', 'Nomor HP tidak valid.');
  await d.sessions.revokeAll(phone);
  await appendAudit(d.store, d.clock, { actor: s.email || s.phone, action: 'FORCE_LOGOUT', field: 'Auth', newValue: maskPhone(phone) });
  return { ok: true };
}

// ---------------------------------------------------------------- master & health

export async function cekMaster(d: AuthDeps, s: SessionData): Promise<{ jumlah: Record<string, number>; temuan: Temuan[] }> {
  wajibAdmin(s);
  const [setting, coa, pph] = await Promise.all([d.store.readRows(MASTER_SETTING), d.store.readRows(MASTER_COA), d.store.readRows(MASTER_PPH)]);
  const isi = (rows: RawRow[]): number => rows.filter((r) => r.some((v) => v !== null && v !== '')).length;
  return { jumlah: { Master_Setting: isi(setting), Master_COA: isi(coa), Master_PPh: isi(pph) }, temuan: validasiMaster({ setting, coa, pph }) };
}

export async function cekIntegritas(d: AuthDeps, s: SessionData): Promise<Temuan[]> {
  wajibAdmin(s);
  const [peng, vendor, bayar, po, sj, setting, users] = await Promise.all([
    d.store.readRows(TRX_PENGAJUAN), d.store.readRows(MASTER_VENDOR), d.store.readRows(TRX_PAYMENT_LOG),
    d.store.readColumn(DB_PO, 'PO'), d.store.readColumn(DB_SJ, 'PO_ID'), d.store.readRows(MASTER_SETTING), d.store.readRows(MASTER_USER_TTD),
  ]);
  return auditIntegritas({
    pengajuan: peng.map((r) => keObjek(TRX_PENGAJUAN, r)), vendor: vendor.map((r) => keObjek(MASTER_VENDOR, r)), pembayaran: bayar.map((r) => keObjek(TRX_PAYMENT_LOG, r)),
    poIds: po.map(str), sjPoRefs: sj.map(str), prefixes: setting.map((r) => str(r[4])), users: users.map((r) => keObjek(MASTER_USER_TTD, r)),
  });
}

/** F3-E: dokumen yang memenuhi syarat arsip (O10: Paid > 18 bulan). BACA SAJA — pemindahan menunggu keputusan (lihat README §F3-E). */
export async function cekArsip(d: AuthDeps, s: SessionData) {
  wajibAdmin(s);
  const rows = await d.store.readRows(TRX_PENGAJUAN);
  return { jumlahBaris: rows.length, ...kandidatArsip(rows.map((r) => keObjek(TRX_PENGAJUAN, r)), wibDate(d.clock.now())) };
}

/** Penanda cron terakhir jalan (dibaca halaman health). Gagal dicatat tidak pernah menggagalkan cron. */
export async function catatCron(d: Pick<AuthDeps, 'redis' | 'clock'>, nama: string, hasil: 'ok' | 'gagal' | 'dilewati'): Promise<void> {
  try { await d.redis.set(`cron:last:${nama}`, JSON.stringify({ at: d.clock.now(), hasil }), { pxMs: 30 * 86_400_000 }); }
  catch (e) { logger.error('cron_mark_failed', { err: (e as Error).message }); }
}
export const CRON_DIPANTAU = ['digest', 'lampiran-yatim', 'backup'] as const;

/** Status terakhir tiap cron yang dipantau (Redis). Tidak pernah melempar. */
export async function bacaCron(d: Pick<AuthDeps, 'redis'>): Promise<{ nama: string; at: number | null; hasil: string }[]> {
  return Promise.all(CRON_DIPANTAU.map(async (nama) => {
    try { const raw = await d.redis.get(`cron:last:${nama}`); const v = raw ? (JSON.parse(raw) as { at: number; hasil: string }) : null; return { nama, at: v?.at ?? null, hasil: v?.hasil ?? 'belum pernah' }; }
    catch { return { nama, at: null, hasil: 'tidak terbaca' }; }
  }));
}

export interface Koneksi { nama: string; ok: boolean; info: string; ms: number }
export async function cekKoneksi(d: AuthDeps, s: SessionData, extra: { waTerkonfigurasi: boolean }): Promise<{ koneksi: Koneksi[]; cron: { nama: string; at: number | null; hasil: string }[] }> {
  wajibAdmin(s);
  const uji = async (nama: string, fn: () => Promise<string>): Promise<Koneksi> => {
    const t0 = d.clock.now();
    try { return { nama, ok: true, info: await fn(), ms: d.clock.now() - t0 }; }
    catch (e) { return { nama, ok: false, info: e instanceof AppError ? e.message : 'gagal', ms: d.clock.now() - t0 }; }
  };
  const koneksi = await Promise.all([
    uji('Redis', async () => { const k = `health:${randomBytes(4).toString('hex')}`; await d.redis.set(k, '1', { pxMs: 10_000 }); if ((await d.redis.get(k)) !== '1') throw new AppError('UPSTREAM_BUSY', 'baca ulang tidak cocok'); return 'tulis + baca OK'; }),
    uji('Sheets', async () => `${(await d.store.readColumn(MASTER_USER_TTD, 'Nama')).length} baris Master_User_TTD`),
    uji('Drive', async () => { const m = await d.drive.getMeta(d.drive.folderId); if (!m) throw new AppError('NOT_FOUND', 'folder tidak terlihat'); return `folder "${m.name}"`; }),
    uji('WhatsApp', async () => { if (!extra.waTerkonfigurasi) throw new AppError('UPSTREAM_BUSY', 'gateway belum dikonfigurasi (link dikirim lewat jalur dev)'); return 'gateway terkonfigurasi'; }),
  ]);
  return { koneksi, cron: await bacaCron(d) };
}

// ---------------------------------------------------------------- repair (snapshot -> konfirmasi -> eksekusi -> laporan)

export const JENIS_REPAIR = ['rekonsiliasi', 'nol-rekening'] as const;
export type JenisRepair = (typeof JENIS_REPAIR)[number];
export const REPAIR_MAKS = 100;
const PRATINJAU_TTL_MS = 15 * 60_000;

async function rencana(store: AuthDeps['store'], jenis: JenisRepair): Promise<{ ubah: UbahSel[]; lebihBayar: string[] }> {
  const peng = (await store.readRows(TRX_PENGAJUAN)).map((r, i) => ({ ...keObjek(TRX_PENGAJUAN, r), _row: i + FIRST_DATA_ROW }));
  if (jenis === 'rekonsiliasi') return rencanaRekonsiliasi(peng, (await store.readRows(TRX_PAYMENT_LOG)).map((r) => keObjek(TRX_PAYMENT_LOG, r)));
  return { ...rencanaNolRekening(peng, (await store.readRows(MASTER_VENDOR)).map((r) => keObjek(MASTER_VENDOR, r))), lebihBayar: [] };
}
const sidikUbah = (u: readonly UbahSel[]): string => hash22(JSON.stringify(u));

export interface Pratinjau { token: string; jenis: JenisRepair; total: number; ubah: UbahSel[]; lebihBayar: string[]; dibatasi: boolean }

/** Langkah 1-2: hitung rencana dari baca segar, simpan snapshot (sidik rencana) di Redis 15 menit, tampilkan ke admin untuk dikonfirmasi. */
export async function pratinjauRepair(d: AuthDeps, s: SessionData, jenis: JenisRepair): Promise<Pratinjau> {
  wajibAdmin(s);
  const r = await rencana(d.store, jenis);
  const ubah = r.ubah.slice(0, REPAIR_MAKS);
  const token = randomBytes(18).toString('base64url');
  await d.redis.set(`repair:${token}`, JSON.stringify({ jenis, actor: s.email || s.phone, sidik: sidikUbah(ubah) }), { pxMs: PRATINJAU_TTL_MS });
  return { token, jenis, total: r.ubah.length, ubah, lebihBayar: r.lebihBayar, dibatasi: r.ubah.length > REPAIR_MAKS };
}

/**
 * Langkah 3-4: eksekusi rencana yang SAMA PERSIS dengan pratinjau (dihitung ulang dari baca segar di dalam lock `trx:{id}` semua baris
 * terdampak; beda -> 409 "pratinjau ulang"). Satu batch: perubahan + audit REPAIR ringkasan + audit per baris berisi nilai sebelum/sesudah
 * (snapshot untuk rollback manual). Wajib step-up password. Maks. 100 baris per eksekusi.
 */
export async function jalankanRepair(d: AuthDeps, s: SessionData, sessToken: string, token: string, idemKey?: string) {
  wajibAdmin(s);
  await requireStepUp(d, sessToken);
  const raw = await d.redis.get(`repair:${token}`);
  if (!raw) throw new AppError('CONFLICT', 'Pratinjau kedaluwarsa. Buat pratinjau ulang.');
  const snap = JSON.parse(raw) as { jenis: JenisRepair; actor: string; sidik: string };
  if (snap.actor !== (s.email || s.phone)) throw new AppError('FORBIDDEN', 'Pratinjau ini milik admin lain.');
  const awal = await rencana(d.store, snap.jenis);
  const ids = awal.ubah.slice(0, REPAIR_MAKS).map((u) => u.id);
  if (!ids.length) throw new AppError('RULE_VIOLATION', 'Tidak ada yang perlu diperbaiki.');
  const hasil = await runAction(d, {
    name: `admin.repair.${snap.jenis}`, actor: s.email || s.phone, money: true, ...idemOf(idemKey), lockKeys: ['admin:repair', ...ids.map((id) => `trx:${id}`)],
    execute: async ({ store, clock }) => {
      const r = await rencana(store, snap.jenis);
      const ubah = r.ubah.slice(0, REPAIR_MAKS);
      if (sidikUbah(ubah) !== snap.sidik) throw new AppError('CONFLICT', 'Data berubah sejak pratinjau. Buat pratinjau ulang lalu periksa lagi.');
      const actor = s.email || s.phone;
      const m: Mutation[] = [
        ...ubah.map((u): Mutation => ({ kind: 'update', schema: TRX_PENGAJUAN, row: u.row, cells: u.cells })),
        auditMutation({ actor, action: 'REPAIR', field: snap.jenis, newValue: `${ubah.length} baris`, notes: r.lebihBayar.length ? `kelebihan bayar: ${r.lebihBayar.join(', ')}` : '' }, clock),
        ...ubah.map((u) => auditMutation({ actor, idTrx: u.id, action: 'REPAIR_ROW', field: snap.jenis, oldValue: JSON.stringify(u.sebelum), newValue: JSON.stringify(u.cells) }, clock)),
      ];
      return { mutations: m, result: { jenis: snap.jenis, diperbaiki: ubah.length, sisa: Math.max(0, r.ubah.length - ubah.length), lebihBayar: r.lebihBayar, ids: ubah.map((u) => u.id) } };
    },
  });
  await d.redis.del(`repair:${token}`).catch(() => undefined);
  return hasil;
}
