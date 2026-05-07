import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticateApiKey, API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { generateApiKey } from '@/lib/auth/api-key';
import { resetDatabase, testPrisma } from '../db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function seedUserWithKey(opts?: { expiresAt?: Date | null }) {
  const user = await testPrisma.user.create({
    data: { email: `k-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'h', name: 'K' },
  });
  const generated = await generateApiKey();
  const apiKey = await testPrisma.apiKey.create({
    data: {
      userId: user.id,
      name: 'cli',
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      ...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    },
  });
  return { user, apiKey, plain: generated.plain };
}

function makeRequest(plain: string | null): Request {
  const headers: Record<string, string> = {};
  if (plain) headers[API_KEY_HEADER] = plain;
  return new Request('http://localhost/api/whatever', { headers });
}

describe('authenticateApiKey', () => {
  it('returns the user for a valid key and bumps lastUsedAt', async () => {
    const { user, apiKey, plain } = await seedUserWithKey();
    expect(apiKey.lastUsedAt).toBeNull();

    const result = await authenticateApiKey(makeRequest(plain));
    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(user.id);
    expect(result?.apiKeyId).toBe(apiKey.id);

    const updated = await testPrisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(updated?.lastUsedAt).not.toBeNull();
  });

  it('returns null when header is missing', async () => {
    expect(await authenticateApiKey(makeRequest(null))).toBeNull();
  });

  it('returns null for malformed token', async () => {
    expect(await authenticateApiKey(makeRequest('not-an-osync-key'))).toBeNull();
    expect(await authenticateApiKey(makeRequest('osync_' + 'A'.repeat(64)))).toBeNull(); // wrong case
  });

  it('returns null when key was tampered with (correct prefix, wrong body)', async () => {
    const { plain } = await seedUserWithKey();
    const tampered = plain.slice(0, 12) + 'a'.repeat(58); // keep prefix, replace body
    expect(await authenticateApiKey(makeRequest(tampered))).toBeNull();
  });

  it('returns null for an expired key', async () => {
    const { plain } = await seedUserWithKey({ expiresAt: new Date(Date.now() - 1000) });
    expect(await authenticateApiKey(makeRequest(plain))).toBeNull();
  });
});
