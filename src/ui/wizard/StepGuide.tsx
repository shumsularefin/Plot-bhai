import { useEffect, useState } from 'preact/hooks';

/** Browser-only record of the steps whose tips have already been shown in full once. */
const SEEN_KEY = 'step-guides-seen';

function readSeen(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function markSeen(id: string) {
  try {
    const seen = readSeen();
    if (!seen.includes(id)) localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
  } catch {
    // Storage blocked: the tips open in full again next time.
  }
}

/**
 * Short numbered instructions at the top of a wizard step. They are shown in full the first
 * time a step is opened in this browser; after that only the first tip stays on screen, with a
 * button for the rest, so a returning user is not asked to read the same text again.
 */
export function StepGuide({ id, items }: { id: string; items: readonly string[] }) {
  const [open, setOpen] = useState(() => !readSeen().includes(id));
  useEffect(() => markSeen(id), [id]);

  if (!open)
    return (
      <p class="step-guide-brief">
        <span>{items[0]}</span>
        {items.length > 1 && (
          <button type="button" class="btn btn-quiet" onClick={() => setOpen(true)}>
            More tips
          </button>
        )}
      </p>
    );
  return (
    <aside class="step-guide" aria-label="How to do this step">
      <div class="step-guide-header">
        <p class="step-guide-title">How to do this step</p>
        <button type="button" class="btn btn-quiet" onClick={() => setOpen(false)}>
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
