import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import './help-tip.css';

interface HelpTipProps {
  /** The term being explained, used for the button's accessible name. */
  term: string;
  children: ComponentChildren;
}

const VIEWPORT_MARGIN = 16;
const OFFSET = 6;

/**
 * "What is this?" button that opens a short explanation next to a technical term.
 * Closes with Escape, the close button, or a tap outside. Positioned inside the viewport
 * so it never causes horizontal scrolling.
 */
export function HelpTip({ term, children }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!button || !panel) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(button.left, maxLeft));
      const below = button.bottom + OFFSET;
      const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
      const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, button.top - OFFSET - height);
      setPosition({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span class="help-tip">
      <button
        ref={buttonRef}
        type="button"
        class="help-tip-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span class="help-tip-icon" aria-hidden="true">
          ?
        </span>
        <span class="visually-hidden">What is {term}?</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          class="help-tip-panel"
          role="dialog"
          aria-label={`What is ${term}?`}
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
        >
          <div class="help-tip-heading">
            <p class="help-tip-title">What is {term}?</p>
            <button type="button" class="help-tip-close" onClick={() => close(true)}>
              <span aria-hidden="true">×</span>
              <span class="visually-hidden">Close</span>
            </button>
          </div>
          <div class="help-tip-body">{children}</div>
        </div>
      )}
    </span>
  );
}
