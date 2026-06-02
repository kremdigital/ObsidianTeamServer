import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';
import type { NoteFile } from '@/lib/notes/types';

const files: NoteFile[] = [
  { id: 'welcome', path: 'Welcome.md', fileType: 'TEXT', mimeType: null },
  { id: 'beta', path: 'projects/Beta.md', fileType: 'TEXT', mimeType: null },
  { id: 'logo', path: 'assets/logo.png', fileType: 'BINARY', mimeType: 'image/png' },
];
const current = files[0]!;

function renderView(content: string, onNavigate = vi.fn()) {
  render(
    <MarkdownView
      content={content}
      files={files}
      currentFile={current}
      projectId="P1"
      onNavigate={onNavigate}
      danglingLabel="dangling"
    />,
  );
  return { onNavigate };
}

describe('MarkdownView', () => {
  it('renders a resolvable wikilink as a clickable internal link', () => {
    const { onNavigate } = renderView('See [[projects/Beta|Beta]] here');
    const link = screen.getByText('Beta');
    expect(link.tagName).toBe('A');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]![0]).toMatchObject({ id: 'beta' });
    expect(onNavigate.mock.calls[0]![1]).toBeNull();
  });

  it('passes the heading anchor when a wikilink has one', () => {
    const { onNavigate } = renderView('[[projects/Beta#Intro]]');
    fireEvent.click(screen.getByText('projects/Beta › Intro'));
    expect(onNavigate.mock.calls[0]![1]).toBe('Intro');
  });

  it('renders a dangling wikilink as a non-link span', () => {
    renderView('[[DoesNotExist]]');
    const el = screen.getByText('DoesNotExist');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('title', 'dangling');
  });

  it('renders external links with target=_blank', () => {
    renderView('[site](https://example.com)');
    const link = screen.getByText('site').closest('a')!;
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('resolves relative markdown links to internal navigation', () => {
    const { onNavigate } = renderView('[go](projects/Beta.md)');
    fireEvent.click(screen.getByText('go'));
    expect(onNavigate.mock.calls[0]![0]).toMatchObject({ id: 'beta' });
  });

  it('slugifies heading ids for anchor scrolling', () => {
    const { container } = renderHtml('## Hello World');
    expect(container.querySelector('h2')?.id).toBe('hello-world');
  });

  it('points image embeds at the file-content endpoint', () => {
    const { container } = renderHtml('![[logo.png]]');
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/projects/P1/files/logo');
  });

  it('renders GFM tables', () => {
    renderView('| A | B |\n| - | - |\n| 1 | 2 |');
    expect(screen.getByText('A').tagName).toBe('TH');
  });

  it('renders frontmatter as a properties panel and hides it from the body', () => {
    renderView('---\ntitle: My Note\ntags:\n  - x\n  - y\n---\n# Heading');
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('My Note')).toBeInTheDocument();
    expect(screen.getByText('x')).toBeInTheDocument();
    // The raw `---` fence must not leak into the rendered body.
    expect(screen.queryByText('---')).not.toBeInTheDocument();
  });
});

/** Variant returning the container for DOM-shape assertions. */
function renderHtml(content: string) {
  return render(
    <MarkdownView
      content={content}
      files={files}
      currentFile={current}
      projectId="P1"
      onNavigate={vi.fn()}
      danglingLabel="dangling"
    />,
  );
}
