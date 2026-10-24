// Logika murni WhatsApp (M6): parsing balasan, validasi pengirim & umur pesan, penyusun pesan. Tanpa I/O.
import { normalizePhone } from './phone';
import { rupiah } from './pengajuan-form';

export const KODE_TTL_MS = 3 * 86_400_000;       // = aturan bersihkanWAPending lama (WAITING > 3 hari -> kedaluwarsa)
export const DEDUP_TTL_MS = 7 * 86_400_000;      // dedup message.key.id (gateway tanpa anti-replay)
export const PESAN_MAKS_UMUR_MS = 10 * 60_000;   // perintah SETUJU/TOLAK lebih tua dari ini ditolak
export const PESAN_MAKS_MASA_DEPAN_MS = 2 * 60_000;
export const DIGEST_MAKS_ITEM = 12;
export const ALASAN_WA_MAX = 300;

export type Perintah =
  | { jenis: 'SETUJU'; kode: string }
  | { jenis: 'TOLAK'; kode: string; alasan: string }
  | { jenis: 'OTP' }
  | { jenis: 'TOLAK_TANPA_ALASAN'; kode: string }
  | { jenis: 'TIDAK_DIKENAL' };

/**
 * Persis regex lama: SETUJU|TOLAK|APPROVE|REJECT + 4 digit. 6 digit murni (OTP lama) dikenali agar bisa dijawab "sudah tidak dipakai".
 * F-14: penanda format WhatsApp (`*tebal*`, `_miring_`, `~coret~`) di sekitar perintah/kode diabaikan, karena menyalin teks tebal dari
 * balasan bot ikut membawa tanda bintang ("*SETUJU 2641*"). Penanda di DALAM alasan tidak diubah.
 */
const FMT = '[\\s*_~]';
// (?![0-9A-Z]) menggantikan \\b: `_` termasuk karakter kata, jadi "2641_" (penutup miring) tidak akan lolos dengan \\b. Teks sudah di-uppercase.
const RE_PERINTAH = new RegExp(`^${FMT}*(SETUJU|TOLAK|APPROVE|REJECT)${FMT}+(\\d{4})(?![0-9A-Z])`);
const RE_AWAL_TOLAK = new RegExp(`^${FMT}*(TOLAK|REJECT)${FMT}+\\d{4}${FMT}*`, 'i');
export function parsePerintah(teks: string): Perintah {
  const t = teks.trim();
  if (/^\d{6}$/.test(t)) return { jenis: 'OTP' };
  const m = t.toUpperCase().match(RE_PERINTAH);
  if (!m) return { jenis: 'TIDAK_DIKENAL' };
  const kode = m[2]!;
  if (m[1] === 'SETUJU' || m[1] === 'APPROVE') return { jenis: 'SETUJU', kode };
  const alasan = t.replace(RE_AWAL_TOLAK, '').replace(/[\s*_~]+$/, '').trim();
  return alasan.length >= 3 ? { jenis: 'TOLAK', kode, alasan } : { jenis: 'TOLAK_TANPA_ALASAN', kode };
}

/** Teks dari objek message Baileys (sama dengan ekstrakTeksWA_ lama). */
export function ekstrakTeks(m: unknown): string {
  const o = (m ?? {}) as Record<string, { text?: unknown; caption?: unknown; selectedButtonId?: unknown } | string | undefined>;
  if (typeof o.conversation === 'string' && o.conversation) return o.conversation.trim();
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const ext = o.extendedTextMessage as { text?: unknown } | undefined;
  if (ext && pick(ext.text)) return pick(ext.text);
  const img = o.imageMessage as { caption?: unknown } | undefined;
  if (img && pick(img.caption)) return pick(img.caption);
  const btn = o.buttonsResponseMessage as { selectedButtonId?: unknown } | undefined;
  if (btn && pick(btn.selectedButtonId)) return pick(btn.selectedButtonId);
  return '';
}

/** Hanya `<digit>@s.whatsapp.net` (S6: @lid & lainnya fail-closed). Mengembalikan nomor ternormalisasi atau ''. */
export function nomorDariJid(jid: unknown): string {
  const m = typeof jid === 'string' ? /^(\d{8,16})@s\.whatsapp\.net$/.exec(jid) : null;
  return m ? normalizePhone(m[1]) : '';
}

/** Epoch detik (angka atau string angka) -> ms; selain itu NaN. Timestamp ada di body yang ikut ditandatangani. */
export function timestampMs(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{9,13}$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n > 1e12 ? n : n * 1000; // jaga-jaga bila sudah ms
}
/** true = tolak (tak terbaca, terlalu tua, atau dari masa depan). */
export function pesanTidakSegar(tsMs: number, nowMs: number): boolean {
  if (!Number.isFinite(tsMs)) return true;
  return nowMs - tsMs > PESAN_MAKS_UMUR_MS || tsMs - nowMs > PESAN_MAKS_MASA_DEPAN_MS;
}

