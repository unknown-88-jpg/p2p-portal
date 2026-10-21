import { maskPhone } from '@/domain/phone';
import { AppError } from '@/lib/errors';
import type { LinkSender } from '@/ports/link-sender';

/** HANYA trial/dev: mencetak link ke stdout server (bukan ke logger berredaksi). Di production menolak -> pasang pengirim WA (M6). */
export class DevLinkSender implements LinkSender {
  constructor(private appEnv: 'trial' | 'production') {}
  async sendSetPasswordLink(phone: string, _nama: string, link: string): Promise<void> {
    if (this.appEnv === 'production') throw new AppError('INTERNAL', 'Pengirim link belum dikonfigurasi.');
    console.log(`[DEV-LINK] set-password untuk ${maskPhone(phone)}: ${link}`);
  }
}
