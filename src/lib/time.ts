// Semua tanggal bisnis = Asia/Jakarta (WIB, UTC+7, tanpa DST). Server Vercel = UTC -> JANGAN pakai new Date("2026-10-05") mentah.
const WIB_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const SERIAL_UNIX_EPOCH = 25569; // serial Google Sheets untuk 1970-01-01

/** epoch ms -> serial Sheets (waktu dinding WIB). */
export function toSheetSerial(epochMs: number): number {
  return (epochMs + WIB_MS) / DAY_MS + SERIAL_UNIX_EPOCH;
}
/** serial Sheets (waktu dinding WIB) -> epoch ms. */
export function fromSheetSerial(serial: number): number {
  return Math.round((serial - SERIAL_UNIX_EPOCH) * DAY_MS) - WIB_MS;
}
/** 'YYYY-MM-DD' menurut WIB. */
export function wibDate(epochMs: number): string {
  return new Date(epochMs + WIB_MS).toISOString().slice(0, 10);
}
/** Awal hari WIB (00:00:00.000) untuk 'YYYY-MM-DD' -> epoch ms. */
export function startOfWibDay(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Tanggal tidak valid: ${ymd}`);
  return Date.parse(`${ymd}T00:00:00.000Z`) - WIB_MS;
}
/** Akhir hari WIB (23:59:59.999) — batas rentang export (design 4.5). */
export function endOfWibDay(ymd: string): number {
  return startOfWibDay(ymd) + DAY_MS - 1;
}

/** 'YYYY-MM-DD' (kalender valid) -> serial tanggal Sheets (bilangan bulat). */
export function ymdToSerial(ymd: string): number {
  const ms = startOfWibDay(ymd);
  if (wibDate(ms) !== ymd) throw new Error(`Tanggal tidak valid: ${ymd}`);
  return toSheetSerial(ms);
}
/** serial/angka-teks Sheets -> 'YYYY-MM-DD' (WIB); '' bila bukan angka positif. */
export function serialToYmd(serial: unknown): string {
  const n = typeof serial === 'number' ? serial : parseFloat(String(serial ?? ''));
  return Number.isFinite(n) && n > 0 ? wibDate(fromSheetSerial(n)) : '';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** serial Sheets -> 'dd/MM/yyyy' (WIB), '-' bila bukan angka positif. Padanan fmtDate() lama. */
export function fmtTanggal(serial: unknown): string {
  const ymd = serialToYmd(serial);
  return ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '-';
}
/** serial Sheets -> 'dd/MM/yyyy HH:mm' (WIB), '-' bila bukan angka positif. */
export function fmtWaktu(serial: unknown): string {
  const n = typeof serial === 'number' ? serial : parseFloat(String(serial ?? ''));
  if (!(Number.isFinite(n) && n > 0)) return '-';
  const d = new Date(fromSheetSerial(n) + WIB_MS);
  return `${fmtTanggal(serial)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
/** Awal bulan WIB ('YYYY-MM-01') untuk epoch ms. */
export const awalBulanWib = (epochMs: number): string => `${wibDate(epochMs).slice(0, 8)}01`;
