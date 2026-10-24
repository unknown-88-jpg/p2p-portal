import { can } from '@/domain/capabilities';
import { LEVEL } from '@/domain/config';
import { siklusVerifikasi, statusPersetujuan, targetPersetujuan, wajibCFO, type BarisApproval, type Sebagai } from '@/domain/finance';
import { num, str, upper } from '@/domain/legacy-parse';
import { maskPhone } from '@/domain/phone';
import { STATUS } from '@/domain/status';
import { pesanPengingatFinance } from '@/domain/wa';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { CellValue, RawRow } from '@/ports/store';
import type { RedisPort } from '@/ports/redis';
import { TRX_APPROVAL, TRX_PENGAJUAN, colIndex } from '@/repo/schema';
import { appendAudit } from './audit';
import type { AuthDeps, SessionData } from './auth';
import { findRowById } from './row-index';
import { galatKirimWa } from './wa-galat';
import { loadAccounts } from './users';

const P = (r: RawRow, k: string): CellValue => r[colIndex(TRX_PENGAJUAN, k)] ?? null;
const A = (r: RawRow, k: string): CellValue => r[colIndex(TRX_APPROVAL, k)] ?? null;
/** Jatah WA manual: SATU kali per dokumen per tujuan (Fin. Mgr / CFO) per siklus verifikasi. Di luar digest terjadwal. */
const kunciWa = (idTrx: string, target: Sebagai, siklus: string): string => `wa:fin-manual:${idTrx}:${target}:${siklus || '-'}`;
const JATAH_TTL_MS = 120 * 86_400_000;
const LABEL: Record<Sebagai, 'Fin. Mgr' | 'CFO'> = { finmgr: 'Fin. Mgr', cfo: 'CFO' };

export const barisApproval = (rows: readonly RawRow[], idTrx: string): BarisApproval[] =>
  rows.filter((x) => upper(A(x, 'ID_Trx')) === upper(idTrx)).map((x) => ({ level: A(x, 'Level'), action: A(x, 'Action'), nama: A(x, 'Approver_Name'), email: A(x, 'Approver_Email'), timestamp: A(x, 'Timestamp') }));

/** Status tombol (tampilan): tujuan berikutnya & apakah jatah manualnya sudah terpakai. Penjaga sebenarnya `setNx` di `kirimWaFinance`. */
export async function statusWaFinance(redis: Pick<RedisPort, 'get'>, idTrx: string, perluCFO: boolean, rows: readonly BarisApproval[]): Promise<{ target: Sebagai; terkirim: boolean } | null> {
  const target = targetPersetujuan(perluCFO, statusPersetujuan(rows));
  if (!target) return null;
  let terkirim = false;
  try { terkirim = !!(await redis.get(kunciWa(idTrx, target, siklusVerifikasi(rows)))); } catch { /* tampilan saja */ }
  return { target, terkirim };
}

export interface HasilWaFinance { target: Sebagai; penerima: number; terkirim: number }

/**
 * Tombol "Kirim WA" di tahap persetujuan Finance: kirim pengingat ke penyetuju BERIKUTNYA — Fin. Mgr; setelah Fin. Mgr menyetujui
 * dan dokumen butuh CFO (I1) -> CFO (bukan orang yang sama dengan Fin. Mgr). Hanya Finance (L3/L4/L5). Status harus Tax Verified.
 * Maks. 1x per tujuan per siklus verifikasi (digest terjadwal tetap jalan terpisah). Pesan tanpa kode: persetujuan hanya lewat web + password.
 * Tidak ada yang terkirim -> jatah dikembalikan.
 */
export async function kirimWaFinance(d: AuthDeps, s: SessionData, idTrx: string): Promise<HasilWaFinance> {
  if (!can(s.roles, 'finance.view')) throw new AppError('FORBIDDEN', 'Hanya Finance yang bisa mengirim pengingat ini.');
  const f = await findRowById(d.redis, d.store, TRX_PENGAJUAN, 'ID_TRX', idTrx);
  if (!f) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
  if (str(P(f.data, 'STATUS')) !== STATUS.TAX_VERIFIED) throw new AppError('RULE_VIOLATION', 'Pengingat WA ini hanya untuk dokumen yang menunggu persetujuan Fin. Mgr / CFO.');
  const rows = barisApproval(await d.store.readRows(TRX_APPROVAL), idTrx);
  const st = statusPersetujuan(rows);
  const nominal = num(P(f.data, 'FINAL_AMOUNT'));
  const target = targetPersetujuan(wajibCFO(P(f.data, 'REQUIRE_CFO'), nominal), st);
  if (!target) throw new AppError('RULE_VIOLATION', 'Persetujuan Fin. Mgr / CFO dokumen ini sudah lengkap.');

  const kunci = kunciWa(idTrx, target, siklusVerifikasi(rows));
  if (!(await d.redis.setNx(kunci, String(d.clock.now()), JATAH_TTL_MS))) {
    throw new AppError('RATE_LIMITED', `Pengingat WA ke ${LABEL[target]} untuk dokumen ini sudah pernah dikirim. Pengingat berikutnya lewat ringkasan terjadwal.`);
  }
  try {
    const level = target === 'finmgr' ? LEVEL.FINANCE_MGR : LEVEL.CFO;
    const finMgrEmail = st.finMgr?.email.trim().toLowerCase() ?? '';
    const penerima = [...(await loadAccounts(d.store)).values()].filter((a) => a.aktif && a.phone && a.phone !== s.phone && a.roles.some((r) => r.level === level)
      && !(target === 'cfo' && finMgrEmail && a.email.trim().toLowerCase() === finMgrEmail)); // CFO ≠ Fin. Mgr yang sudah menyetujui
    if (!penerima.length) throw new AppError('RULE_VIOLATION', `Tidak ada ${LABEL[target]} lain dengan nomor WA aktif.`);
    const link = `${d.baseUrl.replace(/\/+$/, '')}/finance?tahap=persetujuan`;
    let terkirim = 0;
    const gagal: Parameters<typeof galatKirimWa>[0][number][] = [];
    for (const a of penerima) {
      const r = await d.wa.send(a.phone, pesanPengingatFinance({ nama: a.nama, pengirim: s.nama, peran: LABEL[target], id: idTrx, vendor: str(P(f.data, 'VENDOR_NAME')), nominal, finMgr: st.finMgr?.nama ?? null, link }));
      if (r.ok) terkirim++; else { gagal.push({ phone: a.phone, r }); logger.warn('wa_fin_manual_gagal_kirim', { idTrx, to: maskPhone(a.phone), info: r.info }); }
    }
    if (!terkirim) throw galatKirimWa(gagal, LABEL[target]);
    await appendAudit(d.store, d.clock, { actor: s.email || s.phone, idTrx, action: 'WA_REMINDER_MANUAL', field: target === 'finmgr' ? 'Level 4' : 'Level 5', newValue: `${terkirim}/${penerima.length}`, notes: `Pengingat WA ke ${LABEL[target]} dikirim Finance` })
      .catch((e: Error) => logger.warn('wa_fin_manual_audit_gagal', { idTrx, err: e.message })); // I15
    return { target, penerima: penerima.length, terkirim };
  } catch (e) {
    await d.redis.del(kunci).catch(() => undefined);
    throw e;
  }
}
