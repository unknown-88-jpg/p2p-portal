import { normEmail } from '@/domain/roles';
import { str } from '@/domain/legacy-parse';
import { pesanPICDikembalikan, pesanPICDisetujui } from '@/domain/wa';
import { logger } from '@/lib/logger';
import { TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import type { AuthDeps } from './auth';
import { findRowById } from './row-index';
import { loadAccounts } from './users';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);

/**
 * Notif ke PIC (pembuat) setelah Manager menyetujui / mengembalikan. DIPANGGIL SETELAH transaksi commit, di luar lock (I15):
 * tidak pernah melempar; kegagalan hanya di log. Dedup per (dokumen, jenis, LAST_UPDATE) supaya replay idempotensi tidak mengirim dua kali.
 */
export async function notifPIC(d: AuthDeps, a: { idTrx: string; jenis: 'disetujui' | 'dikembalikan'; catatan?: string; oleh?: 'Manager' | 'Finance' }): Promise<void> {
  try {
    const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', a.idTrx);
    if (!f) return;
    const pembuat = normEmail(str(f.data[T('CREATED_BY')]));
    if (!pembuat) return;
    const versi = String(f.data[T('LAST_UPDATE')] ?? '');
    if (!(await d.redis.setNx(`wa:n:${a.idTrx}:${a.jenis}${a.oleh === 'Finance' ? '-fin' : ''}:${versi}`, '1', 86_400_000))) return;
    const acc = [...(await loadAccounts(d.store)).values()].find((x) => x.aktif && normEmail(x.email) === pembuat);
    if (!acc) return;
    const link = `${d.baseUrl.replace(/\/+$/, '')}/pengajuan/${encodeURIComponent(a.idTrx)}`;
    const teks = a.jenis === 'disetujui' ? pesanPICDisetujui(a.idTrx, a.catatan ?? '', link) : pesanPICDikembalikan(a.idTrx, a.catatan ?? '', link, a.oleh ?? 'Manager');
    const r = await d.wa.send(acc.phone, teks);
    if (!r.ok) logger.warn('notif_pic_gagal', { idTrx: a.idTrx, jenis: a.jenis, info: r.info });
  } catch (e) { logger.warn('notif_pic_error', { idTrx: a.idTrx, err: (e as Error).message }); }
}
