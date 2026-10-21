import { redact } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';

/** Log terstruktur satu baris JSON (cocok untuk log drain). Semua field melewati redaksi. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: redact(msg), ...(redact(fields) as object) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}
export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => log('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => log('error', m, f),
};
