import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { HelpTip } from '../src/ui/HelpTip';

describe('HelpTip', () => {
  it('opens on click and closes with Escape, returning focus to the button', () => {
    render(
      <HelpTip term="FWHM">
        <p>Full width at half maximum.</p>
      </HelpTip>,
    );
    const button = screen.getByRole('button', { name: 'What is FWHM?' });
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'What is FWHM?' }).textContent).toContain(
      'Full width at half maximum.',
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on a tap outside', () => {
    render(
      <div>
        <p>Outside</p>
        <HelpTip term="FWHM">Text</HelpTip>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What is FWHM?' }));
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
