/**
 * Shared types for the read-only note browser (Obsidian-style markdown
 * preview). These mirror the subset of `VaultFile` fields the UI needs.
 */

export interface NoteFile {
  id: string;
  /** Vault-relative POSIX path, e.g. `folder/Sub/Note.md`. */
  path: string;
  fileType: 'TEXT' | 'BINARY';
  mimeType: string | null;
}

/** A folder node in the rendered tree. */
export interface TreeFolder {
  kind: 'folder';
  name: string;
  /** Vault-relative path of the folder itself, e.g. `folder/Sub`. */
  path: string;
  children: TreeNode[];
}

/** A file leaf in the rendered tree. */
export interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
  file: NoteFile;
}

export type TreeNode = TreeFolder | TreeFile;
