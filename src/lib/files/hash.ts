import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

export async function sha256OfStream(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function sha256OfFile(absolutePath: string): Promise<string> {
  return sha256OfStream(createReadStream(absolutePath));
}

export function sha256OfBuffer(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}
