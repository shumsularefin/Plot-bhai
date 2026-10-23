import { useState } from 'preact/hooks';
import {
  applyThemePreference,
  nextThemePreference,
  readThemePreference,
  type ThemePreference,
} from './theme';

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function ThemeToggle() {
  const [preference, setPreference] = useState(readThemePreference);

  const cycle = () => {
    const next = nextThemePreference(preference);
    applyThemePreference(next);
    setPreference(next);
  };

  return (
    <button type="button" class="btn btn-quiet" onClick={cycle}>
      {LABELS[preference]}
    </button>
  );
}
