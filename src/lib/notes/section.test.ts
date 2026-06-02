import { describe, expect, it } from 'vitest';
import { extractHeadingSection } from './section';

const doc = `# Title

intro text

## First

first body
more first

### Nested

nested body

## Second

second body
`;

describe('extractHeadingSection', () => {
  it('extracts a section up to the next same-level heading', () => {
    const s = extractHeadingSection(doc, 'first');
    expect(s).toBe('## First\n\nfirst body\nmore first\n\n### Nested\n\nnested body');
  });

  it('includes nested subsections but stops at the next sibling', () => {
    const s = extractHeadingSection(doc, 'first');
    expect(s).toContain('### Nested');
    expect(s).not.toContain('## Second');
  });

  it('extracts a deeper heading up to the next same-or-higher heading', () => {
    const s = extractHeadingSection(doc, 'nested');
    expect(s).toBe('### Nested\n\nnested body');
  });

  it('extracts the last section to end of document', () => {
    const s = extractHeadingSection(doc, 'second');
    expect(s).toBe('## Second\n\nsecond body');
  });

  it('returns the whole top section when matching the title', () => {
    const s = extractHeadingSection(doc, 'title');
    expect(s).toContain('# Title');
    expect(s).toContain('## Second');
  });

  it('returns null when no heading matches', () => {
    expect(extractHeadingSection(doc, 'missing')).toBeNull();
  });

  it('ignores headings inside fenced code blocks', () => {
    const withCode = `## Real

\`\`\`
# Not a heading
## Also not
\`\`\`

after
`;
    const s = extractHeadingSection(withCode, 'real');
    expect(s).toBe('## Real\n\n```\n# Not a heading\n## Also not\n```\n\nafter');
  });
});
