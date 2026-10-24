import { pesanDigestFinance, type BarisDigestFinance } from '@/domain/wa';
import { bisaLihatFinance } from '@/domain/finance';
import { maskPhone } from '@/domain/phone';
import { logger } from '@/lib/logger';
import type { AuthDeps, SessionData } from './auth';
import { antreanFinance, type AntreanFinance, type ItemFinance } from './finance';
import { loadAccounts } from './users';

export interface HasilDigestFinance { penerima: number; terkirim: number; gagal: number; dilewati?: string }

/** Antrean yang benar-benar menunggu TINDAKAN orang ini (bukan sekadar terlihat). Murni terhadap hasil antreanFinance untuk dirinya. */
export function barisUntuk(q: AntreanFinance, base: string): BarisDigestFinance[] {
  const link = (t: string) => `${base}/finance?tahap=${t}`;
  const b = (label: string, items: ItemFinance[], t: string, nilai: (i: ItemFinance) => number = (i) => i.nominal): BarisDigestFinance =>
    ({ label, jumlah: items.length, total: items.reduce((a, i) => a + nilai(i), 0), link: link(t) });
  const di = (t: string) => q.items.filter((i) => i.tahap === t);
  const out: BarisDigestFinance[] = [];
  if (q.peran.staff) {
    out.push(b('Verifikasi pajak', di('pajak').filter((i) => !i.ajuanSendiri), 'pajak')); // I6: ajuan sendiri dikerjakan rekan
    out.push(b('Jurnal COA', di('jurnal'), 'jurnal'));
    out.push(b('Siap dibayar', di('bayar').filter((i) => !i.blokirBayar), 'bayar', (i) => i.sisa));
  }
  if (q.peran.finMgr) out.push(b('Persetujuan Fin. Mgr', di('persetujuan').filter((i) => !i.persetujuan?.finMgr), 'persetujuan'));
  if (q.peran.cfo) out.push(b('Persetujuan CFO', di('persetujuan').filter((i) => i.perluCFO && i.persetujuan?.finMgr && !i.persetujuan.cfo && !i.persetujuan.finMgrSaya), 'persetujuan'));
  return out;
}

/**
 * Digest WA Finance (kirimDigestFinance lama): satu ringkasan per pengguna Finance (L3/L4/L5) yang punya antrean untuk ditindak.
 * Hanya menginformasikan; kegagalan kirim tidak melempar (I15). Kunci 4 menit mencegah pemicu ganda.
 */
export async function kirimDigestFinance(d: AuthDeps, o: { force?: boolean } = {}): Promise<HasilDigestFinance> {
  if (!o.force && !(await d.redis.setNx('wa:digest-fin:lock', String(d.clock.now()), 4 * 60_000))) return { penerima: 0, terkirim: 0, gagal: 0, dilewati: 'digest Finance lain baru saja berjalan' };
  const base = d.baseUrl.replace(/\/+$/, '');
  const akun = [...(await loadAccounts(d.store)).values()].filter((a) => a.aktif && a.phone && bisaLihatFinance(a.roles));
  let penerima = 0, terkirim = 0, gagal = 0;
  for (const a of akun) {
    const s: SessionData = { phone: a.phone, email: a.email, nama: a.nama, jabatan: '', created: 0, ep: 0, roles: a.roles };
    const baris = barisUntuk(await antreanFinance(d, s), base);
    if (!baris.some((x) => x.jumlah > 0)) continue;
    penerima++;
    const r = await d.wa.send(a.phone, pesanDigestFinance({ nama: a.nama, baris }));
    if (r.ok) terkirim++; else { gagal++; logger.warn('digest_finance_gagal_kirim', { to: maskPhone(a.phone), info: r.info }); }
  }
  logger.info('digest_finance', { penerima, terkirim, gagal });
  return { penerima, terkirim, gagal };
}
