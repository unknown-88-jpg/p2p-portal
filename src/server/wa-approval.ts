export { signatureWebhookValid } from '@/infra/wa-signature';
import { can } from '@/domain/capabilities';
import { normEmail } from '@/domain/roles';
import {
  BALASAN, ALASAN_WA_MAX, DEDUP_TTL_MS, ekstrakTeks, idemKeyWA, nomorDariJid, parsePerintah, pesanTidakSegar, timestampMs,
} from '@/domain/wa';
import type { Account } from '@/domain/roles';
import { maskPhone } from '@/domain/phone';
import { Throttle, type ThrottleRule } from '@/infra/throttle';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { approve, reject, sodAktif } from './approval';
import type { AuthDeps, SessionData } from './auth';
import { bacaKode, tandaiSelesai } from './wa-kode';
import { notifPIC } from './wa-notif';
import { loadAccounts } from './users';

export interface PesanMasuk { id: string; nomor: string; teks: string; tsMs: number }
/** 10 kode salah / jam per nomor (kode 4 digit: tanpa batas ini bisa ditebak). Per-IP tak berlaku (gateway = satu IP) -> plafon longgar. */
const WA_RULE: ThrottleRule = { pair: 10, perPhone: 10, perIp: 10_000, windowMs: 60 * 60_000 };

type Baca = { skip: string } | { pesan: PesanMasuk };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Validasi sinkron & murah payload yang SUDAH lolos tanda tangan. skip = bukan urusan kita (tetap dijawab 200 ke gateway). */
export function bacaPayload(payload: unknown): Baca {
  const p = obj(payload);
  if (p.event !== 'message.received') return { skip: 'bukan message.received' };
  const m = obj(p.message), key = obj(m.key);
  if (key.fromMe === true) return { skip: 'pesan sendiri' };
  const id = typeof key.id === 'string' ? key.id : '';
  if (!id || id.length > 128) return { skip: 'tanpa id pesan' };
  const nomor = nomorDariJid(key.remoteJid);
  if (!nomor) return { skip: 'pengirim bukan <nomor>@s.whatsapp.net' };
  const teks = ekstrakTeks(m.message);
  if (!teks) return { skip: 'tanpa teks' };
  return { pesan: { id, nomor, teks, tsMs: timestampMs(m.messageTimestamp ?? p.timestamp) } };
}

async function deadLetter(d: AuthDeps, p: PesanMasuk, e: unknown): Promise<void> {
  logger.error('wa_dead_letter', { id: p.id, from: maskPhone(p.nomor), err: (e as Error).message });
  try {
    await d.redis.set(`wa:dlq:${p.id}`, JSON.stringify({ at: d.clock.now(), from: maskPhone(p.nomor), err: (e as Error).message.slice(0, 200) }), { pxMs: DEDUP_TTL_MS });
    await d.redis.incr('wa:dlq:count');
  } catch { /* log sudah ditulis */ }
}

