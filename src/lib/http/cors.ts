import { NextResponse } from 'next/server';

/**
 * CORS for the binary-file REST routes consumed by the Obsidian plugin's
 * browser `fetch` (Origin: `app://obsidian.md`). The plugin authenticates with
 * the `X-API-Key` header — NO cookies/credentials — so we never set
 * `Access-Control-Allow-Credentials`, and reflecting a known origin (or `*` as a
 * fallback) is safe. The same-origin cookie/JWT web app is untouched: the
 * browser only applies CORS to cross-origin requests, and these helpers only
 * *add* headers, never altering status/body/cookies.
 */

const ALLOWED_ORIGINS = new Set<string>([
  'app://obsidian.md', // Obsidian desktop (Electron)
  'capacitor://localhost', // Obsidian mobile (harmless if unused)
]);

function resolveAllowOrigin(origin: string | null): string {
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  // No credentials are involved, so `*` leaks nothing — any client could
  // already call these routes with a valid X-API-Key from a non-browser.
  return '*';
}

/** Headers attached to every file-route response (real + preflight). */
export function corsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveAllowOrigin(request.headers.get('origin')),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'X-API-Key, Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/** Apply CORS headers to an existing response, returning it for chaining. */
export function withCors<T extends Response>(response: T, request: Request): T {
  for (const [k, v] of Object.entries(corsHeaders(request))) response.headers.set(k, v);
  return response;
}

/** Standard 204 preflight response for the file routes. */
export function corsPreflight(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}
