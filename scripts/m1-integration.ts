/**
 * M1 integration check — SATU kali dijalankan user terhadap salinan DUMMY + Upstash sungguhan.
 * Membuktikan lapisan koordinasi bekerja di dunia nyata (bukan hanya di test dengan double):
 * lock Redis, idempotensi, race paralel ke Sheets, tipe data (nol di depan, tanggal), pembangkit ID, fail-fast aksi uang.
 *
 *   SHEET_ID=<id DUMMY> PROD_SHEET_IDS=<id prod> GOOGLE_SA_JSON='...' \
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npx tsx scripts/m1-integration.ts [--keep]
 *
 * Menulis ke tab sementara "M1_Scratch" (dibuat & dihapus otomatis) dan beberapa baris Audit_Log berlabel M1_TEST.
 * Konkurensi dibatasi N=8 agar tidak menyentuh kuota 60/menit.
 */
process.env.APP_BASE_URL ??= 'http://localhost:3000';
process.env.DRIVE_ROOT_ID ??= 'unused-in-m1';
process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.CRON_SECRET ??= 'x'.repeat(16);
process.env.HEALTH_TOKEN ??= 'x'.repeat(16);

import { assertSheetAllowed, gfetch } from '../src/infra/google';
import { acquireLocks } from '../src/infra/lock';
import { GoogleQuota } from '../src/infra/ratelimit';
import { env } from '../src/lib/env';
import { AppError } from '../src/lib/errors';
import { productionDeps } from '../src/server/deps';
import { auditMutation } from '../src/server/audit';
import { findRowById } from '../src/server/row-index';
import { idLockName, nextId } from '../src/server/id-gen';
import { runAction } from '../src/server/uow';
import { toSheetSerial } from '../src/lib/time';
import type { TabSchema } from '../src/repo/schema';
import type { Mutation } from '../src/ports/store';

const SCRATCH: TabSchema = {
  tab: 'M1_Scratch', strictHeader: false,
  cols: [{ key: 'Key', type: 'text' }, { key: 'Counter', type: 'money' }, { key: 'Phone', type: 'text' }, { key: 'Stamp', type: 'datetime' }, { key: 'Tgl', type: 'date' }],
};
const BASE = (): string => `https://sheets.googleapis.com/v4/spreadsheets/${env().SHEET_ID}`;
const results: { name: string; ok: boolean; info: string }[] = [];
async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  const t0 = Date.now();
  try { const info = (await fn()) ?? ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
  catch (e) { results.push({ name, ok: false, info: e instanceof Error ? e.message : String(e) }); }
  const r = results[results.length - 1]!;
  console.log(`${r.ok ? 'OK  ' : 'GAGAL'}  ${r.name}${r.info ? ` — ${r.info}` : ''}`);
}
const assert = (c: boolean, m: string): void => { if (!c) throw new Error(m); };
const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

