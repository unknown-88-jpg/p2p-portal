/** Port persis normalisasiNomorWA_ (Notif_WA.gs): hasil "62..." atau "" bila tidak masuk akal. */
export function normalizePhone(input: unknown): string {
  let s = String(input ?? '').replace(/[\s\-().]/g, '');
  if (!s) return '';
  s = s.replace(/^\+/, '');
  if (s.startsWith('0')) s = '62' + s.slice(1);
  else if (!s.startsWith('62') && s.startsWith('8')) s = '62' + s;
  s = s.replace(/\D/g, '');
  if (s.length < 10 || s.length > 16) return '';
  return s;
}

/** Untuk audit/log: 6281****1234. */
export function maskPhone(p: string): string {
  return p.length <= 6 ? '****' : `${p.slice(0, 4)}****${p.slice(-4)}`;
}
