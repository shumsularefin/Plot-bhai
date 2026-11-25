import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Home } from '../src/ui/Home';
import { recordSession } from '../src/ui/lastSession';
import { searchItems } from '../src/ui/catalog';

afterEach(() => localStorage.clear());

describe('Home', () => {
  it('groups the tools by technique, with a real exported figure and the credit', () => {
    render(<Home />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Diffraction',
      'Spectroscopy',
      'Thermal analysis',
      'Microscopy & utilities',
      'What you get',
      'How it works',
    ]);
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names.slice(0, 7)).toEqual([
      'XRD Analysis',
      'Plot Digitizer',
      'UV-Vis & Tauc',
      'FTIR & ATR',
      'Thermal TGA & DSC',
      'Particle Size SEM/TEM',
      'Sample Report',
    ]);
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const href of ['#/xrd', '#/xrd/image', '#/ftir/image', '#/uvvis', '#/ftir', '#/thermal']) {
      expect(links).toContain(href);
    }
    expect(links).toContain('#/particles');
    expect(links).toContain('#/report');
    expect(screen.getByRole('img').getAttribute('alt')).toContain('COD entry 1577381');
    expect(
      screen.getByText(/calculated from the zinc oxide structure COD 1577381, not/),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Plot Bhai');
  });

  it('offers to resume the tool used last', () => {
    recordSession('/ftir', Date.now() - 2 * 3600_000);
    render(<Home />);
    expect(screen.getByText('FTIR analysis')).toBeTruthy();
    expect(screen.getByText('(opened 2 hours ago)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Quick launch' }).getAttribute('href')).toBe('#/ftir');
  });
});

describe('Quick search', () => {
  it('finds tools by method names they do not show', () => {
    expect(searchItems('kissinger')[0]?.href).toBe('#/thermal');
    expect(searchItems('band gap')[0]?.href).toBe('#/uvvis');
    expect(searchItems('williamson hall')[0]?.href).toBe('#/xrd');
    expect(searchItems('ftir graph')[0]?.href).toBe('#/ftir/image');
    expect(searchItems('')).toEqual([]);
    expect(searchItems('zzzz')).toEqual([]);
  });
});
