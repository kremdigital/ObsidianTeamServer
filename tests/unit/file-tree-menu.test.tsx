/**
 * Контекстное меню дерева файлов.
 *
 * Набор пунктов зависит от прав: читателю (VIEWER) приходит только скачивание,
 * и меню не должно превращаться в список действий, которые сервер отклонит.
 * Отдельно проверяем, что «Создать заметку» на файле имеет в виду папку, где
 * файл лежит, а не сам файл.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileTree, type FileTreeActions } from '@/components/notes/FileTree';
import type { NoteFile } from '@/lib/notes/types';

const files: NoteFile[] = [
  { id: 'f1', path: 'сцены/первая.md', fileType: 'TEXT', mimeType: 'text/markdown' },
  { id: 'f2', path: 'корневая.md', fileType: 'TEXT', mimeType: 'text/markdown' },
];

const labels = {
  createNote: 'Создать заметку',
  rename: 'Переименовать',
  delete: 'Удалить',
  downloadFolder: 'Скачать папку',
};

function renderTree(actions: FileTreeActions | undefined) {
  return render(
    <FileTree
      files={files}
      selectedId={null}
      expanded={new Set(['сцены'])}
      onToggleFolder={() => undefined}
      onSelectFile={() => undefined}
      {...(actions ? { actions, labels } : {})}
    />,
  );
}

const fullActions = (): FileTreeActions => ({
  onCreateNote: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onDownloadFolder: vi.fn(),
});

describe('FileTree — контекстное меню', () => {
  it('на файле показывает создание, переименование и удаление, но не скачивание', () => {
    renderTree(fullActions());
    fireEvent.contextMenu(screen.getByText('первая'));

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: labels.createNote })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: labels.rename })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: labels.delete })).toBeInTheDocument();
    // Скачивание есть только у папки — у файла для этого своя ссылка.
    expect(screen.queryByRole('menuitem', { name: labels.downloadFolder })).toBeNull();
  });

  it('на папке показывает все четыре пункта', () => {
    renderTree(fullActions());
    fireEvent.contextMenu(screen.getByText('сцены'));

    for (const label of Object.values(labels)) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });

  it('«создать заметку» на файле указывает на папку файла, а не на сам файл', () => {
    const actions = fullActions();
    renderTree(actions);

    fireEvent.contextMenu(screen.getByText('первая'));
    fireEvent.click(screen.getByRole('menuitem', { name: labels.createNote }));
    expect(actions.onCreateNote).toHaveBeenCalledWith('сцены');

    // У файла в корне папки нет — пустая строка, а не 'корневая.md'.
    fireEvent.contextMenu(screen.getByText('корневая'));
    fireEvent.click(screen.getByRole('menuitem', { name: labels.createNote }));
    expect(actions.onCreateNote).toHaveBeenLastCalledWith('');
  });

  it('переименование и удаление получают выбранную цель', () => {
    const actions = fullActions();
    renderTree(actions);

    fireEvent.contextMenu(screen.getByText('первая'));
    fireEvent.click(screen.getByRole('menuitem', { name: labels.rename }));
    expect(actions.onRename).toHaveBeenCalledWith({ kind: 'file', file: files[0] });

    fireEvent.contextMenu(screen.getByText('сцены'));
    fireEvent.click(screen.getByRole('menuitem', { name: labels.delete }));
    expect(actions.onDelete).toHaveBeenCalledWith({ kind: 'folder', path: 'сцены' });
  });

  it('у читателя на файле меню не открывается вовсе', () => {
    // Только скачивание папки — на файле не остаётся ни одного пункта, и пустая
    // рамка вместо штатного меню браузера была бы хуже его отсутствия.
    renderTree({ onDownloadFolder: vi.fn() });

    fireEvent.contextMenu(screen.getByText('первая'));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByText('сцены'));
    expect(screen.getByRole('menuitem', { name: labels.downloadFolder })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: labels.delete })).toBeNull();
  });

  it('без actions правый клик не перехватывается', () => {
    renderTree(undefined);
    fireEvent.contextMenu(screen.getByText('первая'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
