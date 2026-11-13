import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Home } from '../src/ui/Home';

describe('Home', () => {
  it('shows every tool card, the validation card, a real exported figure and the credit', () => {
    render(<Home />);
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names.slice(0, 5)).toEqual(['XRD', 'FTIR', 'UV-Vis', 'TGA and DSC', 'Particle size']);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/xrd',
      '#/ftir',
      '#/uvvis',
      '#/thermal',
      '#/particles',
      '#/report',
      '#/validation',
      '#/xrd',
      '#/about',
    ]);
    expect(screen.getByRole('img').getAttribute('alt')).toContain('COD entry 1577381');
    expect(
      screen.getByText(/calculated from the zinc oxide structure COD 1577381, not/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'About' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Plot Bhai');
  });
});
