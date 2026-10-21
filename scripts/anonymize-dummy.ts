/**
 * Anonimkan SALINAN spreadsheet menjadi DUMMY. Menulis: (1) membekukan DB_PO/DB_SJ (IMPORTRANGE live -> nilai statis),
 * (2) kolom sensitif (RAW string). Kolom/tab lain tidak disentuh.
 *
 *   SHEET_ID=<id salinan> GOOGLE_SA_JSON='...' PROD_SHEET_IDS=<id produksi,...> npx tsx scripts/anonymize-dummy.ts --yes
 *
 * Pengaman: judul spreadsheet WAJIB mengandung DUMMY, ID tidak boleh ada di PROD_SHEET_IDS, dan perlu flag --yes.
 * Tanpa --yes = dry-run (hanya mencetak rencana). Service account harus Editor di salinan.
 */
import { JWT } from 'google-auth-library';
import { checkSheetAllowed } from '../src/lib/trial-guard';
import { Anonymizer, FREEZE_TABS, NOT_HANDLED, SHEET_ERROR, STILL_LOADING, anonymizeColumn, plan } from '../src/repo/anonymize';

const colLetter = (i: number): string => {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

async function main(): Promise<void> {
  const id = process.env.SHEET_ID, saRaw = process.env.GOOGLE_SA_JSON;
  if (!id || !saRaw) throw new Error('SHEET_ID dan GOOGLE_SA_JSON wajib diisi.');
  const sa = JSON.parse(saRaw) as { client_email: string; private_key: string };
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const t = (await jwt.getAccessToken()).token;
    return fetch(url, { ...init, headers: { ...(init.headers as object), authorization: `Bearer ${t}`, 'content-type': 'application/json' } });
  };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;

  const meta = await call(`${base}?fields=properties.title`);
  if (!meta.ok) throw new Error(`Gagal baca spreadsheet: ${meta.status}`);
  const title = ((await meta.json()) as { properties: { title: string } }).properties.title;
  // Pengaman ketat untuk skrip ini: selalu perlakukan sebagai 'trial' (tidak peduli APP_ENV).
  const why = checkSheetAllowed({ appEnv: 'trial', sheetId: id, title, prodSheetIds: process.env.PROD_SHEET_IDS ?? '' });
  if (why) throw new Error(why);

  // 0) Bekukan tab IMPORTRANGE (DB_PO/DB_SJ) -> nilai statis. Memutus tautan LIVE ke sistem PO nyata.
  const freezeData: { range: string; values: unknown[][] }[] = [];
  for (const f of FREEZE_TABS) {
    const rr = await call(`${base}/values/${encodeURIComponent(`'${f.tab}'!${f.range}`)}?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`);
    if (!rr.ok) throw new Error(`Gagal baca ${f.tab}: ${rr.status}`);
    const rows = ((await rr.json()) as { values?: unknown[][] }).values ?? [];
    if (rows.some((r) => r.some((c) => typeof c === 'string' && STILL_LOADING.test(c)))) {
      throw new Error(`${f.tab} masih "Loading..." (IMPORTRANGE belum selesai). Tunggu & ulangi — membekukan sekarang akan menyimpan data setengah jadi.`);
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    let errs = 0;
    const clean = rows.map((r) => Array.from({ length: width }, (_, i) => {
      const v = r[i] ?? '';
      if (typeof v === 'string' && SHEET_ERROR.test(v)) { errs++; return ''; }
      return v;
    }));
    const end = colLetter(Math.max(0, width - 1));
    freezeData.push({ range: `'${f.tab}'!A1:${end}${clean.length}`, values: clean });
    console.log(`  BEKUKAN ${f.tab}: ${clean.length} baris × ${width} kolom jadi nilai statis (${errs} sel error rumus dikosongkan)`);
  }

  const items = plan();
  const ranges = items.map((p) => `'${p.tab}'!${colLetter(p.index)}2:${colLetter(p.index)}`);
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const read = await call(`${base}/values:batchGet?${qs}&majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`);
  if (!read.ok) throw new Error(`Gagal baca kolom (tab hilang?): ${read.status} ${(await read.text()).slice(0, 200)}`);
  const vr = ((await read.json()) as { valueRanges: { values?: unknown[][] }[] }).valueRanges;

  // Urutan: user & vendor dulu agar nomor dummy konsisten di tab lain.
  const order = [...items.keys()].sort((a, b) => {
    const w = (t: string): number => (t === 'Master_User_TTD' ? 0 : t === 'Master_Vendor' ? 1 : 2);
    return w(items[a]!.tab) - w(items[b]!.tab);
  });
  const anon = new Anonymizer();
  const data: { range: string; values: string[][] }[] = [];
  let cells = 0;
  for (const i of order) {
    const p = items[i]!;
    const col = vr[i]?.values?.[0] ?? [];
    if (col.length === 0) continue;
    const out = anonymizeColumn(anon, p.kind, col);
    cells += out.length;
    data.push({ range: ranges[i]!, values: out.map((v) => [v]) });
    console.log(`  ${p.tab}.${p.key} (${p.kind}): ${out.length} sel`);
  }
  console.log(`\nSpreadsheet: "${title}" — ${cells} sel akan ditulis.`);
  NOT_HANDLED.forEach((n) => console.log('PERINGATAN:', n));
  if (!process.argv.includes('--yes')) { console.log('\nDRY-RUN. Tambahkan --yes untuk menulis.'); return; }

  const fz = await call(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: freezeData }) });
  if (!fz.ok) throw new Error(`Gagal membekukan DB_PO/DB_SJ: ${fz.status} ${(await fz.text()).slice(0, 200)}`);
  console.log('DB_PO & DB_SJ sudah dibekukan (tidak lagi tertaut ke sistem PO).');
  const w = await call(`${base}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!w.ok) throw new Error(`Gagal menulis: ${w.status} ${(await w.text()).slice(0, 200)}`);
  console.log('Selesai. Salinan sekarang berisi data anonim.');
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
