// Uji beban M8 — dijalankan DARI LUAR terhadap deploy (Vercel Preview/Prod trial), DATA DUMMY saja.
//   APP_URL=https://xxx.vercel.app LOAD_USERS="0800000001:pw,0800000002:pw" LOAD_MANAGER="0800000010:pw" \
//   LOAD_DOCS="NTR-00007,NTR-00008" LOAD_DURATION=30 LOAD_CONC=10 npm run load-test
// Fase A (baca): campuran halaman/API tampilan selama LOAD_DURATION detik pada LOAD_CONC pekerja. Laporan: p50/p95/p99, kode status, UPSTREAM_BUSY (503) & 429.
// Fase B (integritas uang): untuk tiap dokumen Submitted (< Rp 5 jt, bukan buatan manager itu) -> 10 approve PARALEL berkunci-idempotensi berbeda + 5 replay kunci sama.
//   Lulus bila: tepat 1 sukses (200), sisanya 409/422/503 (bukan 500), replay = respons sama, dan timeline memuat tepat 1 "Disetujui — Diperiksa Oleh".
// F2-G (opsional, Finance):
//   LOAD_FINANCE="08xx:pw"  -> Fase A ikut membaca /api/finance/queues dengan sesi Finance Staff.
//   LOAD_PAY_DOCS="NTR-000xx" LOAD_PAY_REK="BCA 123" -> Fase C (MENGUBAH DATA DUMMY: mencatat pembayaran): untuk tiap dokumen Siap Dibayar,
//   10 POST /api/finance/bayar PARALEL senilai SISA (kunci & ref berbeda) + 5 replay kunci sama. Lulus bila: tepat <= 1 sukses,
//   total di riwayat pembayaran <= nominal akhir + Rp 1.000 (I5), tidak ada 5xx selain 503, replay = respons sama.
// Skrip ini menolak host yang bukan *.vercel.app / localhost kecuali LOAD_ALLOW_HOST=1 (jangan sampai menembak produksi sungguhan).
import { randomBytes } from 'node:crypto';

