/**
 * Seed data uji ke SALINAN DUMMY (setelah anonimisasi): nomor HP & email user yang kosong, vendor Approved sesuai DB_PO,
 * dan kolom Kode Vendor di DB_PO. Dry-run default; --yes untuk menulis. Pengaman sama dengan anonymize-dummy.
 *
 *   SHEET_ID=<id salinan> PROD_SHEET_IDS=<id prod> GOOGLE_SA_JSON='...' npx tsx scripts/seed-dummy.ts [--yes]
 */
import { JWT } from 'google-auth-library';
import { checkSheetAllowed } from '../src/lib/trial-guard';
import { colIndex, DB_PO, MASTER_USER_TTD, MASTER_VENDOR } from '../src/repo/schema';
import { fillPoVendorCodes, planUserFill, planVendors, toSerial, type VendorRow } from '../src/repo/seed';

const L = (i: number): string => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

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
  const why = checkSheetAllowed({ appEnv: 'trial', sheetId: id, title, prodSheetIds: process.env.PROD_SHEET_IDS ?? '' });
  if (why) throw new Error(why);

  const get = async (ranges: string[]): Promise<unknown[][][]> => {
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const r = await call(`${base}/values:batchGet?${qs}&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
    if (!r.ok) throw new Error(`Gagal baca: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return ((await r.json()) as { valueRanges: { values?: unknown[][] }[] }).valueRanges.map((v) => v.values ?? []);
  };

  const U = MASTER_USER_TTD, V = MASTER_VENDOR, P = DB_PO;
  const [users, vendors, poNames, poCodes] = await get([
    `'${U.tab}'!A2:J`, `'${V.tab}'!A2:J`,
    `'${P.tab}'!${L(colIndex(P, 'Vendor_Name'))}2:${L(colIndex(P, 'Vendor_Name'))}`,
    `'${P.tab}'!${L(colIndex(P, 'Kode Vendor'))}2:${L(colIndex(P, 'Kode Vendor'))}`,
  ]) as [unknown[][], unknown[][], unknown[][], unknown[][]];

  const cell = (r: unknown[], i: number): unknown => r[i];
  const uFill = planUserFill(users.map((r) => ({ nama: cell(r, colIndex(U, 'Nama')), email: cell(r, colIndex(U, 'Email')), noHp: cell(r, colIndex(U, 'No_HP')) })));
  const existing: VendorRow[] = vendors.filter((r) => String(r[0] ?? '').trim()).map((r) => ({
    kode: String(r[0] ?? ''), nama: String(r[1] ?? ''), tipe: String(r[2] ?? ''), status: String(r[7] ?? ''), noRek: String(r[6] ?? ''),
  }));
  const names = poNames.map((r) => String(r[0] ?? ''));
  const distinct = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const vPlan = planVendors(distinct, existing, toSerial(new Date()));
  const codes = fillPoVendorCodes(names, poCodes.map((r) => r[0]), vPlan.codeByName);

  console.log(`User: ${users.length} baris; isi No_HP ${uFill.filledPhones} baris, Email ${uFill.filledEmails} baris (nomor 0800000NNNN = nomor uji TIDAK nyata).`);
  console.log(`Vendor: sudah ada ${existing.length}; akan ditambah ${vPlan.rows.length} (Trade sesuai DB_PO: ${distinct.length} nama; + Non-Trade bila belum ada).`);
  console.log(`DB_PO.Kode Vendor: ${codes.filled} baris akan diisi.`);
  if (!process.argv.includes('--yes')) { console.log('\nDRY-RUN. Tambahkan --yes untuk menulis.'); return; }

  const data: { range: string; values: (string | number)[][] }[] = [];
  if (users.length) {
    const hp = L(colIndex(U, 'No_HP')), em = L(colIndex(U, 'Email'));
    data.push({ range: `'${U.tab}'!${hp}2:${hp}${users.length + 1}`, values: uFill.phones.map((v) => [v]) });
    data.push({ range: `'${U.tab}'!${em}2:${em}${users.length + 1}`, values: uFill.emails.map((v) => [v]) });
  }
  if (vPlan.rows.length) {
    const lastUsed = vendors.reduce((m, r, i) => (String(r[0] ?? '').trim() ? i + 1 : m), 0); // baris data terakhir yang terisi
    const start = lastUsed + 2;
    data.push({ range: `'${V.tab}'!A${start}:J${start + vPlan.rows.length - 1}`, values: vPlan.rows });
  }
  if (codes.filled) {
    const q = L(colIndex(P, 'Kode Vendor'));
    data.push({ range: `'${P.tab}'!${q}2:${q}${codes.codes.length + 1}`, values: codes.codes.map((v) => [v]) });
  }
  const w = await call(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  if (!w.ok) throw new Error(`Gagal menulis: ${w.status} ${(await w.text()).slice(0, 200)}`);
  console.log('Selesai. (Password tetap kosong: user dummy mengatur lewat link set-password.)');
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
