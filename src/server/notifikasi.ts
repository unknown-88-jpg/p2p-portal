import { can } from '@/domain/capabilities';
import { LEVEL } from '@/domain/config';
import { cronBermasalah, susunNotifikasi, type SumberNotif } from '@/domain/notifikasi';
import { logger } from '@/lib/logger';
import { bacaCron } from './admin';
import type { AuthDeps, SessionData } from './auth';
import { dashboard } from './dokumen';
import { antreanFinance } from './finance';
import { antreanVendor } from './vendor';

/** Sumber yang gagal dibaca dilewati (lonceng = hiasan; tidak boleh merusak halaman). */
const aman = async <T>(nama: string, fn: () => Promise<T>): Promise<T | undefined> => {
  try { return await fn(); } catch (e) { logger.warn('notif_sumber_gagal', { nama, err: (e as Error).message }); return undefined; }
};

/**
 * Lonceng "perlu tindakan" untuk semua peran. Semua bacaan lewat cache tampilan (15 dtk) — tidak menambah pola baca per-sel.
 * Hanya yang bisa ditindak pengguna INI: pajak tanpa ajuan sendiri (I6), CFO hanya setelah Fin. Mgr, bayar yang lolos gerbang I4, vendor bukan daftaran sendiri.
 */
export async function notifikasiSaya(d: AuthDeps, s: SessionData) {
  const src: SumberNotif = {};
  const r = s.roles;
  const pic = can(r, 'pengajuan.write'), mgr = r.some((x) => x.level === LEVEL.MANAGER);
  if (pic || mgr) {
    const db = await aman('dashboard', () => dashboard(d, s));
    if (db && pic) src.pic = { revisi: db.pic.revisi, draft: db.pic.draft };
    if (db?.manager) src.manager = { antrean: db.manager.antrean };
  }
  if (can(r, 'finance.view')) {
    const q = await aman('finance', () => antreanFinance(d, s));
    if (q) {
      const di = (t: string) => q.items.filter((i) => i.tahap === t);
      src.finance = {
        ...(q.peran.staff ? { pajak: di('pajak').filter((i) => !i.ajuanSendiri).length, jurnal: di('jurnal').length, bayar: di('bayar').filter((i) => !i.blokirBayar).length } : {}),
        ...(q.peran.finMgr ? { persetujuanFinMgr: di('persetujuan').filter((i) => !i.persetujuan?.finMgr).length } : {}),
        ...(q.peran.cfo ? { persetujuanCfo: di('persetujuan').filter((i) => i.perluCFO && i.persetujuan?.finMgr && !i.persetujuan.cfo && !i.persetujuan.finMgrSaya).length } : {}),
      };
    }
  }
  if (can(r, 'vendor.approve')) {
    const v = await aman('vendor', () => antreanVendor(d, s));
    if (v) src.vendor = { menunggu: v.filter((x) => !x.milikSaya).length };
  }
  if (can(r, 'admin.manage')) src.admin = { cronBermasalah: cronBermasalah(await bacaCron(d), d.clock.now()) };
  return susunNotifikasi(src);
}
