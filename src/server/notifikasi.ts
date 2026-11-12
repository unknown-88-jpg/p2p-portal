import { can } from '@/domain/capabilities';
import { LEVEL } from '@/domain/config';
import { cronBermasalah, susunNotifikasi, type SumberNotif } from '@/domain/notifikasi';
import { normEmail } from '@/domain/roles';
import { logger } from '@/lib/logger';
import { MASTER_VENDOR, TRX_APPROVAL, TRX_PENGAJUAN } from '@/repo/schema';
import { bacaCron } from './admin';
import type { AuthDeps, SessionData } from './auth';
import { dashboard } from './dokumen';
import { antreanFinance } from './finance';
import { antreanVendor } from './vendor';
import { versiTab } from './view-cache';

/** Sumber yang gagal dibaca dilewati (lonceng = hiasan; tidak boleh merusak halaman). */
const aman = async <T>(nama: string, fn: () => Promise<T>, gagal?: { ada: boolean }): Promise<T | undefined> => {
  try { return await fn(); } catch (e) { if (gagal) gagal.ada = true; logger.warn('notif_sumber_gagal', { nama, err: (e as Error).message }); return undefined; }
};

/**
 * Lonceng dipanggil tiap 60 dtk oleh SETIAP tab yang terbuka; tanpa ini tiap panggilan bisa membaca 2-3 tab Sheets (cache tampilan
 * hanya per-instance) dan beberapa pengguna saja sudah menghabiskan kuota baca Google (~45/mnt) -> halaman lain "Sistem sedang padat".
 * Hasil (hanya ANGKA per pengguna, tanpa data dokumen) disimpan di Redis dan dipakai ulang selama tidak ada tulis lewat aplikasi
 * (versi tab sama) dan umurnya < NOTIF_TTL_MS. Perubahan langsung di sheet baru terlihat setelah TTL. Redis mati -> hitung langsung.
 */
export const NOTIF_TTL_MS = 3 * 60_000;
const TAB_NOTIF = [TRX_PENGAJUAN.tab, TRX_APPROVAL.tab, MASTER_VENDOR.tab] as const;
type Hasil = ReturnType<typeof susunNotifikasi>;

export async function notifikasiSaya(d: AuthDeps, s: SessionData): Promise<Hasil> {
  const kunci = `notif:${normEmail(s.email) || s.phone}`;
  let sidik: string | null = null;
  try {
    sidik = `${await versiTab(d.redis, TAB_NOTIF)}|${JSON.stringify(s.roles)}`;
    const raw = await d.redis.get(kunci);
    if (raw) {
      const c = JSON.parse(raw) as { sidik: string; at: number; v: Hasil };
      if (c.sidik === sidik && d.clock.now() - c.at < NOTIF_TTL_MS) return c.v;
    }
  } catch { sidik = null; } // Redis mati / isi rusak: hitung langsung, tanpa menyimpan
  const gagal = { ada: false };
  const v = await hitungNotifikasi(d, s, gagal);
  // Sumber gagal dibaca (angka tidak lengkap) -> jangan disimpan, panggilan berikutnya mencoba lagi.
  if (sidik !== null && !gagal.ada) await d.redis.set(kunci, JSON.stringify({ sidik, at: d.clock.now(), v }), { pxMs: NOTIF_TTL_MS }).catch(() => undefined);
  return v;
}

/**
 * Lonceng "perlu tindakan" untuk semua peran. Semua bacaan lewat cache tampilan (15 dtk) — tidak menambah pola baca per-sel.
 * Hanya yang bisa ditindak pengguna INI: pajak tanpa ajuan sendiri (I6), CFO hanya setelah Fin. Mgr, bayar yang lolos gerbang I4, vendor bukan daftaran sendiri.
 */
async function hitungNotifikasi(d: AuthDeps, s: SessionData, gagal: { ada: boolean }): Promise<Hasil> {
  const src: SumberNotif = {};
  const r = s.roles;
  const pic = can(r, 'pengajuan.write'), mgr = r.some((x) => x.level === LEVEL.MANAGER);
  if (pic || mgr) {
    const db = await aman('dashboard', () => dashboard(d, s), gagal);
    if (db && pic) src.pic = { revisi: db.pic.revisi, draft: db.pic.draft };
    if (db?.manager) src.manager = { antrean: db.manager.antrean };
  }
  if (can(r, 'finance.view')) {
    const q = await aman('finance', () => antreanFinance(d, s), gagal);
    if (q) {
      const di = (t: string) => q.items.filter((i) => i.tahap === t);
      src.finance = {
        ...(q.peran.staff ? { pajak: di('pajak').filter((i) => !i.ajuanSendiri && !(i.perluCOO && !i.persetujuan?.coo)).length, jurnal: di('jurnal').length, bayar: di('bayar').filter((i) => !i.blokirBayar).length } : {}),
        ...(q.peran.finMgr ? { persetujuanFinMgr: di('persetujuan').filter((i) => !i.persetujuan?.finMgr).length } : {}),
        ...(q.peran.coo ? { persetujuanCoo: di('pajak').filter((i) => i.perluCOO && !i.persetujuan?.coo && !i.ajuanSendiri).length } : {}),
        ...(q.peran.cfo ? { persetujuanCfo: di('persetujuan').filter((i) => i.perluCFO && i.persetujuan?.finMgr && !i.persetujuan.cfo && !i.persetujuan.finMgrSaya && !i.persetujuan.cooSaya).length } : {}),
      };
    }
  }
  if (can(r, 'vendor.approve')) {
    const v = await aman('vendor', () => antreanVendor(d, s), gagal);
    if (v) src.vendor = { menunggu: v.filter((x) => !x.milikSaya).length };
  }
  if (can(r, 'admin.manage')) src.admin = { cronBermasalah: cronBermasalah(await bacaCron(d), d.clock.now()) };
  return susunNotifikasi(src);
}
