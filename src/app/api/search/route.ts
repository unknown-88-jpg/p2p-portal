import { cari } from '@/server/dokumen';
import { authDeps } from '@/server/runtime';
import { route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ctrl+K: hanya dokumen yang boleh dilihat pengguna (I13). Query < 2 huruf = kosong. */
export const GET = route({ method: 'GET', session: 'required' }, async ({ req, session }) => {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return { body: { hasil: await cari(authDeps(), session!, q) } };
});
