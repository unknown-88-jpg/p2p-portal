/**
 * Admin-run: terbitkan link set-password (sekali pakai, 60 menit) untuk satu nomor HP — pengganti kirimLinkSetPasswordApprover.
 * Sebelum WA gateway tersambung (M6), link dicetak di sini; kirim manual ke pemilik nomor lewat kanal yang aman.
 *
 *   npm run issue-setpass -- 081200000001
 * Memakai .env.local (SHEET_ID, GOOGLE_SA_JSON, UPSTASH_*, JWT_SECRET HARUS sama dengan yang dipakai aplikasi, APP_BASE_URL).
 */
import { maskPhone } from '../src/domain/phone';
import { assertSheetAllowed } from '../src/infra/google';
import { issueSetPasswordLink } from '../src/server/auth';
import { authDeps } from '../src/server/runtime';

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) throw new Error('Pemakaian: npm run issue-setpass -- <nomor HP>');
  await assertSheetAllowed();
  const r = await issueSetPasswordLink(authDeps(), phone);
  console.log(`\nLink set-password untuk ${r.nama} (${maskPhone(r.phone)}), berlaku 60 menit, sekali pakai:\n\n${r.link}\n`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
