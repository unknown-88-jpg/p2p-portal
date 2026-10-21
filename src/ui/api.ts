export interface ApiError { code: string; message: string; requestId?: string; retryAfterSec?: number; fields?: Record<string, string> }

export interface ApiInit { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }

/** fetch JSON ke /api. Mengembalikan data atau melempar ApiError (pesan aman ditampilkan; sertakan requestId untuk laporan).
 *  Kegagalan jaringan (tidak ada respons) dilempar apa adanya (TypeError) - pemanggil bisa membedakannya dari penolakan server lewat `isApiError`. */
export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'POST',
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
    signal: init?.signal,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: ApiError } & T;
  if (!res.ok) {
    const e = json.error ?? { code: 'INTERNAL', message: 'Terjadi kesalahan.' };
    throw { ...e, retryAfterSec: Number(res.headers.get('retry-after') ?? 0) || undefined } satisfies ApiError;
  }
  return json;
}
/** true = server MENJAWAB dengan error (hasilnya pasti: aksi tidak berlaku). false = jaringan putus/timeout (hasil AMBIGU: aksi mungkin sudah berlaku). */
export const isApiError = (e: unknown): e is ApiError => !!e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string';
export const errMessage = (e: unknown): string => {
  const x = e as Partial<ApiError>;
  if (x && typeof x.message === 'string') return x.requestId && x.code === 'INTERNAL' ? `${x.message} (ref: ${x.requestId.slice(0, 8)})` : x.message;
  return 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.';
};
