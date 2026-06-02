import { describe, expect, it } from 'vitest';
import type { Root, Paragraph, Link, Image, Text } from 'mdast';
import { remarkWikilink } from './remark-wikilink';

/** Builds a one-paragraph mdast tree from a single text value. */
function paragraph(value: string): Root {
  return {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
  };
}

function runOn(value: string): Paragraph['children'] {
  const tree = paragraph(value);
  remarkWikilink()(tree);
  return (tree.children[0] as Paragraph).children;
}

describe('remarkWikilink', () => {
  it('rewrites a bare wikilink into a link node', () => {
    const nodes = runOn('See [[Note]] now');
    expect(nodes).toHaveLength(3);
    expect((nodes[0] as Text).value).toBe('See ');
    const link = nodes[1] as Link;
    expect(link.type).toBe('link');
    expect(link.url).toBe('wikilink:Note');
    expect((link.children[0] as Text).value).toBe('Note');
    expect((nodes[2] as Text).value).toBe(' now');
  });

  it('uses the alias as display text', () => {
    const link = runOn('[[Note|Display]]')[0] as Link;
    expect(link.url).toBe(`wikilink:${encodeURIComponent('Note|Display')}`);
    expect((link.children[0] as Text).value).toBe('Display');
  });

  it('shows target › heading when no alias', () => {
    const link = runOn('[[Note#Section]]')[0] as Link;
    expect((link.children[0] as Text).value).toBe('Note › Section');
  });

  it('rewrites an image embed into an image node', () => {
    const img = runOn('![[logo.png]]')[0] as Image;
    expect(img.type).toBe('image');
    expect(img.url).toBe('wikiembed:logo.png');
  });

  it('rewrites a note embed into a wikiembed link', () => {
    const link = runOn('![[Note]]')[0] as Link;
    expect(link.type).toBe('link');
    expect(link.url).toBe('wikiembed:Note');
  });

  it('handles multiple links in one text node', () => {
    const nodes = runOn('[[A]] and [[B]]');
    expect(nodes.map((n) => n.type)).toEqual(['link', 'text', 'link']);
    expect((nodes[0] as Link).url).toBe('wikilink:A');
    expect((nodes[2] as Link).url).toBe('wikilink:B');
  });

  it('leaves plain text untouched', () => {
    const tree = paragraph('no links here');
    remarkWikilink()(tree);
    const children = (tree.children[0] as Paragraph).children;
    expect(children).toHaveLength(1);
    expect((children[0] as Text).value).toBe('no links here');
  });

  it('encodes spaces in the target', () => {
    const link = runOn('[[My Note]]')[0] as Link;
    expect(link.url).toBe(`wikilink:${encodeURIComponent('My Note')}`);
    expect((link.children[0] as Text).value).toBe('My Note');
  });
});
