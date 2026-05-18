import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { UserRole } from '@prisma/client';

export type { AccessTokenPayload, RefreshTokenPayload } from './jwt-verify';
export { verifyAccessToken, verifyRefreshToken } from './jwt-verify';

// Read TTLs lazily on every call rather than at module import. Lets
// tests flip `process.env.JWT_*_TTL` between cases without resorting to
// module-cache invalidation, and matches the rest of the codebase's
// pattern of reading config straight from env.
function accessTtl(): string {
  return process.env.JWT_ACCESS_TTL ?? '15m';
}
function refreshTtl(): string {
  return process.env.JWT_REFRESH_TTL ?? '30d';
}
/**
 * TTL used for both the access JWT and its cookie when the user opted
 * into "Remember me" on the login form. Matches the refresh window by
 * default so the user stays signed in for the same period regardless of
 * which token expires first.
 */
function rememberTtl(): string {
  return process.env.JWT_REMEMBER_TTL ?? '30d';
}

function getSecret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): Uint8Array {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return new TextEncoder().encode(value);
}

export async function signAccessToken(
  userId: string,
  role: UserRole,
  options: { rememberMe?: boolean } = {},
): Promise<string> {
  const ttl = options.rememberMe ? rememberTtl() : accessTtl();
  return new SignJWT({ role, type: 'access', rememberMe: options.rememberMe === true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getSecret('JWT_SECRET'));
}

export function getAccessTtlSeconds(rememberMe: boolean): number {
  return parseTtlToSeconds(rememberMe ? rememberTtl() : accessTtl());
}

export interface IssuedRefresh {
  token: string;
  jti: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function signRefreshToken(userId: string): Promise<IssuedRefresh> {
  const jti = randomUUID();
  const ttlSeconds = parseTtlToSeconds(refreshTtl());
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const token = await new SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret('JWT_REFRESH_SECRET'));

  return { token, jti, tokenHash: hashJti(jti), expiresAt };
}

export function hashJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex');
}

function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(ttl.trim());
  if (!match) {
    throw new Error(`Invalid TTL format: ${ttl}. Expected like "15m", "30d", "12h", "60s".`);
  }
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 0;
  return value * multiplier;
}

export function getRefreshTtlSeconds(): number {
  return parseTtlToSeconds(refreshTtl());
}
