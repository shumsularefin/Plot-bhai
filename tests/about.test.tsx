import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import About from '../src/ui/About';

describe('About page', () => {
  it('states privacy, limitations and the COD attribution', () => {
    render(<About />);
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeTruthy();
    expect(screen.getByText(/never uploaded/)).toBeTruthy();
    expect(screen.getByText(/no Rietveld refinement/)).toBeTruthy();
    expect(screen.getByText(/Crystallography Open Database/)).toBeTruthy();
    expect(screen.getByText('D = K λ / (β cos θ)')).toBeTruthy();
  });
});
