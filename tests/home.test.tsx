import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Home } from '../src/ui/Home';

describe('Home', () => {
  it('shows every tool card, each with a link', () => {
    render(<Home />);
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names.slice(0, 5)).toEqual(['XRD', 'FTIR', 'UV-Vis', 'TGA and DSC', 'Particle size']);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/xrd',
      '#/ftir',
      '#/uvvis',
      '#/thermal',
      '#/particles',
    ]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Plot Bhai');
  });
});
