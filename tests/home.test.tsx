import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Home } from '../src/ui/Home';

describe('Home', () => {
  it('shows all five tool cards and XRD, UV-Vis, FTIR and particle size open', () => {
    render(<Home />);
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(['XRD', 'UV-Vis', 'FTIR', 'Particle size', 'TGA and DSC']);
    expect(screen.getAllByText('Coming soon')).toHaveLength(1);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });
});
