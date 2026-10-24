import { can } from '@/domain/capabilities';
import { inbox } from '@/server/approval';
import type { SessionData } from '@/server/auth';
import { authDeps } from '@/server/runtime';

/**
 * Satu-satunya sumber isi sidebar untuk semua halaman, supaya menu tidak berbeda antar halaman (sebelumnya tiap halaman menulis sendiri,
 * dan halaman Persetujuan menulis bisaAjukan={false} tetap sehingga pengguna ber-peran ganda kehilangan "Pengajuan saya" dan "Ajukan").
 * Angka antrean memakai pembacaan tampilan ber-cache; bila gagal dibaca, angka dihilangkan (hiasan saja, tidak boleh merusak halaman).
 */
export async function propsNav(s: SessionData): Promise<{ bisaAjukan: boolean; bisaSetujui: boolean; bisaFinance?: boolean; jumlahMenunggu?: number }> {
  const bisaAjukan = can(s.roles, 'pengajuan.write');
  const bisaSetujui = can(s.roles, 'approve.manager');
  const fin = can(s.roles, 'finance.view') ? { bisaFinance: true } : {};
  if (!bisaSetujui) return { bisaAjukan, bisaSetujui, ...fin };
  try { return { bisaAjukan, bisaSetujui, ...fin, jumlahMenunggu: (await inbox(authDeps(), s)).length }; }
  catch { return { bisaAjukan, bisaSetujui, ...fin }; }
}
