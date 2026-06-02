import { describe, expect, it } from 'vitest';
import {
  parseWikiTarget,
  isImageTarget,
  resolveWikiTarget,
  resolveRelativeLink,
  isExternalUrl,
} from './resolve';
import type { NoteFile } from './types';

function f(id: string, path: string, fileType: 'TEXT' | 'BINARY' = 'TEXT'): NoteFile {
  return { id, path, fileType, mimeType: null };
}

const files: NoteFile[] = [
  f('1', 'Welcome.md'),
  f('2', 'projects/Alpha.md'),
  f('3', 'projects/sub/Alpha.md'),
  f('4', 'projects/Beta.md'),
  f('5', 'assets/logo.png', 'BINARY'),
  f('6', 'Daily/2026-06-02.md'),
];

describe('parseWikiTarget', () => {
  it('splits target only', () => {
    expect(parseWikiTarget('Note')).toEqual({ target: 'Note', heading: null, alias: null });
  });

  it('splits alias on first pipe', () => {
    expect(parseWikiTarget('Note|Display')).toEqual({
      target: 'Note',
      heading: null,
      alias: 'Display',
    });
  });

  it('splits heading and alias', () => {
    expect(parseWikiTarget('Note#Section|Display')).toEqual({
      target: 'Note',
      heading: 'Section',
      alias: 'Display',
    });
  });

  it('handles heading-only links', () => {
    expect(parseWikiTarget('#Section')).toEqual({
      target: '',
      heading: 'Section',
      alias: null,
    });
  });

  it('strips block-ref caret', () => {
    expect(parseWikiTarget('Note#^block123')).toEqual({
      target: 'Note',
      heading: 'block123',
      alias: null,
    });
  });
});

describe('isImageTarget', () => {
  it('detects common image extensions', () => {
    for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg']) {
      expect(isImageTarget(name)).toBe(true);
    }
  });
  it('rejects non-images', () => {
    expect(isImageTarget('Note.md')).toBe(false);
    expect(isImageTarget('Note')).toBe(false);
  });
});

describe('resolveWikiTarget', () => {
  it('matches by basename without extension', () => {
    expect(resolveWikiTarget('Welcome', files)?.id).toBe('1');
  });

  it('matches by full path', () => {
    expect(resolveWikiTarget('projects/Beta', files)?.id).toBe('4');
  });

  it('is case-insensitive', () => {
    expect(resolveWikiTarget('welcome', files)?.id).toBe('1');
  });

  it('breaks ambiguous basename ties toward the shortest path', () => {
    // Both projects/Alpha.md and projects/sub/Alpha.md match "Alpha".
    expect(resolveWikiTarget('Alpha', files)?.id).toBe('2');
  });

  it('prefers an exact path over a basename collision', () => {
    expect(resolveWikiTarget('projects/sub/Alpha', files)?.id).toBe('3');
  });

  it('resolves image targets by basename with extension', () => {
    expect(resolveWikiTarget('logo.png', files)?.id).toBe('5');
  });

  it('returns null for a dangling link', () => {
    expect(resolveWikiTarget('DoesNotExist', files)).toBeNull();
  });

  it('ignores leading ./ and /', () => {
    expect(resolveWikiTarget('/Welcome', files)?.id).toBe('1');
    expect(resolveWikiTarget('./projects/Beta', files)?.id).toBe('4');
  });
});

describe('resolveRelativeLink', () => {
  it('resolves a sibling link', () => {
    expect(resolveRelativeLink('Beta.md', 'projects/Alpha.md', files)?.id).toBe('4');
  });

  it('resolves a parent-relative link', () => {
    expect(resolveRelativeLink('../Welcome.md', 'projects/Alpha.md', files)?.id).toBe('1');
  });

  it('resolves a descend-into-folder link', () => {
    expect(resolveRelativeLink('sub/Alpha.md', 'projects/Alpha.md', files)?.id).toBe('3');
  });

  it('strips anchors before resolving', () => {
    expect(resolveRelativeLink('Beta.md#Heading', 'projects/Alpha.md', files)?.id).toBe('4');
  });

  it('returns null for external URLs', () => {
    expect(resolveRelativeLink('https://example.com', 'Welcome.md', files)).toBeNull();
  });

  it('decodes percent-encoded spaces', () => {
    const withSpace = [...files, f('7', 'My Notes/Hello World.md')];
    expect(resolveRelativeLink('My%20Notes/Hello%20World.md', 'Welcome.md', withSpace)?.id).toBe(
      '7',
    );
  });
});

describe('isExternalUrl', () => {
  it('treats http(s)/mailto as external', () => {
    expect(isExternalUrl('https://x.com')).toBe(true);
    expect(isExternalUrl('http://x.com')).toBe(true);
    expect(isExternalUrl('mailto:a@b.com')).toBe(true);
  });

  it('treats relative paths and wiki protocols as internal', () => {
    expect(isExternalUrl('foo/bar.md')).toBe(false);
    expect(isExternalUrl('./x.md')).toBe(false);
    expect(isExternalUrl('wikilink:Note')).toBe(false);
    expect(isExternalUrl('wikiembed:img.png')).toBe(false);
  });
});
