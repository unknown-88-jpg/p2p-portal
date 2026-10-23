import { can } from '@/domain/capabilities';
import { inbox } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { authDeps } from '@/server/runtime';

/**
 * Satu-satunya sumber isi sidebar untuk semua halaman, supaya menu tidak berbeda antar halaman (sebelumnya tiap halaman menulis sendiri,
 * dan halaman Persetujuan menulis bisaAjukan={false} tetap sehingga pengguna ber-peran ganda kehilangan "Pengajuan saya" dan "Ajukan").
 * Angka antrean memakai pembacaan tampilan ber-cache; bila gagal dibaca, angka dihilangkan (hiasan saja, tidak boleh merusak halaman).
 */
export async function propsNav(s: SessionData): Promise<{ bisaAjukan: boolean; bisaSetujui: boolean; jumlahMenunggu?: number }> {
  const bisaAjukan = can(s.roles, 'pengajuan.write');
  const bisaSetujui = can(s.roles, 'approve.manager');
  if (!bisaSetujui) return { bisaAjukan, bisaSetujui };
  try { return { bisaAjukan, bisaSetujui, jumlahMenunggu: (await inbox(authDeps(), s)).length }; }
  catch { return { bisaAjukan, bisaSetujui }; }
}