export const idemKeyWA = (messageId: string): string => `wa-${messageId.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

// ------------------------------------------------------------------ penyusun pesan
export interface ItemDigest { idTrx: string; vendor: string; pic: string; nominal: number; perluCFO: boolean; kode: string | null; link: string }

/** Dokumen >= ambang tidak diberi kode (D9): hanya ringkasan + link web. */
const barisItem = (it: ItemDigest, i: number): string =>
  `${i + 1}. *${it.idTrx}* · ${it.vendor || '—'}\n   ${rupiah(it.nominal)}${it.perluCFO ? ' ⚠️CFO' : ''} · PIC ${it.pic}\n` +
  (it.kode ? `   Balas *SETUJU ${it.kode}* / *TOLAK ${it.kode} <alasan>*` : `   Nominal besar: setujui di web\n   ${it.link}`);

/** Jadwal digest otomatis ke Manager (WIB, hari kerja). HARUS sama dengan cron `.github/workflows/digest.yml` (dijaga test). */
export const JADWAL_DIGEST_WIB = ['09.00', '12.00', '15.00', '17.00'] as const;
export const JADWAL_DIGEST_TEKS = `${JADWAL_DIGEST_WIB.join(', ')} WIB (Senin–Jumat)`;

/** F-15: pengingat yang dikirim PIC lewat tombol "Kirim WA" (maks. 1x/hari/dokumen). Isi item sama dengan digest (kode hanya < Rp 5 jt). */
export function pesanPengingatPIC(p: { nama: string; pengirim: string; item: ItemDigest; linkInbox: string }): string {
  return `🔔 *Pengingat persetujuan*\nHalo ${p.nama || 'Manager'}, ${p.pengirim || 'PIC'} meminta persetujuan untuk pengajuan berikut:\n\n${barisItem(p.item, 0)}` +
    (p.item.kode ? '' : '\n\n_Dokumen ≥ Rp 5.000.000 hanya bisa disetujui lewat web (dengan konfirmasi password)._') +
    `\n\n_Buka portal: ${p.linkInbox}_`;
}

export function pesanDigest(p: { nama: string; items: readonly ItemDigest[]; sisa: number; linkInbox: string }): string {
  const baris = p.items.map(barisItem).join('\n\n');
  const total = p.items.length + p.sisa;
  const adaBesar = p.items.some((i) => !i.kode);
  return `📋 *Ringkasan Approval*\nHalo ${p.nama || 'Manager'}, ada *${total}* pengajuan menunggu persetujuan Anda:\n\n${baris}` +
    (p.sisa > 0 ? `\n\n…dan ${p.sisa} lainnya, buka portal.` : '') +
    (adaBesar ? '\n\n_Dokumen ≥ Rp 5.000.000 hanya bisa disetujui lewat web (dengan konfirmasi password)._' : '') +
    `\n\n_Buka portal: ${p.linkInbox}_`;
}

export const pesanPICDisetujui = (idTrx: string, catatan: string, link: string): string =>
  `✅ *Pengajuan disetujui Manager*\n\nDokumen *${idTrx}* sudah disetujui dan diteruskan ke Finance.\n` + (catatan ? `🗒️ Catatan: ${catatan}\n` : '') + `\nLihat status: ${link}`;
export const pesanPICDikembalikan = (idTrx: string, alasan: string, link: string): string =>
  `↩️ *Pengajuan dikembalikan untuk revisi*\n\nDokumen *${idTrx}* dikembalikan oleh Manager.\n❗ Alasan: ${alasan}\n\nPerbaiki lalu ajukan ulang di sini:\n${link}`;
export const pesanLinkPassword = (nama: string, link: string, ttlMenit: number): string =>
  `🔐 Halo ${nama || ''}, ini link untuk mengatur password P2P Finance (berlaku ${ttlMenit} menit, sekali pakai):\n${link}\n\nJangan bagikan link ini ke siapa pun.`.replace('Halo ,', 'Halo,');

export const BALASAN = {
  formatSalah: 'Format tidak dikenali. Balas *SETUJU <kode>* atau *TOLAK <kode> <alasan>*.',
  otpLama: 'OTP email sudah tidak dipakai. Dokumen ≥ Rp 5.000.000 disetujui lewat web (konfirmasi password). Di bawah itu balas *SETUJU <kode>*.',
  tolakTanpaAlasan: (k: string) => `Untuk menolak, sertakan alasan (min. 3 huruf): *TOLAK ${k} <alasan>*.`,
  kodeTidakAda: (k: string) => `Kode ${k} tidak ditemukan atau sudah kedaluwarsa.`,
  kodeDipakai: (k: string) => `Kode ${k} sudah dipakai sebelumnya.`,
  terlaluBanyakSalah: 'Terlalu banyak kode salah. Coba lagi nanti atau gunakan portal web.',
  bukanManager: 'Akun Anda bukan Manager (Level 2), jadi tidak bisa menyetujui lewat WhatsApp.',
  alasanTerlalu: `Alasan terlalu panjang (maks ${ALASAN_WA_MAX} karakter).`,
  sibuk: 'Sistem sedang sibuk, pesan Anda belum diproses. Kirim ulang sebentar lagi.',
  gagalUmum: 'Terjadi kesalahan saat memproses. Silakan gunakan portal web.',
  disetujui: (id: string) => `✅ *${id}* berhasil disetujui via WhatsApp. Terima kasih.`,
  dikembalikan: (id: string) => `↩️ *${id}* dikembalikan ke PIC. Alasan tercatat.`,
} as const;
