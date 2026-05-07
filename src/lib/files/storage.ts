import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { getProjectRoot, getVersionPath, resolveProjectFile } from './paths';
import { sha256OfBuffer, sha256OfFile } from './hash';

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export interface ListedFile {
  /** Vault-relative path with forward slashes. */
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Atomically write a file (write to temp + rename). Creates parent dirs as needed.
 */
export async function writeProjectFile(
  projectId: string,
  vaultPath: string,
  data: Buffer | Uint8Array,
): Promise<{ size: number; contentHash: string }> {
  const target = resolveProjectFile(projectId, vaultPath);
  await mkdir(dirname(target), { recursive: true });

  const tempPath = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, data);
  try {
    await rename(tempPath, target);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }

  return { size: data.byteLength, contentHash: sha256OfBuffer(data) };
}

export function readProjectFileStream(projectId: string, vaultPath: string): ReadStream {
  const target = resolveProjectFile(projectId, vaultPath);
  return createReadStream(target);
}

export async function getProjectFileStat(
  projectId: string,
  vaultPath: string,
): Promise<FileStat | null> {
  const target = resolveProjectFile(projectId, vaultPath);
  try {
    const s = await stat(target);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteProjectFile(projectId: string, vaultPath: string): Promise<void> {
  const target = resolveProjectFile(projectId, vaultPath);
  await unlink(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

export async function moveProjectFile(
  projectId: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const src = resolveProjectFile(projectId, fromPath);
  const dst = resolveProjectFile(projectId, toPath);
  if (src === dst) return;
  await mkdir(dirname(dst), { recursive: true });
  await rename(src, dst);
}

export async function listProjectFiles(projectId: string): Promise<ListedFile[]> {
  const root = getProjectRoot(projectId);
  const result: ListedFile[] = [];

  async function walk(absDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name === '.versions') continue;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const s = await stat(abs);
        const rel = relative(root, abs).split(sep).join('/');
        result.push({ path: rel, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }

  await walk(root);
  return result;
}

/** Compute SHA-256 of a project file (streaming, suitable for large files). */
export async function hashProjectFile(projectId: string, vaultPath: string): Promise<string> {
  return sha256OfFile(resolveProjectFile(projectId, vaultPath));
}

/**
 * Snapshot the current file content into `.versions/<fileId>/<versionNumber>.snapshot`.
 */
export async function writeVersionSnapshot(
  projectId: string,
  fileId: string,
  versionNumber: number,
  data: Buffer | Uint8Array,
): Promise<string> {
  const target = getVersionPath(projectId, fileId, versionNumber);
  await mkdir(dirname(target), { recursive: true });
  const tempPath = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, data);
  try {
    await rename(tempPath, target);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
  // Return path relative to the storage root for portability.
  return relative(getProjectRoot(projectId), target).split(sep).join('/');
}

export function readVersionSnapshotStream(
  projectId: string,
  fileId: string,
  versionNumber: number,
): ReadStream {
  return createReadStream(getVersionPath(projectId, fileId, versionNumber));
}
