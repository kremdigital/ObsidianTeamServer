import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('hashes a password and verifies it', async () => {
    const hash = await hashPassword('MyPassword!');
    expect(hash).not.toBe('MyPassword!');
    expect(hash.length).toBeGreaterThan(20);
    expect(await verifyPassword('MyPassword!', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('MyPassword!');
    expect(await verifyPassword('Wrong', hash)).toBe(false);
  });
});