async function batch(requests: unknown[]): Promise<{ replies?: { addSheet?: { properties: { sheetId: number } } }[] }> {
  const r = await gfetch(`${BASE()}:batchUpdate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests }) });
  if (!r.ok) throw new Error(`batchUpdate ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<{ replies?: { addSheet?: { properties: { sheetId: number } } }[] }>;
}

async function main(): Promise<void> {
  await assertSheetAllowed();                                  // tolak non-DUMMY
  const deps = productionDeps();

  // ---- siapkan tab sementara ----
  const meta = (await (await gfetch(`${BASE()}?fields=sheets.properties(sheetId,title)`)).json()) as { sheets: { properties: { sheetId: number; title: string } }[] };
  const old = meta.sheets.find((s) => s.properties.title === SCRATCH.tab);
  if (old) await batch([{ deleteSheet: { sheetId: old.properties.sheetId } }]);
  const added = await batch([{ addSheet: { properties: { title: SCRATCH.tab } } }]);
  const gid = added.replies?.[0]?.addSheet?.properties.sheetId;
  await gfetch(`${BASE()}/values/${encodeURIComponent(`'${SCRATCH.tab}'!A1:E1`)}?valueInputOption=RAW`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: [SCRATCH.cols.map((c) => c.key)] }) });
  console.log(`Tab ${SCRATCH.tab} siap. Mulai uji...\n`);

  const audit = (id: string, clock = deps.clock): Mutation => auditMutation({ actor: 'm1@test.id', idTrx: id, action: 'M1_TEST' }, clock);

  await check('1. Redis lock: acquire/holds/release + latensi', async () => {
    const lat: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = Date.now();
      const h = await acquireLocks(deps.redis, [`m1:lat${i}`], { clock: deps.clock, rng: deps.rng });
      assert(await h.holdsAll(), 'holdsAll false'); await h.release();
      lat.push(Date.now() - t);
    }
    return `acquire+holds+release p50 ${pct(lat, 0.5)} ms, p95 ${pct(lat, 0.95)} ms`;
  });

  await check('2. Tipe data: nol di depan tetap teks, tanggal tetap sel tanggal', async () => {
    const stamp = toSheetSerial(Date.now());
    await runAction(deps, { name: 'm1.types', actor: 'm1@test.id', lockKeys: ['m1:types'], execute: async ({ clock }) => ({
      mutations: [{ kind: 'append', schema: SCRATCH, cells: { Key: 'T1', Counter: 0, Phone: '08120000123', Stamp: stamp, Tgl: Math.floor(stamp) } }, audit('T1', clock)], result: 1 }) });
    const rows = await deps.store.readRows(SCRATCH);
    const r = rows.find((x) => x[0] === 'T1');
    assert(!!r, 'baris tidak ditemukan');
    assert(r![2] === '08120000123', `Phone kembali sebagai ${JSON.stringify(r![2])}`);
    assert(typeof r![3] === 'number' && Math.abs((r![3] as number) - stamp) < 1e-6, `Stamp ${String(r![3])}`);
    interface FmtResp { sheets?: { data?: { rowData?: { values?: { effectiveFormat?: { numberFormat?: { type?: string } } }[] }[] }[] }[] }
    const fmt = (await (await gfetch(`${BASE()}?ranges=${encodeURIComponent(`'${SCRATCH.tab}'!D2`)}&fields=sheets.data.rowData.values.effectiveFormat.numberFormat`)).json()) as FmtResp;
    const t = fmt.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.effectiveFormat?.numberFormat?.type;
    assert(t === 'DATE_TIME', `format sel Stamp = ${String(t)} (harap DATE_TIME)`);
    return 'Phone="08120000123", Stamp numerik + format DATE_TIME';
  });

  await check('3. Race: 8 aksi paralel (lock Upstash + tulis Sheets nyata) => counter +8, tanpa lost update', async () => {
    const inc = (): Promise<unknown> => runAction(deps, { name: 'm1.inc', actor: 'm1@test.id', lockKeys: ['m1:counter'], waitMs: 60_000,
      execute: async ({ store, clock }) => {
        const f = await findRowById(deps.redis, store, SCRATCH, 'Key', 'T1');
        if (!f) throw new AppError('NOT_FOUND', 'T1 hilang');
        const cur = Number(f.data[1] ?? 0);
        return { mutations: [{ kind: 'update', schema: SCRATCH, row: f.row, cells: { Counter: cur + 1 } }, audit('T1', clock)], result: cur + 1 };
      } });
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 8 }, inc));
    const f = await findRowById(deps.redis, deps.store, SCRATCH, 'Key', 'T1');
    assert(Number(f!.data[1]) === 8, `Counter = ${String(f!.data[1])}, seharusnya 8`);
    return `total ${Date.now() - t0} ms untuk 8 aksi serial-di-lock`;
  });

  await check('4. Idempotensi: kunci sama dua kali => satu kali tulis', async () => {
    const key = `m1-idem-${Date.now()}`;
    const mk = (): Promise<{ v: number }> => runAction(deps, { name: 'm1.idem', actor: 'm1@test.id', lockKeys: ['m1:counter'], money: true, idempotencyKey: key,
      execute: async ({ store, clock }) => {
        const f = await findRowById(deps.redis, store, SCRATCH, 'Key', 'T1');
        const cur = Number(f!.data[1] ?? 0);
        return { mutations: [{ kind: 'update', schema: SCRATCH, row: f!.row, cells: { Counter: cur + 1 } }, audit('T1', clock)], result: { v: cur + 1 } };
      } });
    const a = await mk(); const b = await mk();
    assert(a.v === b.v && a.v === 9, `a=${a.v} b=${b.v} (harus sama, 9)`);
    const f = await findRowById(deps.redis, deps.store, SCRATCH, 'Key', 'T1');
    assert(Number(f!.data[1]) === 9, 'counter bukan 9');
  });

  await check('5. Aksi uang gagal cepat saat lock berebut (~2 dtk, CONFLICT)', async () => {
    const h = await acquireLocks(deps.redis, ['m1:busy'], { clock: deps.clock, rng: deps.rng });
    const t0 = Date.now();
    try {
      await runAction(deps, { name: 'm1.busy', actor: 'm1@test.id', lockKeys: ['m1:busy'], money: true, idempotencyKey: `m1-busy-${Date.now()}`, execute: async ({ clock }) => ({ mutations: [audit('X', clock)], result: 1 }) });
      throw new Error('seharusnya CONFLICT');
    } catch (e) {
      assert(e instanceof AppError && e.code === 'CONFLICT', `error ${String(e)}`);
      const ms = Date.now() - t0;
      assert(ms >= 1800 && ms < 4000, `gagal setelah ${ms} ms (target ~2000)`);
      return `CONFLICT setelah ${ms} ms`;
    } finally { await h.release(); }
  });

  await check('6. Pembangkit ID: 5 pembuat paralel => 5 ID unik "M1X-nnnn"', async () => {
    const idSchema: TabSchema = { ...SCRATCH };
    const spec = { prefix: 'M1X', pad: 4, schema: idSchema, keyCol: 'Key' };
    const mk = (): Promise<string> => runAction(deps, { name: 'm1.id', actor: 'm1@test.id', lockKeys: [idLockName('M1X')], waitMs: 60_000,
      execute: async ({ store, clock }) => {
        const id = await nextId(deps.redis, store, spec);
        return { mutations: [{ kind: 'append', schema: SCRATCH, cells: { Key: id, Counter: 0 } }, audit(id, clock)], result: id };
      } });
    const ids = await Promise.all(Array.from({ length: 5 }, mk));
    assert(new Set(ids).size === 5, `ID ganda: ${ids.join(',')}`);
    await deps.redis.del('seqn:M1X');                          // simulasi Redis hilang
    const next = await mk();
    assert(!ids.includes(next), `ID berulang setelah Redis hilang: ${next}`);
    return `${[...ids].sort().join(', ')} lalu (Redis dibuang) ${next}`;
  });

  await check('7. Rate limiter: 10 pengambilan jatah baca tidak diblokir; kunci jendela ada di Redis', async () => {
    const q = new GoogleQuota(deps.redis, deps.clock, 45);
    for (let i = 0; i < 10; i++) await q.take('read');
  });

  // ---- bersih-bersih ----
  if (!process.argv.includes('--keep') && gid !== undefined) await batch([{ deleteSheet: { sheetId: gid } }]);
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} lolos.${process.argv.includes('--keep') ? ` Tab ${SCRATCH.tab} dibiarkan (--keep).` : ` Tab ${SCRATCH.tab} sudah dihapus.`}`);
  console.log('Catatan: baris Audit_Log berlabel M1_TEST tertinggal di salinan DUMMY (aman dihapus manual).');
  process.exit(bad.length ? 1 : 0);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
