// Padanan helper Utils.gs (num/str/upper/clean). Semantiknya SENGAJA sama persis dengan sistem lama
// (parseFloat longgar, null -> ""), karena hasil hitungan uang bergantung padanya (golden test M3).
export function num(v: unknown): number {
  const n = parseFloat(v as string);
  return Number.isNaN(n) ? 0 : n;
}
export function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}
export const upper = (v: unknown): string => str(v).toUpperCase();
/** Buang apostrof di depan (sheet memakainya untuk memaksa teks). */
export const clean = (v: unknown): string => str(v).replace(/^'/, '');

/** Sel error rumus / IMPORTRANGE belum siap. Nilai seperti ini TIDAK BOLEH dibaca sebagai "kosong". */
const SHEET_ERR = /^#(N\/A|REF!|VALUE!|ERROR!|DIV\/0!|NAME\?|NUM!|NULL!)$|^Loading\.\.\.$/i;
export const isSheetError = (v: unknown): boolean => typeof v === 'string' && SHEET_ERR.test(v.trim());
