import { describe, expect, it } from 'vitest';

describe('vitest sanity', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2);
  });

  it('async assertions work', async () => {
    const value = await Promise.resolve('ok');
    expect(value).toBe('ok');
  });
});
