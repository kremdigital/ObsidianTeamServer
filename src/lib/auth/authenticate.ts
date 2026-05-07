import type { UserRole } from '@prisma/client';
import { authenticateApiKey } from './api-key-middleware';
import { getCurrentUser } from './session';

export interface AuthenticatedActor {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * Authenticate an incoming API request via either:
 *  1. `X-API-Key` header (full DB user lookup), or
 *  2. session cookie / Authorization Bearer access token.
 */
export async function authenticateRequest(request: Request): Promise<AuthenticatedActor | null> {
  const apiKeyAuth = await authenticateApiKey(request);
  if (apiKeyAuth) {
    return {
      id: apiKeyAuth.user.id,
      email: apiKeyAuth.user.email,
      name: apiKeyAuth.user.name,
      role: apiKeyAuth.user.role,
    };
  }

  const sessionUser = await getCurrentUser();
  if (sessionUser) {
    return {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      role: sessionUser.role,
    };
  }
  return null;
}

export function getMaxFileSize(): number | null {
  const raw = process.env.MAX_FILE_SIZE;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
