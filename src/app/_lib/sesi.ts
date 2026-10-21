import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { can } from '@/domain/capabilities';
import { getSession } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { sessionCookieName } from '../api/_lib/handler';

/** Untuk halaman server: sesi wajib, kalau tidak ke /login. `perlu` = capability tambahan (kalau kurang, ke beranda). */
export async function wajibSesi(perlu?: Parameters<typeof can>[1]) {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const s = await getSession(authDeps(), token);
  if (!s) redirect('/login');
  if (perlu && !can(s.roles, perlu)) redirect('/');
  return s;
}
