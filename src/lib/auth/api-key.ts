import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;
const KEY_PREFIX_LENGTH = 12;
const PLAIN_PREFIX = 'osync_';

export interface GeneratedApiKey {
  /** Full key, returned to the user exactly once. */
  plain: string;
  /** Bcrypt hash to be stored in DB. */
  hash: string;
  /** First {@link KEY_PREFIX_LENGTH} characters, displayed in UI for identification. */
  prefix: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const random = randomBytes(32).toString('hex');
  const plain = `${PLAIN_PREFIX}${random}`;
  const prefix = plain.slice(0, KEY_PREFIX_LENGTH);
  const hash = await bcrypt.hash(plain, SALT_ROUNDS);
  return { plain, hash, prefix };
}

export function extractPrefix(plain: string): string {
  return plain.slice(0, KEY_PREFIX_LENGTH);
}

export function isWellFormedApiKey(plain: string): boolean {
  return /^osync_[0-9a-f]{64}$/.test(plain);
}

export function verifyApiKey(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
