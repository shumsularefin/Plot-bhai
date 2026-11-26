import { VALIDATION_CHECKS, VERSION } from './software';

/** The bar along the bottom of the home and documentation pages. */
export function StatusBar({ path }: { path: string }) {
  const here = (p: string) => (path === p ? 'page' : undefined);
  return (
    <footer class="status-bar">
      <p class="status-bar-state">
        <span class="status-dot" aria-hidden="true" />
        <span>
          Status: <strong>Ready</strong>
        </span>
        <span class="status-sep" aria-hidden="true">
          |
        </span>
        <a href="#/validation" aria-current={here('/validation')}>
          Validation: {VALIDATION_CHECKS} checks passed <span aria-hidden="true">✓</span>
        </a>
        <span class="status-sep is-wide" aria-hidden="true">
          |
        </span>
        <span class="status-note">Your data stays on this device</span>
      </p>
      <nav class="status-bar-links" aria-label="Site">
        <a href="#/about" aria-current={here('/about')}>
          About
        </a>
        <a href="#/about?about-cite">Cite us</a>
        <a href="#/about?about-features">Documentation</a>
        <span class="status-version">v{VERSION}</span>
      </nav>
    </footer>
  );
}
