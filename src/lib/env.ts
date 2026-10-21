import { z } from 'zod';

const schema = z.object({
  APP_ENV: z.enum(['trial', 'production']).default('trial'),
  APP_BASE_URL: z.string().url(),
  SHEET_ID: z.string().min(10),
  PROD_SHEET_IDS: z.string().optional().default(''),
  DRIVE_ROOT_ID: z.string().min(5),
  GOOGLE_SA_JSON: z.string().min(50),
  JWT_SECRET: z.string().min(32),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10),
  WA_GATEWAY_URL: z.string().url().optional(),
  WA_API_KEY: z.string().optional(),
  WA_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** Trial: kirim WA HANYA ke nomor di daftar ini (dipisah koma). Dinegakan di lapisan kirim (M6). */
  WA_TRIAL_ALLOWLIST: z.string().optional().default(''),
  /** O5a: approver Level 2 tidak boleh sama dengan pembuat dokumen. Default ON; hanya nilai persis `off` yang mematikan (fail-safe). */
  SOD_APPROVER_NOT_CREATOR: z.enum(['on', 'off']).optional().default('on'),
  CRON_SECRET: z.string().min(16),
  HEALTH_TOKEN: z.string().min(16),
});
export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Gagal-cepat: rahasia kurang/format salah = error jelas saat start, bukan kegagalan misterius nanti. Pesan tidak memuat nilai. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Baris `KEY=` kosong (mis. hasil salin .env.example) diperlakukan sama dengan "tidak diisi",
  // supaya variabel opsional tidak gagal validasi URL/panjang minimum.
  const cleaned = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v !== undefined && v.trim() === '' ? undefined : v]));
  const r = schema.safeParse(cleaned);
  if (!r.success) {
    const bad = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Konfigurasi environment tidak valid: ${bad}`);
  }
  return r.data;
}

export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