const APP = (process.env.APP_URL ?? '').replace(/\/$/, '');
if (!APP) { console.error('APP_URL wajib.'); process.exit(2); }
const host = new URL(APP).hostname;
if (!(host.endsWith('.vercel.app') || host === 'localhost') && process.env.LOAD_ALLOW_HOST !== '1') { console.error(`Host ${host} bukan *.vercel.app/localhost. Set LOAD_ALLOW_HOST=1 bila memang disengaja (HANYA data dummy).`); process.exit(2); }
const DURATION = Number(process.env.LOAD_DURATION ?? 30) * 1000;
const CONC = Math.min(Number(process.env.LOAD_CONC ?? 10), 50);
const cred = (s: string | undefined): { phone: string; password: string }[] => (s ?? '').split(',').filter(Boolean).map((x) => { const [phone, ...rest] = x.split(':'); return { phone: phone!.trim(), password: rest.join(':') }; });
const USERS = cred(process.env.LOAD_USERS);
const MANAGER = cred(process.env.LOAD_MANAGER)[0];
const DOCS = (process.env.LOAD_DOCS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const FINANCE = cred(process.env.LOAD_FINANCE)[0];
const PAY_DOCS = (process.env.LOAD_PAY_DOCS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const PAY_REK = (process.env.LOAD_PAY_REK ?? '').trim();

interface Sesi { cookie: string; phone: string }
async function login(c: { phone: string; password: string }): Promise<Sesi> {
  const r = await fetch(`${APP}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP }, body: JSON.stringify(c) });
  if (!r.ok) throw new Error(`login ${c.phone.slice(0, 4)}… gagal: ${r.status} ${(await r.text()).slice(0, 120)}`);
  const sc = r.headers.get('set-cookie') ?? '';
  return { cookie: sc.split(';')[0]!, phone: c.phone };
}
const call = async (s: Sesi, method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const t0 = performance.now();
  try {
    const r = await fetch(`${APP}${path}`, { method, headers: { cookie: s.cookie, origin: APP, ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, ms: performance.now() - t0, text, retryAfter: r.headers.get('retry-after') };
  } catch (e) { return { status: 0, ms: performance.now() - t0, text: String(e), retryAfter: null }; }
};
const pct = (a: number[], p: number): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!); };

async function faseA(sesi: Sesi[], mgr: Sesi | undefined, fin?: Sesi): Promise<{ lulus: boolean }> {
  console.log(`\n== Fase A: baca ${DURATION / 1000}s, ${CONC} pekerja, ${sesi.length + (mgr ? 1 : 0) + (fin ? 1 : 0)} sesi ==`);
  const semua = [...sesi, ...(mgr ? [mgr] : []), ...(fin ? [fin] : [])];
  const rute = [{ p: '/api/home', w: 3 }, { p: '/api/pengajuan', w: 3 }, { p: '/api/search?q=kertas', w: 2 }, { p: '/api/search?q=invoice', w: 1 }, { p: '/api/master/vendors?tipe=Non-Trade', w: 1 }, { p: '/api/master/pph', w: 1 }];
  const bag = rute.flatMap((r) => Array(r.w).fill(r.p) as string[]);
  const bagFin = [...bag, ...Array(4).fill('/api/finance/queues') as string[]]; // F2-G: sesi Finance ikut membaca antrean
  const hist = new Map<number, number>(); const lat: number[] = []; const per = new Map<string, number[]>();
  const stop = Date.now() + DURATION; let n = 0;
  await Promise.all(Array.from({ length: CONC }, async (_, i) => {
    const s = semua[i % semua.length]!;
    while (Date.now() < stop) {
      const b = s === fin ? bagFin : bag;
      const p = b[Math.floor(Math.random() * b.length)]!;
      const r = await call(s, 'GET', p);
      n++; hist.set(r.status, (hist.get(r.status) ?? 0) + 1); lat.push(r.ms); (per.get(p) ?? per.set(p, []).get(p)!).push(r.ms);
      if (r.status === 429 || r.status === 503) await new Promise((res) => setTimeout(res, Math.min(5, Number(r.retryAfter ?? 1)) * 1000));
    }
  }));
  console.log(`total ${n} req (${(n / (DURATION / 1000)).toFixed(1)} rps)  p50=${pct(lat, 50)}ms p95=${pct(lat, 95)}ms p99=${pct(lat, 99)}ms`);
  console.log('status:', Object.fromEntries([...hist].sort()));
  for (const [p, a] of per) console.log(`  ${p.padEnd(26)} n=${String(a.length).padStart(4)} p50=${pct(a, 50)} p95=${pct(a, 95)}`);
  const s500 = [...hist].filter(([k]) => k >= 500 && k !== 503).reduce((a, [, v]) => a + v, 0) + (hist.get(0) ?? 0);
  const ok = s500 === 0;
  console.log(ok ? 'LULUS: tidak ada 5xx selain 503 anggun / tidak ada kegagalan jaringan.' : `GAGAL: ${s500} respons 5xx(non-503)/jaringan.`);
  return { lulus: ok };
}

async function faseB(mgr: Sesi): Promise<{ lulus: boolean }> {
  console.log(`\n== Fase B: integritas approve paralel (${DOCS.length} dokumen) ==`);
  let semuaLulus = true;
  for (const id of DOCS) {
    const inbox = await call(mgr, 'GET', '/api/approvals/inbox');
    const item = (JSON.parse(inbox.text).items as { id: string; etag: string; butuhStepUp: boolean; terkunci?: unknown }[] | undefined)?.find((x) => x.id === id);
    if (!item) { console.log(`  ${id}: tidak ada di inbox manager (bukan Submitted / bukan wewenang) — dilewati`); continue; }
    if (item.butuhStepUp) { console.log(`  ${id}: >= Rp 5 jt (butuh step-up) — dilewati; pakai dokumen < Rp 5 jt`); continue; }
    const body = { etag: item.etag, notes: 'uji beban' };
    const keyA = `lt-${randomBytes(8).toString('hex')}`;
    const par = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => call(mgr, 'POST', `/api/approvals/${id}/approve`, body, { 'idempotency-key': i === 0 ? keyA : `lt-${randomBytes(8).toString('hex')}` })),
    ]);
    const replay = await Promise.all(Array.from({ length: 5 }, () => call(mgr, 'POST', `/api/approvals/${id}/approve`, body, { 'idempotency-key': keyA })));
    const sukses = par.filter((r) => r.status === 200).length;
    const buruk = par.concat(replay).filter((r) => r.status >= 500 && r.status !== 503 || r.status === 0).length;
    const det = await call(mgr, 'GET', `/api/pengajuan/${id}/detail`);
    const tl = (JSON.parse(det.text).timeline as { judul: string }[] | undefined) ?? [];
    const baris = tl.filter((t) => t.judul.includes('Disetujui') && t.judul.includes('Diperiksa')).length;
    const kodes = Object.entries(par.reduce<Record<number, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(' ');
    const ok = sukses <= 1 && baris === 1 && buruk === 0;
    semuaLulus &&= ok;
    console.log(`  ${id}: paralel [${kodes}] replay [${replay.map((r) => r.status).join(',')}] persetujuan L2 di timeline=${baris} ${ok ? 'OK' : 'GAGAL'}${sukses === 0 ? ' (0 sukses: ambigu 503? cek manual di sheet)' : ''}`);
  }
  console.log(semuaLulus ? 'LULUS: tidak ada persetujuan ganda / hilang yang terdeteksi.' : 'GAGAL: periksa baris di atas dan Trx_Approval di sheet DUMMY.');
  return { lulus: semuaLulus };
}

async function faseC(fin: Sesi, pw: string): Promise<{ lulus: boolean }> {
  console.log(`\n== Fase C: integritas pembayaran paralel (${PAY_DOCS.length} dokumen, rekening ${PAY_REK}) — MENGUBAH DATA DUMMY ==`);
  const su = await call(fin, 'POST', '/api/auth/step-up', { password: pw });
  if (su.status !== 200) { console.log(`  step-up gagal (${su.status}) — Fase C dibatalkan`); return { lulus: false }; }
  const tgl = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  let semuaLulus = true;
  for (const id of PAY_DOCS) {
    const q = await call(fin, 'GET', '/api/finance/queues?stage=bayar');
    const it = (JSON.parse(q.text).items as { id: string; etag: string; sisa: number; nominal: number; blokirBayar?: string | null }[] | undefined)?.find((x) => x.id === id);
    if (!it) { console.log(`  ${id}: tidak di tahap Siap Dibayar — dilewati`); continue; }
    if (it.blokirBayar) { console.log(`  ${id}: diblokir I4 (${it.blokirBayar}) — dilewati`); continue; }
    const body = (ref: string) => ({ items: [{ id, etag: it.etag, nominal: it.sisa }], tglBayar: tgl, sumberRekening: PAY_REK, refNo: ref });
    const keyA = `lt-${randomBytes(8).toString('hex')}`;
    const par = await Promise.all(Array.from({ length: 10 }, (_, i) => call(fin, 'POST', '/api/finance/bayar', body(`LT-${i}`), { 'idempotency-key': i === 0 ? keyA : `lt-${randomBytes(8).toString('hex')}` })));
    const replay = await Promise.all(Array.from({ length: 5 }, () => call(fin, 'POST', '/api/finance/bayar', body('LT-0'), { 'idempotency-key': keyA })));
    const sukses = par.filter((r) => r.status === 200).length;
    const buruk = par.concat(replay).filter((r) => (r.status >= 500 && r.status !== 503) || r.status === 0).length;
    const riw = JSON.parse((await call(fin, 'GET', `/api/pengajuan/${id}/payments`)).text) as { total: number };
    const overpay = riw.total > it.nominal + 1000;
    const kodes = Object.entries(par.reduce<Record<number, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(' ');
    const ok = sukses <= 1 && !overpay && buruk === 0;
    semuaLulus &&= ok;
    console.log(`  ${id}: paralel [${kodes}] replay [${replay.map((r) => r.status).join(',')}] total dibayar=${riw.total} dari ${it.nominal} ${ok ? 'OK' : 'GAGAL'}`);
  }
  console.log(semuaLulus ? 'LULUS: tidak ada pembayaran ganda / overpay.' : 'GAGAL: periksa Trx_Payment_Log di sheet DUMMY.');
  return { lulus: semuaLulus };
}

(async () => {
  console.log(`Target ${APP} (dummy only).`);
  const sesi: Sesi[] = []; for (const u of USERS) sesi.push(await login(u));
  const mgr = MANAGER ? await login(MANAGER) : undefined;
  const fin = FINANCE ? await login(FINANCE) : undefined;
  if (!sesi.length && !mgr && !fin) { console.error('Isi LOAD_USERS dan/atau LOAD_MANAGER.'); process.exit(2); }
  const a = await faseA(sesi, mgr, fin);
  const b = mgr && DOCS.length ? await faseB(mgr) : { lulus: true };
  if (!mgr || !DOCS.length) console.log('\nFase B dilewati (butuh LOAD_MANAGER + LOAD_DOCS).');
  const c = fin && PAY_DOCS.length && PAY_REK ? await faseC(fin, FINANCE!.password) : { lulus: true };
  if (!fin || !PAY_DOCS.length || !PAY_REK) console.log('Fase C dilewati (butuh LOAD_FINANCE + LOAD_PAY_DOCS + LOAD_PAY_REK).');
  console.log('\nCatat juga: grafik Vercel (durasi fungsi, error rate) dan Upstash (commands/s) pada jendela waktu uji.');
  process.exit(a.lulus && b.lulus && c.lulus ? 0 : 1);
})();
