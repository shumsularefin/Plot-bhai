import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

interface LazyToolProps {
  load: () => Promise<{ default: ComponentType }>;
}

/** Loads a tool module on demand so it is not part of the initial bundle. */
export function LazyTool({ load }: LazyToolProps) {
  const [Tool, setTool] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setTool(null);
    setFailed(false);
    load().then(
      (module) => active && setTool(() => module.default),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [load]);

  if (failed) {
    return (
      <div role="alert" class="wizard-loading">
        <p>This tool could not be loaded. Check your connection, then reload the page.</p>
        <button type="button" class="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  return Tool ? <Tool /> : <p class="loading wizard-loading">Loading…</p>;
}
