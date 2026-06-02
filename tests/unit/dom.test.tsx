import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('dom rendering sanity', () => {
  it('renders a heading via testing-library', () => {
    render(<h1>Team Vault</h1>);
    expect(screen.getByRole('heading', { name: /team vault/i })).toBeInTheDocument();
  });
});
