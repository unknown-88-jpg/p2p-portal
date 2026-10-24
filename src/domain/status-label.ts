import { STATUS } from './status';

// Design 7.3: enum tersimpan TIDAK berubah; hanya label & warna tampilan.
export type Nada = 'abu' | 'biru' | 'cyan' | 'kuning' | 'hijau-muda' | 'oranye' | 'hijau' | 'merah' | 'merah-tua';
export interface LabelStatus { label: string; nada: Nada }

const PETA: Readonly<Record<string, LabelStatus>> = {
  [STATUS.DRAFT]: { label: 'Draft', nada: 'abu' },
  [STATUS.SUBMITTED]: { label: 'Menunggu Manager', nada: 'biru' },
  [STATUS.MANAGER_APPROVED]: { label: 'Menunggu Verifikasi Pajak', nada: 'cyan' },
  [STATUS.TAX_VERIFIED]: { label: 'Menunggu Fin. Mgr / CFO', nada: 'kuning' }, // O4: e-approve menggantikan TTD basah
  [STATUS.WET_SIGNED]: { label: 'Menunggu Jurnal COA', nada: 'cyan' },
  [STATUS.COA_POSTED]: { label: 'Siap Dibayar', nada: 'hijau-muda' },
  [STATUS.PARTIALLY_PAID]: { label: 'Dibayar Sebagian', nada: 'oranye' },
  [STATUS.PAID]: { label: 'Lunas', nada: 'hijau' },
  [STATUS.REVISION]: { label: 'Perlu Revisi', nada: 'merah' },
  [STATUS.REJECTED]: { label: 'Ditolak', nada: 'merah-tua' },
};
/** Status tak dikenal ditampilkan apa adanya (jangan menyembunyikan data aneh). */
export const labelStatus = (status: string): LabelStatus => PETA[status] ?? { label: status || '-', nada: 'abu' };

/** Kelompok filter "Pengajuan saya". */
export const KELOMPOK_STATUS = [
  { kunci: 'semua', label: 'Semua', cocok: (_s: string): boolean => true },
  { kunci: 'perlu-tindakan', label: 'Perlu tindakan', cocok: (s: string): boolean => s === STATUS.DRAFT || s === STATUS.REVISION },
  { kunci: 'diproses', label: 'Diproses', cocok: (s: string): boolean => [STATUS.SUBMITTED, STATUS.MANAGER_APPROVED, STATUS.TAX_VERIFIED, STATUS.WET_SIGNED, STATUS.COA_POSTED, STATUS.PARTIALLY_PAID].some((x) => x === s) },
  { kunci: 'selesai', label: 'Selesai', cocok: (s: string): boolean => s === STATUS.PAID || s === STATUS.REJECTED },
] as const;
export type KunciKelompok = (typeof KELOMPOK_STATUS)[number]['kunci'];
