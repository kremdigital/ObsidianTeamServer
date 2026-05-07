import { jwtVerify, errors as joseErrors } from 'jose';
import type { UserRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

function getSecret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): Uint8Array {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return new TextEncoder().encode(value);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret('JWT_SECRET'));
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      return null;
    }
    return { sub: payload.sub, role: payload.role as UserRole, type: 'access' };
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      return null;
    }
    throw err;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret('JWT_REFRESH_SECRET'));
    if (
      payload.type !== 'refresh' ||
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      return null;
    }
    return { sub: payload.sub, jti: payload.jti, type: 'refresh' };
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      return null;
    }
    throw err;
  }
}
