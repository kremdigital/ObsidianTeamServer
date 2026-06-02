'use client';

import { type ReactElement, useMemo } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FolderIcon,
  FolderOpenIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteFile, TreeNode } from '@/lib/notes/types';
import { buildTree } from '@/lib/notes/tree';

interface FileTreeProps {
  files: NoteFile[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: NoteFile) => void;
}

/**
 * Obsidian-style file explorer: folders (collapsible) before files, each
 * level indented. Purely presentational — expansion state and the current
 * selection are owned by the parent so deep-linking can drive them.
 */
export function FileTree({
  files,
  selectedId,
  expanded,
  onToggleFolder,
  onSelectFile,
}: FileTreeProps): ReactElement {
  const tree = useMemo(() => buildTree(files), [files]);

  if (tree.length === 0) {
    return <p className="text-muted-foreground px-2 py-1.5 text-sm">—</p>;
  }

  return (
    <ul className="select-none">
      {tree.map((node) => (
        <TreeRow
          key={node.path || node.name}
          node={node}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          onToggleFolder={onToggleFolder}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: NoteFile) => void;
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  onToggleFolder,
  onSelectFile,
}: TreeRowProps): ReactElement {
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.kind === 'folder') {
    const isOpen = expanded.has(node.path);
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="hover:bg-accent flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm"
          style={indent}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0" />
          )}
          {isOpen ? (
            <FolderOpenIcon className="size-4 shrink-0 text-sky-500/80" />
          ) : (
            <FolderIcon className="size-4 shrink-0 text-sky-500/80" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && (
          <ul>
            {node.children.map((child) => (
              <TreeRow
                key={child.path || child.name}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                expanded={expanded}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = node.file.id === selectedId;
  const label = node.name.replace(/\.md$/i, '');
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile(node.file)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm',
          isSelected ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60',
        )}
        style={{ paddingLeft: `${depth * 12 + 8 + 20}px` }}
      >
        <FileGlyph file={node.file} />
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

function FileGlyph({ file }: { file: NoteFile }): ReactElement {
  if (file.fileType === 'TEXT' || /\.md$/i.test(file.path)) {
    return <FileTextIcon className="text-muted-foreground size-4 shrink-0" />;
  }
  if (file.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.path)) {
    return <ImageIcon className="text-muted-foreground size-4 shrink-0" />;
  }
  return <FileIcon className="text-muted-foreground size-4 shrink-0" />;
}
