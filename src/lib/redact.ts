// Redaksi untuk log (design 5.7, R-34): nomor HP, JID WA, no. rekening/NPWP, password/kode/OTP, URL sesi upload, messageSecret.
const SENSITIVE_KEY = /pass(word)?|secret|token|otp|kode|code|hash|salt|authorization|cookie|rekening|npwp|no_?hp|phone|nomor|jid|remotejid|session_?url|upload_?url|api_?key/i;

const PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b\d{5,}@(s\.whatsapp\.net|lid|c\.us)\b/gi, '[redacted-jid]'],
  [/https:\/\/www\.googleapis\.com\/upload\/[^\s"']*upload_id=[^\s"']*/gi, '[redacted-upload-session]'],
  [/(\+?62|0)8\d{7,12}\b/g, '[redacted-phone]'],
  [/\b\d{8,20}\b/g, '[redacted-number]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
];

export function redactString(s: string): string {
  return PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return '[unserializable]';
}
