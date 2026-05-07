import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('handles latin', () => {
    expect(slugify('My Awesome Project')).toBe('my-awesome-project');
    expect(slugify('Trim_This_Underscore')).toBe('trim-this-underscore');
  });

  it('transliterates Russian', () => {
    expect(slugify('Привет Мир')).toBe('privet-mir');
    expect(slugify('Заметки Журнал')).toBe('zametki-zhurnal');
  });

  it('falls back to empty for non-printable input', () => {
    expect(slugify('!!! ???')).toBe('');
  });

  it('caps length at 60 characters', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
