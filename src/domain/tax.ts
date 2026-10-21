import { CONFIG } from './config';
import { RuleError } from './errors';
import { clean, num, str } from './legacy-parse';

// Padanan hitungPajak() di Calc.gs. URUTAN OPERASI FLOAT SENGAJA SAMA PERSIS (jangan "dirapikan"):
// hasil dibulatkan per komponen (Math.round), finalAmount dibulatkan TERPISAH dari komponennya.
// Diskon TIDAK mengurangi DPP/PPN (aturan lama) - hanya mengurangi nominal akhir.

export interface PphRate { jenis: string; tarifNPWP: number; tarifNon: number }
export interface TaxInput { invAmount?: unknown; diskon?: unknown; biayaLain?: unknown; statusPPN?: unknown; jenisPPh?: unknown; npwpVendor?: unknown }
export interface TaxResult { dpp: number; ppnAmount: number; pphRate: number; pphAmount: number; finalAmount: number }

const rateOk = (r: number): boolean => Number.isFinite(r) && r >= 0 && r <= 1;

export function hitungPajak(input: TaxInput, pphRates: readonly PphRate[]): TaxResult {
  const invAmount = num(input.invAmount);
  const diskon = num(input.diskon);
  const biayaLain = num(input.biayaLain);
  const statusPPN = str(input.statusPPN) || 'Non PPN';
  const jenisPPh = str(input.jenisPPh) || '-';
  const npwp = clean(input.npwpVendor);

  if (![invAmount, diskon, biayaLain].every(Number.isFinite)) throw new RuleError('Nominal tidak valid.'); // tambahan: lama tidak menangani Infinity
  if (invAmount < 0 || diskon < 0 || biayaLain < 0) throw new RuleError('Nominal tidak boleh negatif.');
  if (diskon > invAmount) throw new RuleError('Diskon tidak boleh melebihi nilai invoice.');

  let dpp = 0, ppnAmount = 0;
  if (statusPPN === 'Include PPN') {
    dpp = invAmount / (1 + CONFIG.PPN_RATE);
    ppnAmount = invAmount - dpp;
  } else if (statusPPN === 'Exclude PPN') {
    dpp = invAmount;
    ppnAmount = dpp * CONFIG.PPN_RATE;
  } else {
    dpp = invAmount;
    ppnAmount = 0;
  }

  let pphRate = 0, pphAmount = 0;
  if (jenisPPh !== '-' && jenisPPh !== '') {
    const row = pphRates.find((r) => r.jenis === jenisPPh);
    if (!row) throw new RuleError(`Jenis PPh "${jenisPPh}" tidak ada di Master_PPh.`);
    const punyaNPWP = npwp !== '' && npwp !== '-';
    pphRate = punyaNPWP ? row.tarifNPWP : row.tarifNon;
    // TAMBAHAN (lama tidak memvalidasi): tarif di luar 0..1 (mis. "2" bukan 0.02) = salah ketik di master -> tolak, jangan memotong 200%.
    if (!rateOk(pphRate)) throw new RuleError(`Tarif PPh "${jenisPPh}" di Master_PPh tidak valid (harus 0 sampai 1, mis. 0.02 untuk 2%). Hubungi Finance.`);
    pphAmount = dpp * pphRate;
  }

  const finalAmount = dpp + ppnAmount + biayaLain - diskon - pphAmount;
  if (finalAmount < 0) throw new RuleError('Nominal akhir jadi negatif. Cek kembali diskon dan potongan PPh.');

  return { dpp: Math.round(dpp), ppnAmount: Math.round(ppnAmount), pphRate, pphAmount: Math.round(pphAmount), finalAmount: Math.round(finalAmount) };
}
