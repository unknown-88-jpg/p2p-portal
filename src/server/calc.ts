import { z } from 'zod';
import { RuleError } from '@/domain/errors';
import { hitungPajak, type PphRate, type TaxResult } from '@/domain/tax';
import { AppError } from '@/lib/errors';

const money = z.number().finite().min(-1e13).max(1e13);
/** Input preview pajak. Lebih ketat dari sistem lama (angka wajib number, enum PPN) - nilai di luar itu bukan input sah dari UI. */
export const taxSchema = z.object({
  invAmount: money,
  diskon: money.optional(),
  biayaLain: money.optional(),
  statusPPN: z.enum(['Include PPN', 'Exclude PPN', 'Non PPN']).optional(),
  jenisPPh: z.string().max(100).optional(),
  npwpVendor: z.string().max(40).optional(),
}).strict();

/** Domain melempar RuleError -> 422 dengan pesan sistem lama. */
export function hitungPajakApi(input: z.infer<typeof taxSchema>, rates: readonly PphRate[]): TaxResult {
  try { return hitungPajak(input, rates); }
  catch (e) { if (e instanceof RuleError) throw new AppError('RULE_VIOLATION', e.message); throw e; }
}
