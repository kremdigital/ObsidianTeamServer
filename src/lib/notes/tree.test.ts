import { describe, expect, it } from 'vitest';
import { buildTree, ancestorFolderPaths } from './tree';
import type { NoteFile, TreeFolder } from './types';

function f(id: string, path: string): NoteFile {
  return { id, path, fileType: 'TEXT', mimeType: null };
}

describe('buildTree', () => {
  it('nests files under their folders', () => {
    const tree = buildTree([f('1', 'a/b/c.md'), f('2', 'a/d.md'), f('3', 'top.md')]);
    // Root: folder "a" then file "top.md" (folders before files).
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['folder:a', 'file:top.md']);

    const a = tree[0] as TreeFolder;
    expect(a.children.map((n) => `${n.kind}:${n.name}`)).toEqual(['folder:b', 'file:d.md']);

    const b = a.children[0] as TreeFolder;
    expect(b.children.map((n) => `${n.kind}:${n.name}`)).toEqual(['file:c.md']);
  });

  it('sorts folders before files and alphabetically within a group', () => {
    const tree = buildTree([
      f('1', 'zeta.md'),
      f('2', 'Alpha.md'),
      f('3', 'mid/x.md'),
      f('4', 'Beta/y.md'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Beta', 'mid', 'Alpha.md', 'zeta.md']);
  });

  it('records folder paths', () => {
    const tree = buildTree([f('1', 'a/b/c.md')]);
    const a = tree[0] as TreeFolder;
    expect(a.path).toBe('a');
    expect((a.children[0] as TreeFolder).path).toBe('a/b');
  });

  it('ignores empty input', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('ancestorFolderPaths', () => {
  it('lists every containing folder', () => {
    expect(ancestorFolderPaths('a/b/c.md')).toEqual(['a', 'a/b']);
  });
  it('is empty for a root file', () => {
    expect(ancestorFolderPaths('top.md')).toEqual([]);
  });
});
