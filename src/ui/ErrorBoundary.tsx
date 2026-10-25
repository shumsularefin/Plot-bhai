import type { ComponentChildren } from 'preact';
import { useErrorBoundary } from 'preact/hooks';

/**
 * Catches an error while a tool is drawing and shows a plain message instead of a blank page.
 * The saved session is untouched, so reloading brings the work back.
 */
export function ErrorBoundary({ children }: { children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary();
  if (!error) return <>{children}</>;
  return (
    <div role="alert" class="wizard-loading">
      <p>Something went wrong in this tool. Your work is saved on this device.</p>
      <p class="field-hint">{error instanceof Error ? error.message : String(error)}</p>
      <button type="button" class="btn btn-primary" onClick={reset}>
        Try again
      </button>
      <button type="button" class="btn" onClick={() => window.location.reload()}>
        Reload the page
      </button>
    </div>
  );
}
