import { NextResponse, type NextRequest } from 'next/server';

/** Header keamanan + CSP ber-nonce (design 5.3). Berjalan untuk halaman (bukan /api, aset statis). */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // M4c: browser mem-PUT lampiran LANGSUNG ke URL sesi resumable Drive (design 4.6/O11). Hanya host itu yang dibuka, tidak wildcard googleapis.
    "connect-src 'self' https://www.googleapis.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  res.headers.set('x-frame-options', 'DENY');
  res.headers.set('cross-origin-opener-policy', 'same-origin');
  res.headers.set('cross-origin-resource-policy', 'same-origin');
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'no-referrer'); // token set-password ada di URL: jangan bocor lewat Referer
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (!dev) res.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  return res;
}

export const config = {
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
