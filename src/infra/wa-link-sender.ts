import { pesanLinkPassword } from '@/domain/wa';
import { maskPhone } from '@/domain/phone';
import { logger } from '@/lib/logger';
import type { LinkSender } from '@/ports/link-sender';
import type { WaSender } from '@/ports/wa-sender';

/** Link set-password lewat WhatsApp. Bila gagal terkirim -> `fallback` (DevLinkSender: hanya trial, menolak di production). */
export class WaLinkSender implements LinkSender {
  constructor(private wa: WaSender, private fallback: LinkSender) {}
  async sendSetPasswordLink(phone: string, nama: string, link: string, ttlMinutes: number): Promise<void> {
    const r = await this.wa.send(phone, pesanLinkPassword(nama, link, ttlMinutes));
    if (r.ok) return;
    logger.warn('setpass_wa_failed', { to: maskPhone(phone), info: r.info });
    await this.fallback.sendSetPasswordLink(phone, nama, link, ttlMinutes);
  }
}
