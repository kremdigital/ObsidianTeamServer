'use client';

import { type MouseEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
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
  /** When provided, folders gain a right-click "download folder" action. */
  onDownloadFolder?: (folderPath: string) => void;
  downloadLabel?: string;
}

/**
 * Obsidian-style file explorer: folders (collapsible) before files, each
 * level indented. Purely presentational — expansion state and the current
 * selection are owned by the parent so deep-linking can drive them. Folders
 * also expose a right-click "download folder" action when a handler is given.
 */
export function FileTree({
  files,
  selectedId,
  expanded,
  onToggleFolder,
  onSelectFile,
  onDownloadFolder,
  downloadLabel,
}: FileTreeProps): ReactElement {
  const tree = useMemo(() => buildTree(files), [files]);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // Dismiss the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const onFolderContextMenu = (e: MouseEvent, path: string): void => {
    if (!onDownloadFolder) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path });
  };

  if (tree.length === 0) {
    return <p className="text-muted-foreground px-2 py-1.5 text-sm">—</p>;
  }

  return (
    <>
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
            onFolderContextMenu={onDownloadFolder ? onFolderContextMenu : undefined}
          />
        ))}
      </ul>
      {menu && onDownloadFolder && (
        <div
          role="menu"
          className="bg-popover text-popover-foreground fixed z-50 min-w-44 rounded-md border p-1 shadow-md"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDownloadFolder(menu.path);
              setMenu(null);
            }}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
          >
            <DownloadIcon className="size-4 shrink-0" />
            <span className="truncate">{downloadLabel ?? 'Download folder'}</span>
          </button>
        </div>
      )}
    </>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: NoteFile) => void;
  onFolderContextMenu?: ((e: MouseEvent, path: string) => void) | undefined;
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  onToggleFolder,
  onSelectFile,
  onFolderContextMenu,
}: TreeRowProps): ReactElement {
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.kind === 'folder') {
    const isOpen = expanded.has(node.path);
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          onContextMenu={onFolderContextMenu ? (e) => onFolderContextMenu(e, node.path) : undefined}
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
                onFolderContextMenu={onFolderContextMenu}
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
