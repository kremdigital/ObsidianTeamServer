import type { NoteFile, TreeFolder, TreeNode } from './types';

/**
 * Builds a nested folder tree from a flat list of vault files, the way
 * Obsidian's file explorer presents them. Folders sort before files, and
 * each group is sorted case-insensitively by name.
 */
export function buildTree(files: NoteFile[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    let cursor = root;
    // Walk (creating as needed) every segment except the last (the file).
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      const folderPath = segments.slice(0, i + 1).join('/');
      let next = cursor.children.find(
        (c): c is TreeFolder => c.kind === 'folder' && c.name === name,
      );
      if (!next) {
        next = { kind: 'folder', name, path: folderPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }

    const fileName = segments[segments.length - 1]!;
    // Guard against a folder and file colliding on the same name slot.
    if (!cursor.children.some((c) => c.kind === 'file' && c.name === fileName)) {
      cursor.children.push({ kind: 'file', name: fileName, path: file.path, file });
    }
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  for (const node of nodes) {
    if (node.kind === 'folder') sortTree(node.children);
  }
}

/** Collects the paths of every folder that contains (eventually) the file. */
export function ancestorFolderPaths(filePath: string): string[] {
  const segments = filePath.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    out.push(segments.slice(0, i).join('/'));
  }
  return out;
}
