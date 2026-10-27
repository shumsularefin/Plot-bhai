import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Home } from '../src/ui/Home';

describe('Home', () => {
  it('shows every tool card, each with a link', () => {
    render(<Home />);
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual([
      'XRD',
      'XRD from a screenshot',
      'UV-Vis',
      'FTIR',
      'Particle size',
      'TGA and DSC',
    ]);
    expect(screen.queryAllByText('Coming soon')).toHaveLength(0);
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });
});
