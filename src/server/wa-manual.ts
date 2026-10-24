import { normEmail } from '@/domain/roles';
import { str } from '@/domain/legacy-parse';
import { maskPhone } from '@/domain/phone';
import { pesanPengingatPIC } from '@/domain/wa';
import { STATUS } from '@/domain/status';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { endOfWibDay, wibDate } from '@/lib/time';
import { TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { sodAktif } from './approval';
import { appendAudit } from './audit';
import type { AuthDeps, SessionData } from './auth';
import { findRowById } from './row-index';
import { itemPerManager } from './wa-digest';

const T = (k: string): number => colIndex(TRX_PENGAJUAN, k);
const kunciHarian = (idTrx: string, ymd: string): string => `wa:manual:${idTrx}:${ymd}`;
const sisaHariMs = (now: number): number => Math.max(endOfWibDay(wibDate(now)) - now + 1, 1_000);

export interface HasilKirimWa { manager: number; terkirim: number }

/** Sudah dikirim manual hari ini (WIB)? Untuk tampilan tombol; penjaga sebenarnya tetap `setNx` di `kirimWaManual`. */
export async function sudahKirimHariIni(d: Pick<AuthDeps, 'redis' | 'clock'>, ids: readonly string[]): Promise<Set<string>> {
  const ymd = wibDate(d.clock.now());
  const hasil = new Set<string>();
  for (const id of ids) if (await d.redis.get(kunciHarian(id, ymd))) hasil.add(id);
  return hasil;
}

/**
 * F-15: PIC mengirim pengingat WA ke Manager berwenang untuk dokumennya sendiri yang berstatus Menunggu Manager.
 * Maks. 1x per hari kalender WIB per dokumen (kunci Redis ber-TTL sampai tengah malam WIB). Penerima & kode SETUJU/TOLAK
 * memakai aturan yang sama dengan digest (`itemPerManager`: wewenang brand/dept, SoD, kode hanya < Rp 5 jt).
 * Bukan dokumen sendiri / tidak ada = 404 (tidak membocorkan keberadaan ID). Gagal kirim ke semua Manager = jatah hari itu dikembalikan.
 */
export async function kirimWaManual(d: AuthDeps, s: SessionData, idTrx: string, sod = sodAktif()): Promise<HasilKirimWa> {
  const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  if (!f || !normEmail(s.email) || normEmail(str(f.data[T('CREATED_BY')])) !== normEmail(s.email)) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
  if (str(f.data[T('STATUS')]) !== STATUS.SUBMITTED) throw new AppError('RULE_VIOLATION', 'Pengingat WA hanya untuk dokumen yang sedang menunggu persetujuan Manager.');

  const now = d.clock.now();
  const kunci = kunciHarian(idTrx, wibDate(now));
  const sisa = sisaHariMs(now);
  if (!(await d.redis.setNx(kunci, String(now), sisa))) {
    throw new AppError('RATE_LIMITED', 'Pengingat WA untuk dokumen ini sudah dikirim hari ini. Bisa dikirim lagi besok.', undefined, Math.ceil(sisa / 1000));
  }
  try {
    const grup = [...(await itemPerManager(d, [f.data], sod)).entries()].filter(([, g]) => g.items.length);
    if (!grup.length) throw new AppError('RULE_VIOLATION', 'Tidak ada Manager dengan nomor WA aktif yang berwenang atas dokumen ini.');
    const base = d.baseUrl.replace(/\/+$/, '');
    let terkirim = 0;
    for (const [phone, g] of grup) {
      const r = await d.wa.send(phone, pesanPengingatPIC({ nama: g.acc.nama, pengirim: s.nama, item: g.items[0]!, linkInbox: `${base}/persetujuan` }));
      if (r.ok) terkirim++; else logger.warn('wa_manual_gagal_kirim', { idTrx, to: maskPhone(phone), info: r.info });
    }
    if (!terkirim) throw new AppError('UPSTREAM_BUSY', 'WhatsApp belum bisa dikirim. Coba lagi beberapa saat lagi.', undefined, 60);
    await appendAudit(d.store, d.clock, { actor: s.email, idTrx, action: 'WA_REMINDER_MANUAL', field: 'Level 2', newValue: `${terkirim}/${grup.length}`, notes: 'Pengingat WA ke Manager dikirim PIC' })
      .catch((e: Error) => logger.warn('wa_manual_audit_gagal', { idTrx, err: e.message })); // WA sudah terkirim: audit gagal tidak membatalkan (I15)
    logger.info('wa_manual', { idTrx, manager: grup.length, terkirim });
    return { manager: grup.length, terkirim };
  } catch (e) {
    await d.redis.del(kunci).catch(() => undefined); // tidak ada yang terkirim -> jatah hari ini dikembalikan
    throw e;
  }
}
