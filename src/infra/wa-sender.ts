import { normalizePhone } from '@/domain/phone';
import { maskPhone } from '@/domain/phone';
import { logger } from '@/lib/logger';
import type { WaResult, WaSender } from '@/ports/wa-sender';

export const WA_SEND_PATH = '/api/messages/send';
type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Gateway Lixus: POST {to,text}, header X-API-Key. Port kirimWA_ (Notif_WA.gs): 2xx dengan success:false = gagal. Tidak pernah melempar. */
export class LixusWaSender implements WaSender {
  constructor(private base: string, private apiKey: string, private fetchFn: FetchFn = fetch, private timeoutMs = 8_000) {}
  async send(to: string, text: string): Promise<WaResult> {
    const tujuan = normalizePhone(to);
    if (!tujuan) return { ok: false, info: 'nomor tidak valid' };
    try {
      const res = await this.fetchFn(this.base.replace(/\/+$/, '') + WA_SEND_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({ to: tujuan, text }), signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await res.text();
      if (res.ok) {
        try { const j = JSON.parse(body) as { success?: boolean }; if (j && j.success === false) return { ok: false, info: 'ditolak gateway' }; } catch { /* bukan JSON: 2xx dianggap sukses */ }
        return { ok: true, info: 'terkirim' };
      }
      const hint = res.status === 401 ? 'API key salah' : res.status === 404 ? 'endpoint salah' : res.status === 503 ? 'sesi WhatsApp gateway putus' : '';
      logger.warn('wa_send_failed', { to: maskPhone(tujuan), status: res.status, hint });
      return { ok: false, info: `HTTP ${res.status}${hint ? ` (${hint})` : ''}` };
    } catch (e) {
      logger.warn('wa_send_exception', { to: maskPhone(tujuan), err: (e as Error).message });
      return { ok: false, info: 'jaringan/timeout' };
    }
  }
}

/** Sumber izin tambahan (trial): nomor user aktif di Master_User_TTD dummy. Melempar = dianggap tidak ada izin (fail-closed). */
export type IzinTambahan = () => Promise<ReadonlySet<string>>;

/**
 * Pengaman trial (wajib): hanya kirim ke nomor di WA_TRIAL_ALLOWLIST **atau** (keputusan user 2026-10-24, opsi 1) nomor user AKTIF
 * di Master_User_TTD dummy. Gagal membaca sheet = hanya allowlist env yang berlaku. Tanpa keduanya = tidak ada yang terkirim.
 */
export class TrialAllowlistSender implements WaSender {
  private allow: Set<string>;
  constructor(private inner: WaSender, allowlistCsv: string, private tambahan?: IzinTambahan) {
    this.allow = new Set(allowlistCsv.split(',').map((s) => normalizePhone(s.trim())).filter(Boolean));
  }
  private async diizinkan(n: string): Promise<boolean> {
    if (this.allow.has(n)) return true;
    if (!this.tambahan) return false;
    try { return (await this.tambahan()).has(n); }
    catch (e) { logger.warn('wa_allowlist_sheet_gagal', { err: (e as Error).message }); return false; }
  }
  async send(to: string, text: string): Promise<WaResult> {
    const n = normalizePhone(to);
    if (!n || !(await this.diizinkan(n))) { logger.info('wa_blocked_trial_allowlist', { to: maskPhone(n || 'x') }); return { ok: false, info: 'diblokir allowlist trial' }; }
    return this.inner.send(n, text);
  }
}

/** Tanpa kredensial gateway: tidak mengirim apa pun. */
export class NullWaSender implements WaSender {
  async send(to: string): Promise<WaResult> { logger.info('wa_not_configured', { to: maskPhone(normalizePhone(to) || 'x') }); return { ok: false, info: 'WA belum dikonfigurasi' }; }
}

export function buildWaSender(e: { APP_ENV: 'trial' | 'production'; WA_GATEWAY_URL?: string | undefined; WA_API_KEY?: string | undefined; WA_TRIAL_ALLOWLIST: string }, tambahan?: IzinTambahan): WaSender {
  if (!e.WA_GATEWAY_URL || !e.WA_API_KEY) return new NullWaSender();
  const real = new LixusWaSender(e.WA_GATEWAY_URL, e.WA_API_KEY);
  return e.APP_ENV === 'trial' ? new TrialAllowlistSender(real, e.WA_TRIAL_ALLOWLIST, tambahan) : real;
}
