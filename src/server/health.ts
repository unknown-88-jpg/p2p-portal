import { SCHEMAS } from '@/repo/schema';
import { validateHeader, overallWritable, type HeaderReport } from '@/repo/header-validator';
import { assertSheetAllowed, readHeaderRows } from '@/infra/google';
import { env } from '@/lib/env';

export interface HealthResult { appEnv: string; sheetGuard: 'ok'; writable: boolean; headers: HeaderReport[] }

export async function runHealth(): Promise<HealthResult> {
  await assertSheetAllowed();
  const rows = await readHeaderRows(SCHEMAS.map((s) => s.tab));
  const headers = SCHEMAS.map((s) => validateHeader(s, rows[s.tab] ?? null));
  return { appEnv: env().APP_ENV, sheetGuard: 'ok', writable: overallWritable(headers), headers };
}
