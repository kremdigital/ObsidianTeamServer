import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('returns no properties when there is no frontmatter', () => {
    const r = parseFrontmatter('# Title\n\nbody');
    expect(r.properties).toEqual([]);
    expect(r.body).toBe('# Title\n\nbody');
  });

  it('parses scalar properties and strips the block from the body', () => {
    const r = parseFrontmatter('---\ntitle: Hello\nstatus: draft\n---\n# Body');
    expect(r.properties).toEqual([
      { key: 'title', value: 'Hello' },
      { key: 'status', value: 'draft' },
    ]);
    expect(r.body).toBe('# Body');
  });

  it('flattens list properties (tags)', () => {
    const r = parseFrontmatter('---\ntags:\n  - a\n  - b\n---\nbody');
    expect(r.properties).toEqual([{ key: 'tags', value: ['a', 'b'] }]);
  });

  it('coerces numbers and booleans to strings', () => {
    const r = parseFrontmatter('---\ncount: 3\ndone: true\n---\nx');
    expect(r.properties).toEqual([
      { key: 'count', value: '3' },
      { key: 'done', value: 'true' },
    ]);
  });

  it('renders dates as ISO day strings', () => {
    const r = parseFrontmatter('---\ncreated: 2026-06-02\n---\nx');
    expect(r.properties).toEqual([{ key: 'created', value: '2026-06-02' }]);
  });

  it('ignores malformed YAML but still strips the block', () => {
    const r = parseFrontmatter('---\n: : bad\n  - nope\n---\nbody');
    expect(r.properties).toEqual([]);
    expect(r.body).toBe('body');
  });

  it('ignores non-object YAML (e.g. a bare scalar)', () => {
    const r = parseFrontmatter('---\njust a string\n---\nbody');
    expect(r.properties).toEqual([]);
    expect(r.body).toBe('body');
  });

  it('only strips a leading block, not a mid-document rule', () => {
    const r = parseFrontmatter('intro\n\n---\nnot: frontmatter\n---\n');
    expect(r.properties).toEqual([]);
    expect(r.body).toBe('intro\n\n---\nnot: frontmatter\n---\n');
  });
});
