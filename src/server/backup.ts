import { namaBackup, pilihHapusBackup, PREFIX_BACKUP } from '@/domain/backup';
import { wibDate } from '@/lib/time';
import type { Clock } from '@/lib/clock';
import type { DrivePort } from '@/ports/drive';
import type { TableStore } from '@/ports/store';
import { appendAudit } from './audit';

export interface BackupDeps { drive: DrivePort; store: TableStore; clock: Clock }
export interface HasilBackup { dibuat: string | null; dihapus: string[]; disimpan: number }

/**
 * F3-E: salin spreadsheet ke folder backup (Shared Drive) sekali per hari WIB, lalu terapkan retensi 7 harian + 4 mingguan.
 * Idempoten: bila backup hari ini sudah ada, tidak menyalin lagi. Hanya file bernama BACKUP_P2P_YYYY-MM-DD yang pernah dihapus (ke trash).
 */
export async function jalankanBackup(d: BackupDeps, sheetId: string): Promise<HasilBackup> {
  const hariIni = wibDate(d.clock.now());
  const ada = await d.drive.listOld({ namePrefix: PREFIX_BACKUP, createdBeforeMs: d.clock.now() + 60_000, limit: 200 });
  const nama = namaBackup(hariIni);
  let dibuat: string | null = null;
  const semua = ada.map((f) => ({ id: f.id, name: f.name }));
  if (!ada.some((f) => f.name === nama)) {
    const f = await d.drive.copyInto(sheetId, nama);
    dibuat = f.name;
    semua.push({ id: f.id, name: f.name });
  }
  const hapus = pilihHapusBackup(semua, hariIni);
  for (const id of hapus) await d.drive.trash(id);
  await appendAudit(d.store, d.clock, { actor: 'system-cron', action: 'BACKUP', field: 'Spreadsheet', newValue: dibuat ?? '(sudah ada)', notes: `retensi: ${hapus.length} dihapus, ${semua.length - hapus.length} disimpan` });
  return { dibuat, dihapus: hapus, disimpan: semua.length - hapus.length };
}
