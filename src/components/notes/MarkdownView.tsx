'use client';

import { type ComponentPropsWithoutRef, type ReactElement, type ReactNode, useMemo } from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type ExtraProps,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { ExternalLinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { remarkWikilink } from '@/lib/notes/remark-wikilink';
import {
  resolveWikiTarget,
  resolveRelativeLink,
  isExternalUrl,
  parseWikiTarget,
} from '@/lib/notes/resolve';
import { slugifyHeading } from '@/lib/notes/slug';
import { parseFrontmatter, type NoteProperty } from '@/lib/notes/frontmatter';
import type { NoteFile } from '@/lib/notes/types';

interface MarkdownViewProps {
  content: string;
  files: NoteFile[];
  currentFile: NoteFile;
  projectId: string;
  /** Called for internal links; `heading` is the optional `#anchor`. */
  onNavigate: (file: NoteFile, heading: string | null) => void;
  danglingLabel: string;
}

function fileContentUrl(projectId: string, fileId: string): string {
  return `/api/projects/${projectId}/files/${fileId}`;
}

/** Allow our custom protocols through; sanitize everything else as usual. */
function transformUrl(url: string): string {
  if (url.startsWith('wikilink:') || url.startsWith('wikiembed:')) return url;
  return defaultUrlTransform(url);
}

/** Flattens a hast element's text content (used to slug headings). */
function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (!n) return '';
  if (n.type === 'text') return n.value ?? '';
  if (Array.isArray(n.children)) return n.children.map(hastText).join('');
  return '';
}

/** Heading renderers add an id slug so `#anchor` links can scroll to them. */
function makeHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  function Heading({ node, children }: ComponentPropsWithoutRef<'h1'> & ExtraProps): ReactElement {
    return (
      <Tag id={slugifyHeading(hastText(node))} className="scroll-mt-4">
        {children}
      </Tag>
    );
  }
  Heading.displayName = `Heading(${Tag})`;
  return Heading;
}

const HEADINGS = {
  h1: makeHeading('h1'),
  h2: makeHeading('h2'),
  h3: makeHeading('h3'),
  h4: makeHeading('h4'),
  h5: makeHeading('h5'),
  h6: makeHeading('h6'),
} as const;

/**
 * Read-only Obsidian-style markdown renderer. Resolves `[[wikilinks]]`,
 * `![[embeds]]`, and relative markdown links/images against the project's
 * file index, turning internal links into in-app navigation and pointing
 * images at the authenticated file-content endpoint.
 */
export function MarkdownView({
  content,
  files,
  currentFile,
  projectId,
  onNavigate,
  danglingLabel,
}: MarkdownViewProps): ReactElement {
  const components = useMemo<Components>(() => {
    return {
      ...HEADINGS,

      a({ href, children }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
        const raw = href ?? '';

        // Wiki link / embed-as-link.
        if (raw.startsWith('wikilink:') || raw.startsWith('wikiembed:')) {
          const inner = safeDecode(raw.slice(raw.indexOf(':') + 1));
          const { target, heading: hd } = parseWikiTarget(inner);
          // Heading-only link → jump within the current note.
          if (!target) {
            return (
              <a
                href={`#${slugifyHeading(hd ?? '')}`}
                className="text-sky-400 no-underline hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(currentFile, hd);
                }}
              >
                {children}
              </a>
            );
          }
          const resolved = resolveWikiTarget(target, files);
          if (!resolved) return <DanglingLink title={danglingLabel}>{children}</DanglingLink>;
          return <InternalLink onClick={() => onNavigate(resolved, hd)}>{children}</InternalLink>;
        }

        // External URL.
        if (isExternalUrl(raw)) {
          return (
            <a
              href={raw}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-0.5 text-sky-400 hover:underline"
            >
              {children}
              <ExternalLinkIcon className="size-3 opacity-70" />
            </a>
          );
        }

        // Relative markdown link.
        const hashIdx = raw.indexOf('#');
        const anchor = hashIdx === -1 ? null : raw.slice(hashIdx + 1);
        const resolved = resolveRelativeLink(raw, currentFile.path, files);
        if (!resolved) return <DanglingLink title={danglingLabel}>{children}</DanglingLink>;
        return <InternalLink onClick={() => onNavigate(resolved, anchor)}>{children}</InternalLink>;
      },

      img({ src, alt }: ComponentPropsWithoutRef<'img'> & ExtraProps) {
        const resolvedSrc = resolveImageSrc(
          typeof src === 'string' ? src : '',
          currentFile.path,
          files,
          projectId,
        );
        if (!resolvedSrc) {
          return <span className="text-muted-foreground text-sm italic">[{alt || 'image'}]</span>;
        }
        return (
          <img
            src={resolvedSrc}
            alt={alt ?? ''}
            loading="lazy"
            className="my-2 max-w-full rounded-md border"
          />
        );
      },
    };
  }, [files, currentFile, projectId, onNavigate, danglingLabel]);

  const { properties, body } = useMemo(() => parseFrontmatter(content), [content]);

  return (
    <>
      {properties.length > 0 && <PropertiesPanel properties={properties} />}
      <div className={cn('markdown-body')}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkFrontmatter, remarkWikilink]}
          urlTransform={transformUrl}
          components={components}
          skipHtml
        >
          {body}
        </ReactMarkdown>
      </div>
    </>
  );
}

/** Obsidian-style read-only properties table for YAML frontmatter. */
function PropertiesPanel({ properties }: { properties: NoteProperty[] }): ReactElement {
  return (
    <dl className="mb-5 grid grid-cols-[minmax(6rem,9rem)_1fr] gap-x-3 gap-y-1.5 border-b pb-4 text-sm">
      {properties.map((p) => (
        <div key={p.key} className="contents">
          <dt className="text-muted-foreground truncate py-0.5">{p.key}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
            {Array.isArray(p.value) ? (
              p.value.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                p.value.map((v, i) => (
                  <span
                    key={`${v}-${i}`}
                    className="bg-accent text-accent-foreground rounded px-1.5 py-0.5 text-xs"
                  >
                    {v}
                  </span>
                ))
              )
            ) : (
              <span className="break-words">{p.value || '—'}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function InternalLink({
  onClick,
  children,
}: {
  onClick: () => void;
  children?: ReactNode;
}): ReactElement {
  return (
    <a
      href="#"
      className="text-sky-400 no-underline hover:underline"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  );
}

function DanglingLink({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  return (
    <span
      className="text-muted-foreground cursor-not-allowed underline decoration-dotted"
      title={title}
    >
      {children}
    </span>
  );
}

function resolveImageSrc(
  src: string,
  currentPath: string,
  files: NoteFile[],
  projectId: string,
): string | null {
  if (!src) return null;
  if (src.startsWith('wikiembed:')) {
    const inner = safeDecode(src.slice('wikiembed:'.length));
    const { target } = parseWikiTarget(inner);
    const file = resolveWikiTarget(target, files);
    return file ? fileContentUrl(projectId, file.id) : null;
  }
  if (isExternalUrl(src)) {
    // Only http(s) data is allowed through for safety.
    return /^https?:\/\//i.test(src) ? src : null;
  }
  const file = resolveRelativeLink(src, currentPath, files);
  return file ? fileContentUrl(projectId, file.id) : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
