import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { applyThemePreference, readThemePreference, type ThemePreference } from './theme';

const CHOICES: { id: ThemePreference; label: string; icon: ComponentChildren }[] = [
  {
    id: 'light',
    label: 'Light theme',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    id: 'system',
    label: 'Theme follows the system',
    icon: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  },
  {
    id: 'dark',
    label: 'Dark theme',
    icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  },
];

/** Light, system or dark: a segmented control of three icons (see theme.ts). */
export function ThemeToggle() {
  const [preference, setPreference] = useState(readThemePreference);
  return (
    <div class="theme-switch" role="group" aria-label="Theme">
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          class="theme-switch-button"
          aria-pressed={preference === c.id}
          aria-label={c.label}
          title={c.label}
          onClick={() => {
            applyThemePreference(c.id);
            setPreference(c.id);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {c.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
