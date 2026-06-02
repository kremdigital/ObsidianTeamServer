import { describe, expect, it } from 'vitest';
import { slugifyHeading } from './slug';

describe('slugifyHeading', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugifyHeading('Hello World')).toBe('hello-world');
  });

  it('drops punctuation', () => {
    expect(slugifyHeading('What is this?!')).toBe('what-is-this');
  });

  it('collapses repeated separators', () => {
    expect(slugifyHeading('a   --  b')).toBe('a-b');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugifyHeading('  -Section-  ')).toBe('section');
  });

  it('keeps unicode letters', () => {
    expect(slugifyHeading('Раздел Один')).toBe('раздел-один');
  });
});
