'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookTextIcon,
  LoaderCircleIcon,
  PencilIcon,
  SearchIcon,
  EyeIcon,
  XIcon,
} from 'lucide-react';
import { ApiError, apiGetText } from '@/lib/api/client';
import { slugifyHeading } from '@/lib/notes/slug';
import { ancestorFolderPaths } from '@/lib/notes/tree';
import type { NoteFile } from '@/lib/notes/types';
import { FileTree } from './FileTree';
import { MarkdownView } from './MarkdownView';
import { NoteEditor } from './NoteEditor';

interface NotesBrowserProps {
  projectId: string;
  files: NoteFile[];
  /** Whether the current user may edit notes (ADMIN/EDITOR/owner). Server enforces too. */
  canEdit?: boolean;
  /** Current user's display name — shown to collaborators in the editor. */
  userName?: string | undefined;
}

function isMarkdown(file: NoteFile): boolean {
  return file.fileType === 'TEXT' || /\.md$/i.test(file.path);
}

function isImage(file: NoteFile): boolean {
  return (
    Boolean(file.mimeType?.startsWith('image/')) ||
    /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.path)
  );
}

/**
 * Two-pane read-only note browser. Left: collapsible file tree with a
 * filter box. Right: the rendered markdown (or an image / binary notice).
 * Internal links and embeds drive in-pane navigation, expanding the tree
 * and scrolling to `#headings` as needed.
 */
export function NotesBrowser({
  projectId,
  files,
  canEdit = false,
  userName,
}: NotesBrowserProps): ReactElement {
  const t = useTranslations('notes');

  const markdownFiles = useMemo(() => files.filter(isMarkdown), [files]);
  const [selected, setSelected] = useState<NoteFile | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const pendingHeading = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const openFile = useCallback((file: NoteFile, heading: string | null) => {
    setSelected(file);
    pendingHeading.current = heading;
    // Reveal the file by expanding its ancestor folders.
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of ancestorFolderPaths(file.path)) next.add(p);
      return next;
    });
  }, []);

  // Pick a sensible default note on first load (README/Welcome, else first).
  useEffect(() => {
    if (selected || markdownFiles.length === 0) return;
    const preferred =
      markdownFiles.find((f) => /(^|\/)(readme|welcome|index|home)\.md$/i.test(f.path)) ??
      markdownFiles[0]!;
    openFile(preferred, null);
  }, [markdownFiles, selected, openFile]);

  // Fetch content whenever the selected file changes (markdown only).
  useEffect(() => {
    if (!selected || !isMarkdown(selected)) {
      setContent('');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiGetText(`/api/projects/${projectId}/files/${selected.id}`, { signal: controller.signal })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.body.error.message : t('loadError'));
        setLoading(false);
      });
    return () => controller.abort();
  }, [selected, projectId, t]);

  // After content paints, scroll to a pending heading anchor.
  useEffect(() => {
    if (loading || !pendingHeading.current) return;
    const slug = slugifyHeading(pendingHeading.current);
    pendingHeading.current = null;
    if (!slug) return;
    const el = contentRef.current?.querySelector(`#${CSS.escape(slug)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [content, loading]);

  const onToggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Filter the tree by the query (matches anywhere in the path).
  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  // When searching, expand every folder so matches are visible.
  const effectiveExpanded = useMemo(() => {
    if (!query.trim()) return expanded;
    const all = new Set<string>();
    for (const f of visibleFiles) for (const p of ancestorFolderPaths(f.path)) all.add(p);
    return all;
  }, [query, expanded, visibleFiles]);

  return (
    <div className="bg-card flex h-full overflow-hidden rounded-lg border">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <div className="border-b p-2">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="border-input bg-background focus-visible:ring-ring h-8 w-full rounded-md border pr-7 pl-8 text-sm focus-visible:ring-1 focus-visible:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={t('clearSearch')}
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          <FileTree
            files={visibleFiles}
            selectedId={selected?.id ?? null}
            expanded={effectiveExpanded}
            onToggleFolder={onToggleFolder}
            onSelectFile={(f) => openFile(f, null)}
          />
        </div>
      </aside>

      {/* Content */}
      <main ref={contentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selected ? (
          <EmptyState text={t('empty')} />
        ) : (
          <>
            {/* Path bar + edit/view toggle */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-6 py-2">
              <span className="text-muted-foreground truncate font-mono text-xs">
                {selected.path}
              </span>
              {canEdit && isMarkdown(selected) && (
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                >
                  {editing ? (
                    <>
                      <EyeIcon className="size-3.5" />
                      {t('viewButton')}
                    </>
                  ) : (
                    <>
                      <PencilIcon className="size-3.5" />
                      {t('editButton')}
                    </>
                  )}
                </button>
              )}
            </div>

            {editing && canEdit && isMarkdown(selected) ? (
              <div className="min-h-0 flex-1 px-6 py-3">
                <NoteEditor
                  key={selected.id}
                  projectId={projectId}
                  fileId={selected.id}
                  userName={userName}
                />
              </div>
            ) : loading ? (
              <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
                <LoaderCircleIcon className="size-4 animate-spin" />
                {t('loading')}
              </div>
            ) : error ? (
              <p className="text-destructive p-6 text-sm">{error}</p>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl px-6 py-5">
                  {isMarkdown(selected) ? (
                    <MarkdownView
                      content={content}
                      files={files}
                      currentFile={selected}
                      projectId={projectId}
                      onNavigate={openFile}
                      labels={{
                        dangling: t('dangling'),
                        loading: t('embedLoading'),
                        error: t('embedError'),
                        circular: t('circularEmbed'),
                        tooDeep: t('embedTooDeep'),
                      }}
                    />
                  ) : isImage(selected) ? (
                    <img
                      src={`/api/projects/${projectId}/files/${selected.id}`}
                      alt={selected.path}
                      className="mx-auto max-w-full rounded-md border"
                    />
                  ) : (
                    <BinaryNotice
                      href={`/api/projects/${projectId}/files/${selected.id}`}
                      label={t('binaryDownload')}
                      notice={t('binaryNotice')}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({ text }: { text: string }): ReactElement {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
      <BookTextIcon className="size-8 opacity-40" />
      {text}
    </div>
  );
}

function BinaryNotice({
  href,
  label,
  notice,
}: {
  href: string;
  label: string;
  notice: string;
}): ReactElement {
  return (
    <div className="text-muted-foreground flex flex-col items-start gap-2 text-sm">
      <p>{notice}</p>
      <a href={href} download className="text-sky-400 hover:underline">
        {label}
      </a>
    </div>
  );
}
