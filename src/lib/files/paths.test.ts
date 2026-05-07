// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { InvalidPathError, normalizeVaultPath, resolveProjectFile } from './paths';

describe('normalizeVaultPath', () => {
  it('accepts simple paths', () => {
    expect(normalizeVaultPath('note.md')).toBe('note.md');
    expect(normalizeVaultPath('folder/sub/file.md')).toBe('folder/sub/file.md');
  });

  it('normalizes Windows separators and double slashes', () => {
    expect(normalizeVaultPath('folder\\sub\\file.md')).toBe('folder/sub/file.md');
    expect(normalizeVaultPath('a//b///c')).toBe('a/b/c');
  });

  it('rejects parent traversal', () => {
    expect(() => normalizeVaultPath('../etc/passwd')).toThrow(InvalidPathError);
    expect(() => normalizeVaultPath('a/../../b')).toThrow(InvalidPathError);
    expect(() => normalizeVaultPath('a/..')).toThrow(InvalidPathError);
  });

  it('rejects absolute paths', () => {
    expect(() => normalizeVaultPath('/etc/passwd')).toThrow(InvalidPathError);
  });

  it('rejects NUL bytes', () => {
    expect(() => normalizeVaultPath('a\0b')).toThrow(InvalidPathError);
  });

  it('rejects reserved .versions folder', () => {
    expect(() => normalizeVaultPath('.versions/x')).toThrow(InvalidPathError);
    expect(() => normalizeVaultPath('a/.versions/b')).toThrow(InvalidPathError);
  });

  it('rejects empty input', () => {
    expect(() => normalizeVaultPath('')).toThrow(InvalidPathError);
    expect(() => normalizeVaultPath('/')).toThrow(InvalidPathError);
  });
});

describe('resolveProjectFile', () => {
  it('produces a path inside the project root', () => {
    process.env.STORAGE_PATH = '/tmp/storage';
    const resolved = resolveProjectFile('proj-1', 'note.md');
    expect(resolved.replaceAll('\\', '/')).toContain('proj-1/note.md');
  });

  it('refuses traversal even after normalization', () => {
    process.env.STORAGE_PATH = '/tmp/storage';
    expect(() => resolveProjectFile('proj-1', '../../etc/passwd')).toThrow(InvalidPathError);
  });
});
