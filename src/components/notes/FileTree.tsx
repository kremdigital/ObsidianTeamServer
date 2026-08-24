'use client';

import { type MouseEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  FilePlusIcon,
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteFile, TreeNode } from '@/lib/notes/types';
import { buildTree } from '@/lib/notes/tree';

/** Что выбрано правой кнопкой: файл или папка. */
export type MenuTarget = { kind: 'file'; file: NoteFile } | { kind: 'folder'; path: string };

/**
 * Пункты меню, каждый — необязательный: набор зависит от прав. У читателя
 * (VIEWER) остаётся одно «Скачать папку», и меню не должно превращаться в
 * список недоступных действий.
 */
export interface FileTreeActions {
  /** Создать заметку в папке (для файла — в папке, где он лежит). */
  onCreateNote?: (folderPath: string) => void;
  onRename?: (target: MenuTarget) => void;
  onDelete?: (target: MenuTarget) => void;
  /** Скачивание доступно только у папок. */
  onDownloadFolder?: (folderPath: string) => void;
}

export interface FileTreeLabels {
  createNote: string;
  rename: string;
  delete: string;
  downloadFolder: string;
}

interface FileTreeProps {
  files: NoteFile[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: NoteFile) => void;
  /**
   * Действия контекстного меню. Не передаются — меню не появляется вовсе:
   * у читателя (VIEWER) правый клик должен вести себя как обычно в браузере.
   */
  actions?: FileTreeActions;
  labels?: FileTreeLabels;
}

/** Папка, в которой лежит файл. Для файла в корне — пустая строка. */
function parentFolder(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * Obsidian-style file explorer: folders (collapsible) before files, each
 * level indented. Purely presentational — expansion state and the current
 * selection are owned by the parent so deep-linking can drive them.
 *
 * Правый клик открывает контекстное меню: на папке — создать заметку,
 * переименовать, скачать, удалить; на файле — то же без скачивания. Сами
 * операции выполняет родитель, дерево лишь сообщает о выборе.
 */
export function FileTree({
  files,
  selectedId,
  expanded,
  onToggleFolder,
  onSelectFile,
  actions,
  labels,
}: FileTreeProps): ReactElement {
  const tree = useMemo(() => buildTree(files), [files]);
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);

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

  // Меню без единого доступного пункта не показываем: пустая рамка вместо
  // штатного меню браузера — хуже, чем его отсутствие.
  const hasItems = (target: MenuTarget): boolean =>
    Boolean(
      actions &&
      (actions.onCreateNote ??
        actions.onRename ??
        actions.onDelete ??
        (target.kind === 'folder' ? actions.onDownloadFolder : undefined)),
    );

  const openMenu = (e: MouseEvent, target: MenuTarget): void => {
    if (!hasItems(target)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  if (tree.length === 0) {
    return <p className="text-muted-foreground px-2 py-1.5 text-sm">—</p>;
  }

  const target = menu?.target;
  const folderForCreate =
    target?.kind === 'folder' ? target.path : target ? parentFolder(target.file.path) : '';

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
            onContextMenu={actions ? openMenu : undefined}
          />
        ))}
      </ul>
      {menu && actions && labels && (
        <div
          role="menu"
          className="bg-popover text-popover-foreground fixed z-50 min-w-48 rounded-md border p-1 shadow-md"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.onCreateNote && (
            <MenuItem
              icon={<FilePlusIcon className="size-4 shrink-0" />}
              label={labels.createNote}
              onClick={() => {
                actions.onCreateNote?.(folderForCreate);
                setMenu(null);
              }}
            />
          )}
          {actions.onRename && (
            <MenuItem
              icon={<PencilIcon className="size-4 shrink-0" />}
              label={labels.rename}
              onClick={() => {
                actions.onRename?.(menu.target);
                setMenu(null);
              }}
            />
          )}
          {menu.target.kind === 'folder' && actions.onDownloadFolder && (
            <MenuItem
              icon={<DownloadIcon className="size-4 shrink-0" />}
              label={labels.downloadFolder}
              onClick={() => {
                const path = menu.target.kind === 'folder' ? menu.target.path : '';
                actions.onDownloadFolder?.(path);
                setMenu(null);
              }}
            />
          )}
          {actions.onDelete && (
            <MenuItem
              icon={<Trash2Icon className="size-4 shrink-0" />}
              label={labels.delete}
              destructive
              onClick={() => {
                actions.onDelete?.(menu.target);
                setMenu(null);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactElement;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        destructive && 'text-destructive',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: NoteFile) => void;
  onContextMenu?: ((e: MouseEvent, target: MenuTarget) => void) | undefined;
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  onToggleFolder,
  onSelectFile,
  onContextMenu,
}: TreeRowProps): ReactElement {
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.kind === 'folder') {
    const isOpen = expanded.has(node.path);
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          onContextMenu={
            onContextMenu ? (e) => onContextMenu(e, { kind: 'folder', path: node.path }) : undefined
          }
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
                onContextMenu={onContextMenu}
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
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, { kind: 'file', file: node.file }) : undefined
        }
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
