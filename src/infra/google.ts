import { JWT } from 'google-auth-library';
import { env } from '@/lib/env';
import { checkSheetAllowed } from '@/lib/trial-guard';
import { AppError } from '@/lib/errors';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
const CALL_TIMEOUT_MS = 9_000; // design 4.3: timeout keras per panggilan Google 8–10 dtk

let client: JWT | null = null;
function getClient(): JWT {
  if (client) return client; // memoize murah; boleh hilang kapan saja (tidak ada state bisnis di memori)
  const c = JSON.parse(env().GOOGLE_SA_JSON) as { client_email: string; private_key: string };
  client = new JWT({ email: c.client_email, key: c.private_key, scopes: SCOPES });
  return client;
}

/** fetch ke Google dengan token + timeout keras. Error jaringan/timeout DILEMPAR APA ADANYA (dipakai SheetsStore yang membedakan baca vs tulis). */
export async function gfetchRaw(url: string, init: RequestInit = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<Response> {
  const t = await getClient().getAccessToken();
  if (!t.token) throw new AppError('UPSTREAM_BUSY', 'Gagal mengambil token Google.');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${t.token}`);
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

export async function gfetch(url: string, init: RequestInit = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<Response> {
  try {
    return await gfetchRaw(url, init, timeoutMs);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('UPSTREAM_BUSY', 'Google tidak merespons tepat waktu.', undefined, 3);
  }
}

/** Baca satu baris header per tab dalam SATU request (batchGet). Tab yang tidak ada -> null. */
export async function readHeaderRows(tabs: readonly string[]): Promise<Record<string, unknown[] | null>> {
  const id = env().SHEET_ID;
  const qs = tabs.map((t) => `ranges=${encodeURIComponent(`'${t}'!1:1`)}`).join('&');
  const r = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${qs}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  if (r.status === 400) {
    // Salah satu tab tidak ada -> bacakan satu-satu agar laporan tetap rinci.
    const out: Record<string, unknown[] | null> = {};
    for (const t of tabs) {
      const rr = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${t}'!1:1`)}`);
      out[t] = rr.ok ? (((await rr.json()) as { values?: unknown[][] }).values?.[0] ?? []) : null;
    }
    return out;
  }
  if (!r.ok) throw new AppError('UPSTREAM_BUSY', `Sheets ${r.status}`);
  const j = (await r.json()) as { valueRanges: { values?: unknown[][] }[] };
  const out: Record<string, unknown[] | null> = {};
  tabs.forEach((t, i) => { out[t] = j.valueRanges[i]?.values?.[0] ?? []; });
  return out;
}

let titleOk = false;
/** D6: tolak spreadsheet non-DUMMY saat trial. Dicek sekali per instance. */
export async function assertSheetAllowed(): Promise<void> {
  if (titleOk) return;
  const e = env();
  const r = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${e.SHEET_ID}?fields=properties.title`);
  if (!r.ok) throw new AppError('UPSTREAM_BUSY', `Sheets ${r.status}`);
  const title = ((await r.json()) as { properties?: { title?: string } }).properties?.title ?? '';
  const why = checkSheetAllowed({ appEnv: e.APP_ENV, sheetId: e.SHEET_ID, title, prodSheetIds: e.PROD_SHEET_IDS });
  if (why) throw new AppError('FORBIDDEN', why);
  titleOk = true;
}
