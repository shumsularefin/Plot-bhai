import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

interface AdvancedProps {
  /** Stable id: the open or closed state is remembered per id in this browser. */
  id: string;
  /** What the section holds, for example "Noise filter". */
  title: string;
  children: ComponentChildren;
}

const key = (id: string) => `advanced-open:${id}`;

function remembered(id: string): boolean {
  try {
    return localStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

/**
 * A collapsed section for options most people never need. Every tool uses it the same way, so
 * the default screen shows only the essential controls. The settings inside belong to the
 * analysis and are kept whether the section is open or closed; only the open state is
 * remembered in the browser.
 */
export function Advanced({ id, title, children }: AdvancedProps) {
  const [open, setOpen] = useState(() => remembered(id));
  return (
    <details
      class="advanced"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          localStorage.setItem(key(id), next ? '1' : '0');
        } catch {
          // Private browsing or blocked storage: the section simply starts closed next time.
        }
      }}
    >
      <summary>
        <span class="advanced-tag">Advanced</span> {title}
      </summary>
      <div class="advanced-body">{children}</div>
    </details>
  );
}
