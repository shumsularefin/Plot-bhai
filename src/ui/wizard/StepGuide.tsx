import { useState } from 'preact/hooks';

/** Browser-only preference: whether the user has hidden the step instructions in every tool. */
const HIDDEN_KEY = 'step-guides-hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
}

/** Short numbered instructions at the top of a wizard step, which the user can hide. */
export function StepGuide({ items }: { items: readonly string[] }) {
  const [hidden, setHidden] = useState(readHidden);
  const set = (next: boolean) => {
    writeHidden(next);
    setHidden(next);
  };
  if (hidden)
    return (
      <button type="button" class="btn btn-quiet step-guide-show" onClick={() => set(false)}>
        Show how to do this step
      </button>
    );
  return (
    <aside class="step-guide" aria-label="How to do this step">
      <div class="step-guide-header">
        <p class="step-guide-title">How to do this step</p>
        <button type="button" class="btn btn-quiet" onClick={() => set(true)}>
          Hide tips
        </button>
      </div>
      <ol>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
    </aside>
  );
}
