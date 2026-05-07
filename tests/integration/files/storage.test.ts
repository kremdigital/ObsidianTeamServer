import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteProjectFile,
  getProjectFileStat,
  hashProjectFile,
  listProjectFiles,
  moveProjectFile,
  writeProjectFile,
  writeVersionSnapshot,
} from '@/lib/files/storage';
import { InvalidPathError } from '@/lib/files/paths';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-storage-'));
  originalStoragePath = process.env.STORAGE_PATH;
  process.env.STORAGE_PATH = storageRoot;
});

afterAll(async () => {
  if (originalStoragePath !== undefined) {
    process.env.STORAGE_PATH = originalStoragePath;
  } else {
    delete process.env.STORAGE_PATH;
  }
  await rm(storageRoot, { recursive: true, force: true });
});

describe('writeProjectFile', () => {
  it('writes data atomically and reports size + hash', async () => {
    const data = Buffer.from('hello\n');
    const result = await writeProjectFile('proj-a', 'note.md', data);
    expect(result.size).toBe(data.byteLength);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const onDisk = await readFile(join(storageRoot, 'proj-a', 'note.md'));
    expect(onDisk.toString('utf8')).toBe('hello\n');

    const stat = await getProjectFileStat('proj-a', 'note.md');
    expect(stat?.size).toBe(data.byteLength);

    expect(await hashProjectFile('proj-a', 'note.md')).toBe(result.contentHash);
  });

  it('creates nested folders as needed', async () => {
    await writeProjectFile('proj-a', 'folder/deep/inside.txt', Buffer.from('x'));
    expect(await getProjectFileStat('proj-a', 'folder/deep/inside.txt')).not.toBeNull();
  });

  it('refuses path traversal', async () => {
    await expect(writeProjectFile('proj-a', '../escape', Buffer.from('x'))).rejects.toThrow(
      InvalidPathError,
    );
  });

  it('refuses absolute paths', async () => {
    await expect(writeProjectFile('proj-a', '/etc/passwd', Buffer.from('x'))).rejects.toThrow(
      InvalidPathError,
    );
  });
});

describe('moveProjectFile / deleteProjectFile', () => {
  it('moves a file and the old path stops existing', async () => {
    await writeProjectFile('proj-b', 'old.md', Buffer.from('1'));
    await moveProjectFile('proj-b', 'old.md', 'sub/new.md');
    expect(await getProjectFileStat('proj-b', 'old.md')).toBeNull();
    expect(await getProjectFileStat('proj-b', 'sub/new.md')).not.toBeNull();
  });

  it('delete is idempotent (no-op when file is missing)', async () => {
    await deleteProjectFile('proj-b', 'never-existed.md');
    await deleteProjectFile('proj-b', 'never-existed.md');
    expect(await getProjectFileStat('proj-b', 'never-existed.md')).toBeNull();
  });
});

describe('listProjectFiles', () => {
  it('lists everything under the project, excluding .versions', async () => {
    await writeProjectFile('proj-c', 'a.md', Buffer.from('a'));
    await writeProjectFile('proj-c', 'sub/b.md', Buffer.from('b'));
    await writeVersionSnapshot('proj-c', 'file-x', 1, Buffer.from('snap'));

    const list = await listProjectFiles('proj-c');
    const paths = list.map((f) => f.path).sort();
    expect(paths).toEqual(['a.md', 'sub/b.md']);
  });
});
