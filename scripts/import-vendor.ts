/**
 * Admin-run: impor vendor dari CSV lokal lewat service `daftarVendor` (validasi, I7, lock, audit tetap jalan). Vendor masuk status PENDING;
 * pengesahan tetap oleh orang lain lewat portal (maker-checker). Default = DRY-RUN (tidak menulis); tambah --apply untuk menulis.
 *
 *   npm run import-vendor -- --csv ./vendor.csv --phone 081200000001            # dry-run
 *   npm run import-vendor -- --csv ./vendor.csv --phone 081200000001 --apply    # tulis
 *
 * CSV (header): nama,tipe,npwp,bank,nama_rekening,no_rekening. Tipe: Trade | Non-Trade. File CSV JANGAN di-commit (simpan di luar repo).
 * --phone = akun pendaftar (harus aktif & berwenang mendaftarkan vendor). Memakai .env.local; guard sheet (assertSheetAllowed) tetap berlaku.
 * Output hanya metadata: nomor baris, status, alasan. Tidak mencetak NPWP/rekening.
 */
import { readFileSync } from 'node:fs';
import { maskPhone, normalizePhone } from '../src/domain/phone';
import { bacaBarisVendor, parseCsv, rencanaImpor } from '../src/domain/vendor-import';
import { assertSheetAllowed } from '../src/infra/google';
import { MASTER_VENDOR } from '../src/repo/schema';
import { AppError } from '../src/lib/errors';
import { loadAccounts } from '../src/server/users';
import { authDeps } from '../src/server/runtime';
import { daftarVendor } from '../src/server/vendor';
import { can } from '../src/domain/capabilities';

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const csvPath = arg('csv'), phoneArg = arg('phone'), apply = process.argv.includes('--apply');
  if (!csvPath || !phoneArg) throw new Error('Pemakaian: npm run import-vendor -- --csv <file.csv> --phone <nomor HP pendaftar> [--apply]');
  const parsed = bacaBarisVendor(parseCsv(readFileSync(csvPath, 'utf8')));
  if (!parsed.ok) throw new Error(parsed.galat);

  await assertSheetAllowed();
  const d = authDeps();
  const akun = (await loadAccounts(d.store)).get(normalizePhone(phoneArg));
  if (!akun || !akun.aktif) throw new Error('Akun pendaftar tidak ditemukan / tidak aktif di Master_User_TTD.');
  const s = { phone: akun.phone, email: akun.email, nama: akun.nama, jabatan: akun.jabatan, created: Date.now(), ep: 0, roles: akun.roles };
  if (!can(s.roles, 'vendor.register')) throw new Error('Akun pendaftar tidak berwenang mendaftarkan vendor.');

  const rencana = rencanaImpor(await d.store.readRows(MASTER_VENDOR), parsed.baris);
  console.log(`\nPendaftar: ${akun.nama} (${maskPhone(akun.phone)}) · ${parsed.baris.length} baris · mode ${apply ? 'APPLY (menulis)' : 'DRY-RUN'}\n`);
  let ok = 0, gagal = 0;
  for (const [i, h] of rencana.entries()) {
    if (h.status === 'ditolak') { gagal++; console.log(`baris ${h.no}: DITOLAK — ${h.alasan}`); continue; }
    if (!apply) { ok++; console.log(`baris ${h.no}: siap`); continue; }
    try {
      const r = await daftarVendor(d, s, parsed.baris[i]!.input as never);
      ok++; console.log(`baris ${h.no}: terdaftar ${r.kode} (${r.status})`);
    } catch (e) { gagal++; console.log(`baris ${h.no}: GAGAL — ${e instanceof AppError ? e.message : 'galat tak terduga'}`); }
  }
  console.log(`\nSelesai: ${ok} ${apply ? 'terdaftar' : 'siap'}, ${gagal} ditolak/gagal.${apply ? ' Status Pending: minta rekan Finance mengesahkan di portal.' : ' Tambah --apply untuk menulis.'}\n`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
