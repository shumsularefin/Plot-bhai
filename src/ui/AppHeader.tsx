import { QuickSearch } from './QuickSearch';
import { VERSION } from './software';
import { ThemeToggle } from './ThemeToggle';

/** "1.2.0" → "v1.2", as in the header; the status bar gives the full number. */
const SHORT_VERSION = `v${VERSION.split('.').slice(0, 2).join('.')}`;

export function BrandMark() {
  return (
    <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 20h18M4 17c3 0 3-9 6-9s3 6 5 6 2-8 5-8" />
    </svg>
  );
}

/** Site header for the home and documentation pages; the tools have their own workbench header. */
export function AppHeader() {
  return (
    <header class="app-header">
      <a href="#/" class="brand">
        <BrandMark />
        Plot Bhai <span class="brand-version">{SHORT_VERSION}</span>
      </a>
      <QuickSearch />
      <div class="app-header-end">
        <ThemeToggle />
      </div>
    </header>
  );
}
