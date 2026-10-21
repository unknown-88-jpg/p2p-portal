/** Pelanggaran aturan bisnis dari domain murni. Server memetakannya ke AppError RULE_VIOLATION (422). Pesan = pesan sistem lama bila ada. */
export class RuleError extends Error {
  constructor(message: string) { super(message); this.name = 'RuleError'; }
}
