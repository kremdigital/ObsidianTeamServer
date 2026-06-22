import { isAbsolute, join, normalize, relative, sep } from 'node:path';

export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPathError';
  }
}

const FORBIDDEN_NAMES = new Set(['.versions', '.staging']);

/** A content hash must be a bare 64-char lowercase hex string — used as a
 *  filename in the staging area, so it must never contain path separators. */
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Normalize and validate a vault-relative file path.
 *
 * - rejects absolute paths, NUL bytes, names with `..`
 * - converts Windows separators to forward slashes
 * - rejects empty segments and reserved folder names (`.versions`)
 */
export function normalizeVaultPath(input: string): string {
  if (input.includes('\0')) {
    throw new InvalidPathError('Path contains NUL byte');
  }
  if (isAbsolute(input)) {
    throw new InvalidPathError('Absolute paths are not allowed');
  }

  // Use posix-style normalization on the input.
  const normalized = normalize(input).replaceAll('\\', '/');
  if (normalized.startsWith('/')) {
    throw new InvalidPathError('Absolute paths are not allowed');
  }

  const segments = normalized.split('/').filter((s) => s.length > 0);
  for (const segment of segments) {
    if (segment === '..') throw new InvalidPathError('Parent traversal is not allowed');
    if (segment === '.') throw new InvalidPathError('Single-dot segments are not allowed');
    if (FORBIDDEN_NAMES.has(segment)) {
      throw new InvalidPathError(`Reserved folder name: ${segment}`);
    }
    if (segment.length > 255) throw new InvalidPathError('Path segment too long');
  }
  if (segments.length === 0) throw new InvalidPathError('Empty path');

  return segments.join('/');
}

export function getStorageRoot(): string {
  return process.env.STORAGE_PATH ?? './storage';
}

/**
 * Resolve a project-relative file path into an absolute filesystem path,
 * guaranteeing the result stays within the project directory.
 */
export function resolveProjectFile(projectId: string, vaultPath: string): string {
  const safe = normalizeVaultPath(vaultPath);
  const root = join(getStorageRoot(), projectId);
  const target = join(root, ...safe.split('/'));

  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new InvalidPathError('Path escapes project root');
  }
  return target;
}

export function getProjectRoot(projectId: string): string {
  return join(getStorageRoot(), projectId);
}

export function getVersionPath(projectId: string, fileId: string, versionNumber: number): string {
  return join(getProjectRoot(projectId), '.versions', fileId, `${versionNumber}.snapshot`);
}

/**
 * Resolve the staging path for a content-addressed binary blob.
 *
 * Large binary files are uploaded out-of-band over REST into
 * `<projectRoot>/.staging/<contentHash>` and then referenced by a metadata-only
 * `file:create` / `file:update-binary` socket event — keeping multi-megabyte
 * payloads off the Socket.IO channel (which is sized for tiny Yjs ops). The
 * socket handler and the REST process share the storage volume, so the blob
 * written by REST is readable by the socket process by hash.
 */
export function getStagingPath(projectId: string, contentHash: string): string {
  if (!SHA256_HEX.test(contentHash)) {
    throw new InvalidPathError('Invalid content hash');
  }
  return join(getProjectRoot(projectId), '.staging', contentHash);
}
