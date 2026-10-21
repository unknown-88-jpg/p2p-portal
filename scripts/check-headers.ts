/** Cek header sheet vs registry (tanpa menulis apa pun). SHEET_ID + GOOGLE_SA_JSON wajib. */
import { JWT } from 'google-auth-library';
import { SCHEMAS } from '../src/repo/schema';
import { validateHeader } from '../src/repo/header-validator';

async function main(): Promise<void> {
  const id = process.env.SHEET_ID, saRaw = process.env.GOOGLE_SA_JSON;
  if (!id || !saRaw) throw new Error('SHEET_ID dan GOOGLE_SA_JSON wajib diisi.');
  const sa = JSON.parse(saRaw) as { client_email: string; private_key: string };
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  let bad = 0;
  for (const s of SCHEMAS) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${s.tab}'!1:1`)}`, { headers: { authorization: `Bearer ${t}` } });
    const row = r.ok ? (((await r.json()) as { values?: unknown[][] }).values?.[0] ?? []) : null;
    const rep = validateHeader(s, row);
    console.log(`${rep.ok ? 'OK  ' : 'GAGAL'} ${s.tab}${rep.missingTab ? ' (tab tidak ada)' : ''}`);
    rep.issues.forEach((i) => console.log(`      kolom ${i.position}: harusnya "${i.expected}", ditemukan "${i.found}"`));
    if (!rep.ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
