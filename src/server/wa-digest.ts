import { can } from '@/domain/capabilities';
import { bolehApproveViaWA } from '@/domain/config';
import { cekWewenang } from '@/domain/approval';
import { cekSoD } from '@/domain/approval';
import { str, num, upper } from '@/domain/legacy-parse';
import { maskPhone } from '@/domain/phone';
import { DIGEST_MAKS_ITEM, pesanDigest, type ItemDigest } from '@/domain/wa';
import { STATUS } from '@/domain/status';
import { logger } from '@/lib/logger';
import { TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { etagOf, sodAktif } from './approval';
import type { AuthDeps } from './auth';
import { loadAccounts } from './users';
import { terbitkanKode } from './wa-kode';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);

export interface HasilDigest { dokumen: number; manager: number; terkirim: number; gagal: number; dilewati?: string }

/**
 * Digest approval (port kirimDigestApproval): satu ringkasan per Manager berwenang. Dokumen < Rp 5 jt dapat kode SETUJU/TOLAK;
 * >= Rp 5 jt hanya link ke web (D9). Pembuat dokumen tidak menerima kode untuk dokumennya sendiri bila SoD aktif.
 * Digest hanya MENGINFORMASIKAN (status tak berubah karena digest); kegagalan kirim tidak melempar (I15).
 * Kunci 4 menit mencegah dua pemicu cron yang berdempetan mengirim ganda.
 */
export async function kirimDigestManager(d: AuthDeps, o: { sod?: boolean; force?: boolean } = {}): Promise<HasilDigest> {
  const sod = o.sod ?? sodAktif();
  if (!o.force && !(await d.redis.setNx('wa:digest:lock', String(d.clock.now()), 4 * 60_000))) return { dokumen: 0, manager: 0, terkirim: 0, gagal: 0, dilewati: 'digest lain baru saja berjalan' };

  const rows = await d.store.readRows(TRX_PENGAJUAN);
  const docs = rows.filter((r) => str(r[T('ID_TRX')]) && str(r[T('STATUS')]) === STATUS.SUBMITTED);
  if (!docs.length) return { dokumen: 0, manager: 0, terkirim: 0, gagal: 0, dilewati: 'tidak ada dokumen menunggu' };

  const accounts = [...(await loadAccounts(d.store)).values()].filter((a) => a.aktif && a.phone && can(a.roles, 'approve.manager'));
  const perMgr = new Map<string, { acc: (typeof accounts)[number]; items: ItemDigest[]; sisa: number }>();
  const base = d.baseUrl.replace(/\/+$/, '');

  for (const r of docs) {
    const brand = str(r[T('BRAND')]), dept = str(r[T('DEPARTEMENT')]);
    const nominal = num(r[T('FINAL_AMOUNT')]);
    const id = str(r[T('ID_TRX')]);
    for (const acc of accounts) {
      if (cekWewenang(acc.roles, { brand, dept })) continue;
      if (!cekSoD(str(r[T('CREATED_BY')]), acc.email, sod).ok) continue; // pembuat tidak diminta menyetujui dokumennya sendiri
      let g = perMgr.get(acc.phone);
      if (!g) perMgr.set(acc.phone, (g = { acc, items: [], sisa: 0 }));
      if (g.items.length >= DIGEST_MAKS_ITEM) { g.sisa++; continue; }
      const kode = bolehApproveViaWA(nominal) ? await terbitkanKode(d, { phone: acc.phone, email: acc.email, idTrx: id, etag: etagOf(r) }) : null;
      g.items.push({ idTrx: id, vendor: str(r[T('VENDOR_NAME')]), pic: str(r[T('PIC')]), nominal, perluCFO: upper(r[T('REQUIRE_CFO')]) === 'YES', kode, link: `${base}/persetujuan?id=${encodeURIComponent(id)}` });
    }
  }

  let terkirim = 0, gagal = 0;
  for (const [phone, g] of perMgr) {
    if (!g.items.length) continue;
    const res = await d.wa.send(phone, pesanDigest({ nama: g.acc.nama, items: g.items, sisa: g.sisa, linkInbox: `${base}/persetujuan` }));
    if (res.ok) terkirim++; else { gagal++; logger.warn('digest_gagal_kirim', { to: maskPhone(phone), info: res.info }); }
  }
  logger.info('digest_manager', { dokumen: docs.length, manager: perMgr.size, terkirim, gagal });
  return { dokumen: docs.length, manager: perMgr.size, terkirim, gagal };
}
