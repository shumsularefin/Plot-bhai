import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Dock } from '../src/ui/Dock';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const docked = () => [...document.querySelectorAll('.dock-frame')];

describe('Dock: one figure kept in view', () => {
  it('keeps the first automatic figure in view and leaves manual ones in place', () => {
    render(
      <>
        <Dock label="First">
          <p>first plot</p>
        </Dock>
        <Dock label="Second">
          <p>second plot</p>
        </Dock>
        <Dock label="Check" mode="manual">
          <p>check plot</p>
        </Dock>
      </>,
    );
    expect(docked()).toHaveLength(1);
    expect(docked()[0]?.textContent).toContain('first plot');
    expect(document.documentElement.classList.contains('has-dock')).toBe(true);
    // The other two offer to take its place.
    expect(screen.getAllByRole('button', { name: 'Keep this figure in view' })).toHaveLength(2);
  });

  it('moves to the figure the user picks, and unpinning puts every figure back in the page', () => {
    render(
      <>
        <Dock label="First">
          <p>first plot</p>
        </Dock>
        <Dock label="Check" mode="manual">
          <p>check plot</p>
        </Dock>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep this figure in view' }));
    expect(docked()[0]?.textContent).toContain('check plot');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(docked()).toHaveLength(0);
    expect(document.documentElement.classList.contains('has-dock')).toBe(false);
    expect(localStorage.getItem('plot-dock')).toBe('0');
    // Both figures are still shown, in the page.
    expect(screen.getByText('first plot')).toBeTruthy();
    expect(screen.getByText('check plot')).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Keep this figure in view' })[0] as HTMLElement,
    );
    expect(docked()).toHaveLength(1);
  });

  it('minimises to its bar without removing the figure', () => {
    render(
      <Dock label="Plot">
        <p>the plot</p>
      </Dock>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
    expect(screen.getByText('the plot').closest('.dock-content')?.hasAttribute('hidden')).toBe(
      true,
    );
    expect(document.documentElement.classList.contains('dock-collapsed')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('the plot').closest('.dock-content')?.hasAttribute('hidden')).toBe(
      false,
    );
  });
});
