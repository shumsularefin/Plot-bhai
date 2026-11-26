import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

interface PopoverProps {
  /** Button content (text, optionally with an icon). */
  label: ComponentChildren;
  /** Accessible name of the panel, for example "Settings". */
  title: string;
  /** Extra class on the button. */
  buttonClass?: string;
  /** Which edge of the button the panel lines up with. */
  align?: 'start' | 'end';
  children: ComponentChildren | ((close: () => void) => ComponentChildren);
}

/**
 * A header button that opens a small panel below it (Settings, Help). Closes with Escape, a
 * click outside, or the button again; focus returns to the button on Escape.
 */
export function Popover({ label, title, buttonClass, align = 'end', children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div class="popover" ref={root}>
      <button
        ref={button}
        type="button"
        class={`btn${buttonClass ? ` ${buttonClass}` : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div id={id} class={`popover-panel is-${align}`} role="dialog" aria-label={title}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
