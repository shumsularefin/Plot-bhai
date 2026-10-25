import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

let broken = true;
function Fragile() {
  if (broken) throw new Error('boom');
  return <p>fine</p>;
}

describe('ErrorBoundary', () => {
  it('shows a message instead of a blank page, and recovers on Try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Something went wrong.*saved/);
    expect(screen.getByText('boom')).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
