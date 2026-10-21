// Kebijakan password (design 5.2, O7): min 8 (lama 6), blokir password umum, bukan nomor HP. Maks 128 (cegah DoS scrypt).
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty123', 'qwertyui', 'qwertyuiop',
  'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'abc12345', 'abcd1234', 'abcdefgh', '11111111', '12345678', '123456789', '1234567890',
  '87654321', '00000000', '88888888', '12341234', 'iloveyou', 'admin123', 'admin1234', 'welcome1', 'welcome123', 'letmein1',
  'rahasia123', 'rahasia1', 'sayangku', 'bismillah', 'indonesia', 'indonesia1', 'indonesia123', 'jakarta123', 'bandung123',
  'finance123', 'finance1', 'portal123', 'p2pportal', 'ganti123', 'gantipassword', 'passwordku', 'katasandi', 'kata sandi',
]);

export type PolicyIssue = 'PENDEK' | 'PANJANG' | 'UMUM' | 'SAMA_DENGAN_NOMOR' | 'POLA_SEDERHANA';
export const POLICY_MESSAGE: Record<PolicyIssue, string> = {
  PENDEK: `Password minimal ${PASSWORD_MIN} karakter.`,
  PANJANG: `Password maksimal ${PASSWORD_MAX} karakter.`,
  UMUM: 'Password terlalu umum. Pilih yang lebih sulit ditebak.',
  SAMA_DENGAN_NOMOR: 'Password tidak boleh sama dengan nomor HP.',
  POLA_SEDERHANA: 'Password terlalu sederhana (karakter berulang atau berurutan).',
};

/** null = lolos. `phone` = nomor ternormalisasi (62...) untuk larangan "password = nomor HP". */
export function checkPassword(password: string, phone: string): PolicyIssue | null {
  if (password.length < PASSWORD_MIN) return 'PENDEK';
  if (password.length > PASSWORD_MAX) return 'PANJANG';
  const low = password.toLowerCase();
  if (COMMON.has(low)) return 'UMUM';
  const digits = password.replace(/\D/g, '');
  if (phone && (digits === phone || (digits.length >= 9 && phone.endsWith(digits.replace(/^0/, ''))))) return 'SAMA_DENGAN_NOMOR';
  if (new Set(low).size <= 2) return 'POLA_SEDERHANA';
  if (/^[a-z]+$/.test(low) || /^\d+$/.test(low)) {
    let step = true;
    for (let i = 1; i < low.length; i++) if (low.charCodeAt(i) - low.charCodeAt(i - 1) !== 1) { step = false; break; }
    if (step) return 'POLA_SEDERHANA';
  }
  return null;
}
