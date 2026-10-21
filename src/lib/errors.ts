// Format error seragam (design 6): { error: { code, message, requestId, fields? } }
export type ErrorCode =
  | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RULE_VIOLATION' | 'RATE_LIMITED' | 'UPSTREAM_BUSY' | 'READ_ONLY' | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  RULE_VIOLATION: 422, RATE_LIMITED: 429, UPSTREAM_BUSY: 503, READ_ONLY: 503, INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
  get status(): number { return STATUS_BY_CODE[this.code]; }
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function errorBody(e: unknown, requestId: string): { status: number; body: unknown; headers: Record<string, string> } {
  if (e instanceof AppError) {
    const headers: Record<string, string> = {};
    if (e.retryAfterSec) headers['retry-after'] = String(e.retryAfterSec);
    return { status: e.status, headers, body: { error: { code: e.code, message: e.message, requestId, fields: e.fields } } };
  }
  // Error tak dikenal: jangan bocorkan detail ke klien.
  return { status: 500, headers: {}, body: { error: { code: 'INTERNAL', message: 'Terjadi kesalahan. Sebutkan requestId ke admin.', requestId } } };
}
