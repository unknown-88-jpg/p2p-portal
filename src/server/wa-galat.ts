import { maskPhone } from '@/domain/phone';
import { AppError } from '@/lib/errors';
import type { WaResult } from '@/ports/wa-sender';

/**
 * Semua kiriman WA manual gagal -> pesan yang menyebut ALASAN sebenarnya (bukan "coba lagi" umum):
 * nomor di luar allowlist trial / gateway belum dikonfigurasi = masalah konfigurasi (422, tidak perlu dicoba ulang);
 * selain itu gateway/jaringan (503, coba lagi). Nomor ditampilkan tersamar.
 */
export function galatKirimWa(gagal: readonly { phone: string; r: WaResult }[], peran: string): AppError {
  if (gagal.length && gagal.every((g) => g.r.info === 'diblokir allowlist trial')) {
    return new AppError('RULE_VIOLATION', `Mode trial: nomor WA ${peran} (${gagal.map((g) => maskPhone(g.phone)).join(', ')}) belum ada di daftar izin WA_TRIAL_ALLOWLIST. Tambahkan nomornya di env Vercel lalu redeploy.`);
  }
  if (gagal.length && gagal.every((g) => g.r.info === 'WA belum dikonfigurasi')) {
    return new AppError('RULE_VIOLATION', 'Gateway WhatsApp belum dikonfigurasi (WA_GATEWAY_URL / WA_API_KEY). Hubungi admin.');
  }
  const info = [...new Set(gagal.map((g) => g.r.info))].join('; ');
  return new AppError('UPSTREAM_BUSY', `WhatsApp belum bisa dikirim${info ? ` (${info})` : ''}. Coba lagi beberapa saat lagi.`, undefined, 60);
}
