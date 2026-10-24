// F3-E: backup harian spreadsheet (retensi 7 harian + 4 mingguan) & kandidat arsip (O10: Paid > 18 bulan). Murni.
import { num, str } from './legacy-parse';
import { tglYmd } from './odoo';
import { STATUS } from './status';

export const PREFIX_BACKUP = 'BACKUP_P2P_';
export const namaBackup = (ymd: string): string => `${PREFIX_BACKUP}${ymd}`;
const TGL_RE = new RegExp(`^${PREFIX_BACKUP}(\\d{4}-\\d{2}-\\d{2})$`);
export const tglBackup = (nama: string): string | null => TGL_RE.exec(nama)?.[1] ?? null;

export const SIMPAN_HARIAN = 7;
export const SIMPAN_MINGGUAN = 4;

/** Senin minggu (ISO) untuk 'YYYY-MM-DD'. */
export function seninDari(ymd: string): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Senin = 0
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Retensi GFS sederhana: simpan backup dari 7 tanggal terbaru + backup terbaru dari tiap 4 minggu terbaru.
 * File yang namanya bukan format backup TIDAK PERNAH dihapus. Backup bertanggal masa depan dibiarkan.
 */
export function pilihHapusBackup(files: readonly { id: string; name: string }[], hariIni: string): string[] {
  const sah = files.map((f) => ({ ...f, tgl: tglBackup(f.name) })).filter((f): f is { id: string; name: string; tgl: string } => !!f.tgl && f.tgl <= hariIni);
  sah.sort((a, b) => b.tgl.localeCompare(a.tgl) || b.id.localeCompare(a.id));
  const simpan = new Set<string>();
  const tglHarian = [...new Set(sah.map((f) => f.tgl))].slice(0, SIMPAN_HARIAN);
  for (const t of tglHarian) simpan.add(sah.find((f) => f.tgl === t)!.id); // satu per tanggal (terbaru)
  const minggu = [...new Set(sah.map((f) => seninDari(f.tgl)))].slice(0, SIMPAN_MINGGUAN);
  for (const m of minggu) simpan.add(sah.find((f) => seninDari(f.tgl) === m)!.id);
  return sah.filter((f) => !simpan.has(f.id)).map((f) => f.id);
}

export const BULAN_ARSIP = 18;
/** Tanggal batas: dokumen lunas sebelum (atau pada) tanggal ini memenuhi syarat arsip. */
export function batasArsip(hariIni: string, bulan = BULAN_ARSIP): string {
  const [y, m, d] = hariIni.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - bulan;
  const yy = Math.floor(total / 12), mm = (total % 12) + 1;
  const akhir = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, akhir)).padStart(2, '0')}`;
}

export interface KandidatArsip { id: string; vendor: string; nominal: number; lunas: string }
/** Paid dan tanggal bayar terakhir (kosong -> LAST_UPDATE) ≤ batas 18 bulan. Baca saja. */
export function kandidatArsip(pengajuan: readonly Readonly<Record<string, unknown>>[], hariIni: string): { batas: string; kandidat: KandidatArsip[] } {
  const batas = batasArsip(hariIni);
  const kandidat: KandidatArsip[] = [];
  for (const r of pengajuan) {
    if (str(r.STATUS) !== STATUS.PAID || !str(r.ID_TRX)) continue;
    const lunas = tglYmd(r.LAST_PAY_DATE) || tglYmd(r.LAST_UPDATE);
    if (lunas && lunas <= batas) kandidat.push({ id: str(r.ID_TRX), vendor: str(r.VENDOR_NAME), nominal: num(r.FINAL_AMOUNT), lunas });
  }
  return { batas, kandidat: kandidat.sort((a, b) => a.lunas.localeCompare(b.lunas)) };
}
