// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { sha256OfBuffer, sha256OfStream } from './hash';

describe('sha256', () => {
  it('hashes a buffer', () => {
    expect(sha256OfBuffer(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('streams produce the same hash as the buffer variant', async () => {
    const data = Buffer.from('streaming content');
    const stream = Readable.from([data.subarray(0, 4), data.subarray(4)]);
    expect(await sha256OfStream(stream)).toBe(sha256OfBuffer(data));
  });
});
