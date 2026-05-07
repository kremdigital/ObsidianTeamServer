import type { User } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { extractPrefix, isWellFormedApiKey, verifyApiKey } from './api-key';

export const API_KEY_HEADER = 'x-api-key';

export interface ApiKeyAuthResult {
  user: User;
  apiKeyId: string;
}

/**
 * Read `X-API-Key` from a request, look up the matching key by prefix and verify
 * via bcrypt. Returns the owning user on success or null otherwise.
 *
 * Side effect: bumps `lastUsedAt` on the key when the verification succeeds.
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyAuthResult | null> {
  const raw = request.headers.get(API_KEY_HEADER);
  if (!raw) return null;
  const plain = raw.trim();
  if (!isWellFormedApiKey(plain)) return null;

  const prefix = extractPrefix(plain);
  const candidates = await prisma.apiKey.findMany({
    where: {
      keyPrefix: prefix,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { user: true },
  });

  for (const candidate of candidates) {
    if (await verifyApiKey(plain, candidate.keyHash)) {
      await prisma.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      });
      return { user: candidate.user, apiKeyId: candidate.id };
    }
  }

  return null;
}
