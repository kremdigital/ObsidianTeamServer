import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('dom rendering sanity', () => {
  it('renders a heading via testing-library', () => {
    render(<h1>Obsidian Team</h1>);
    expect(screen.getByRole('heading', { name: /obsidian team/i })).toBeInTheDocument();
  });
});