/** Satu balasan WA. Mengembalikan teks balasan ('' = diam). Melempar hanya untuk galat tak terduga. */
async function tanggapi(d: AuthDeps, acc: Account, p: PesanMasuk, sod: boolean): Promise<string> {
  const cmd = parsePerintah(p.teks);
  if (cmd.jenis === 'OTP') return BALASAN.otpLama;
  if (cmd.jenis === 'TIDAK_DIKENAL') return BALASAN.formatSalah;
  if (cmd.jenis === 'TOLAK_TANPA_ALASAN') return BALASAN.tolakTanpaAlasan(cmd.kode);
  if (cmd.jenis === 'TOLAK' && cmd.alasan.length > ALASAN_WA_MAX) return BALASAN.alasanTerlalu;

  const th = new Throttle(d.redis, d.clock, 'wa', WA_RULE);
  try { await th.assertOpen(acc.phone, 'wa'); } catch (e) { if (e instanceof AppError && e.code === 'RATE_LIMITED') return BALASAN.terlaluBanyakSalah; throw e; }

  const rec = await bacaKode(d, acc.phone, cmd.kode);
  if (!rec || normEmail(rec.email) !== normEmail(acc.email)) { await th.recordFailure(acc.phone, 'wa'); return BALASAN.kodeTidakAda(cmd.kode); }
  if (rec.status === 'DONE') return BALASAN.kodeDipakai(cmd.kode);
  if (!can(acc.roles, 'approve.manager')) return BALASAN.bukanManager;

  const s: SessionData = { phone: acc.phone, email: acc.email, nama: acc.nama, jabatan: acc.jabatan, roles: acc.roles, created: 0, ep: 0 };
  const idem = idemKeyWA(p.id);
  try {
    if (cmd.jenis === 'SETUJU') await approve(d, s, '', rec.idTrx, { etag: rec.etag }, idem, sod, 'wa');
    else await reject(d, s, rec.idTrx, { etag: rec.etag, alasan: cmd.alasan }, idem, 'wa');
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    switch (e.code) {
      case 'CONFLICT': return `Dokumen ${rec.idTrx} sudah berubah atau sudah diproses sejak ringkasan dikirim. Cek di portal: ${d.baseUrl.replace(/\/+$/, '')}/persetujuan?id=${encodeURIComponent(rec.idTrx)}`;
      case 'NOT_FOUND': return `Dokumen ${rec.idTrx} tidak ditemukan atau Anda tidak berwenang atasnya.`;
      case 'FORBIDDEN': case 'RULE_VIOLATION': case 'VALIDATION': return e.message;
      case 'UPSTREAM_BUSY': case 'READ_ONLY': return BALASAN.sibuk;
      default: throw e;
    }
  }
  await tandaiSelesai(d, acc.phone, cmd.kode, rec).catch((e: Error) => logger.warn('wa_kode_tandai_gagal', { err: e.message }));
  // Notif ke PIC SETELAH commit; tidak menggagalkan apa pun (I15).
  await notifPIC(d, cmd.jenis === 'SETUJU' ? { idTrx: rec.idTrx, jenis: 'disetujui', catatan: 'Disetujui via WhatsApp' } : { idTrx: rec.idTrx, jenis: 'dikembalikan', catatan: cmd.alasan });
  return cmd.jenis === 'SETUJU' ? BALASAN.disetujui(rec.idTrx) : BALASAN.dikembalikan(rec.idTrx);
}

/**
 * Pekerjaan inti satu pesan (dijalankan SETELAH 200 dikirim ke gateway). Urutan:
 * dedup message.key.id (anti-replay) -> umur pesan -> pengirim terdaftar & aktif -> perintah. Setiap perintah dibalas.
 * Pengirim tak dikenal: DIAM (tidak membalas nomor asing; tidak jadi oracle/spam).
 */
export async function prosesPesan(d: AuthDeps, p: PesanMasuk, sod = sodAktif()): Promise<void> {
  try {
    if (!(await d.redis.setNx(`wa:m:${p.id}`, '1', DEDUP_TTL_MS))) { logger.info('wa_dup_dropped', { id: p.id }); return; }
    if (pesanTidakSegar(p.tsMs, d.clock.now())) { logger.warn('wa_stale_dropped', { id: p.id, from: maskPhone(p.nomor) }); return; }
    const acc = (await loadAccounts(d.store)).get(p.nomor);
    if (!acc || !acc.aktif) { logger.warn('wa_unknown_sender', { from: maskPhone(p.nomor) }); return; }
    const balas = await tanggapi(d, acc, p, sod);
    if (balas) { const r = await d.wa.send(p.nomor, balas); if (!r.ok) logger.warn('wa_reply_failed', { id: p.id, info: r.info }); }
  } catch (e) {
    if (e instanceof AppError && (e.code === 'UPSTREAM_BUSY' || e.code === 'READ_ONLY')) { await d.wa.send(p.nomor, BALASAN.sibuk); return; }
    await deadLetter(d, p, e);
    await d.wa.send(p.nomor, BALASAN.gagalUmum);
  }
}
