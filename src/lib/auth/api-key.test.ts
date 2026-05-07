// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractPrefix, generateApiKey, isWellFormedApiKey, verifyApiKey } from './api-key';

describe('api-key generation', () => {
  it('generates a key with the osync_ prefix and 64 hex characters', async () => {
    const { plain, hash, prefix } = await generateApiKey();

    expect(plain).toMatch(/^osync_[0-9a-f]{64}$/);
    expect(plain).toHaveLength(70);
    expect(prefix).toBe(plain.slice(0, 12));
    expect(prefix.startsWith('osync_')).toBe(true);
    expect(hash).not.toBe(plain);
    expect(hash.length).toBeGreaterThan(20);
  });

  it('two generated keys are different', async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();
    expect(a.plain).not.toBe(b.plain);
  });

  it('verifyApiKey returns true for the matching plain/hash pair', async () => {
    const k = await generateApiKey();
    expect(await verifyApiKey(k.plain, k.hash)).toBe(true);
    expect(await verifyApiKey('osync_' + 'a'.repeat(64), k.hash)).toBe(false);
  });

  it('extractPrefix returns first 12 characters', () => {
    expect(extractPrefix('osync_abcdef0123456789')).toBe('osync_abcdef');
  });

  it('isWellFormedApiKey accepts valid format and rejects garbage', () => {
    expect(isWellFormedApiKey('osync_' + 'a'.repeat(64))).toBe(true);
    expect(isWellFormedApiKey('osync_short')).toBe(false);
    expect(isWellFormedApiKey('not-an-osync-key')).toBe(false);
    expect(isWellFormedApiKey('osync_' + 'A'.repeat(64))).toBe(false); // hex must be lowercase
  });
});
