/** Pengirim link set-password. Produksi = WhatsApp gateway (M6); trial/dev = DevLinkSender. Antarmuka sengaja tipis (bisa ditambah email OTP kelak). */
export interface LinkSender {
  sendSetPasswordLink(phone: string, nama: string, link: string, ttlMinutes: number): Promise<void>;
}
