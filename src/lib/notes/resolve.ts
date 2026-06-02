import type { NoteFile } from './types';

export interface ParsedTarget {
  /** Path or basename, with `#heading` and `|alias` stripped. */
  target: string;
  /** Heading/block anchor after `#`, or null. */
  heading: string | null;
  /** Display alias after `|`, or null. */
  alias: string | null;
}

/**
 * Parses the inside of a wikilink — `target#heading|alias` — into parts.
 * Obsidian splits the alias on the first `|` and the heading on the first
 * `#`. A link can be heading-only (`[[#Section]]`) for same-file jumps.
 */
export function parseWikiTarget(raw: string): ParsedTarget {
  let rest = raw.trim();
  let alias: string | null = null;

  const pipe = rest.indexOf('|');
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim() || null;
    rest = rest.slice(0, pipe).trim();
  }

  let heading: string | null = null;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    heading =
      rest
        .slice(hash + 1)
        .replace(/^\^/, '')
        .trim() || null;
    rest = rest.slice(0, hash).trim();
  }

  return { target: rest, heading, alias };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;

export function isImageTarget(target: string): boolean {
  return IMAGE_EXT.test(target);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function stripMd(name: string): string {
  return name.replace(/\.md$/i, '');
}

function normalizeTarget(target: string): string {
  return target.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Resolves an Obsidian wikilink target to a vault file. Resolution order:
 *
 *   1. Exact path match (with or without an implied `.md`).
 *   2. Basename match — the file whose name (sans `.md`) equals the target.
 *      Ties break toward the shortest, then lexicographically-first path so
 *      the result is deterministic.
 *
 * Matching is case-insensitive, matching Obsidian on case-folding file
 * systems. Returns null when nothing matches (a "dangling" link).
 */
export function resolveWikiTarget(target: string, files: NoteFile[]): NoteFile | null {
  const wanted = normalizeTarget(target);
  if (!wanted) return null;
  const wantedLc = wanted.toLowerCase();
  const hasExt = /\.[a-z0-9]+$/i.test(wanted);

  // 1. Exact path (optionally appending .md when the target has no extension).
  let best: NoteFile | null = null;
  for (const f of files) {
    const pathLc = f.path.toLowerCase();
    if (pathLc === wantedLc || (!hasExt && pathLc === `${wantedLc}.md`)) {
      return f;
    }
  }

  // 2. Basename match.
  for (const f of files) {
    const baseLc = basename(f.path).toLowerCase();
    const matches = hasExt ? baseLc === wantedLc : stripMd(baseLc) === wantedLc;
    if (matches && isBetter(f, best)) {
      best = f;
    }
  }
  return best;
}

function isBetter(candidate: NoteFile, current: NoteFile | null): boolean {
  if (!current) return true;
  const cd = candidate.path.split('/').length;
  const od = current.path.split('/').length;
  if (cd !== od) return cd < od;
  return candidate.path.localeCompare(current.path) < 0;
}

/**
 * Resolves a standard-markdown relative link (`[text](sub/note.md)`,
 * `[text](../img.png)`) against the directory of the file it appears in.
 * Returns null for absolute URLs and unmatched paths.
 */
export function resolveRelativeLink(
  href: string,
  currentPath: string,
  files: NoteFile[],
): NoteFile | null {
  if (isExternalUrl(href)) return null;

  // Strip any anchor / query before resolving the path.
  const clean = decodeUrl(href.split('#')[0]!.split('?')[0]!);
  if (!clean) return null;

  const dir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
  const resolved = posixResolve(dir, clean);

  const resolvedLc = resolved.toLowerCase();
  const hasExt = /\.[a-z0-9]+$/i.test(resolved);
  for (const f of files) {
    const pathLc = f.path.toLowerCase();
    if (pathLc === resolvedLc || (!hasExt && pathLc === `${resolvedLc}.md`)) {
      return f;
    }
  }
  // Fall back to bare-name resolution like Obsidian does for loose links.
  return resolveWikiTarget(clean, files);
}

export function isExternalUrl(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^wiki(link|embed):/.test(href);
}

function decodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Minimal POSIX path join+normalize handling `.` and `..` segments. */
function posixResolve(dir: string, rel: string): string {
  const stack = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}
