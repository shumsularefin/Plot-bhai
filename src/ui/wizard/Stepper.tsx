interface StepperProps {
  /** Accessible name of the step list, for example "XRD analysis steps". */
  label: string;
  titles: readonly string[];
  /** Short tab labels; the titles when missing. */
  tabs?: readonly string[];
  /** A few words on each step, shown as the tab's hover hint. */
  summaries?: readonly (string | undefined)[];
  current: number;
  furthest: number;
  onSelect: (index: number) => void;
}

/**
 * The steps as a row of tabs in the header (a segmented control, like a desktop app's mode
 * switcher), with a hairline progress bar underneath. Steps already reached can be revisited;
 * later ones are shown but cannot be opened until Next gets there.
 */
export function Stepper({
  label,
  titles,
  tabs,
  summaries,
  current,
  furthest,
  onSelect,
}: StepperProps) {
  const total = titles.length;
  const percent = Math.round(((current + 1) / total) * 100);

  return (
    <nav class="stepper" aria-label={label}>
      <ol class="stepper-tabs">
        {titles.map((title, index) => {
          const state = index === current ? 'current' : index <= furthest ? 'reached' : 'todo';
          const summary = summaries?.[index];
          const hint = `Step ${index + 1}: ${title}${summary ? ` – ${summary}` : ''}`;
          return (
            <li key={title}>
              <button
                type="button"
                class={`stepper-tab is-${state}`}
                title={state === 'todo' ? `${hint} (press Next to get here)` : hint}
                aria-current={index === current ? 'step' : undefined}
                disabled={state === 'todo'}
                onClick={() => onSelect(index)}
              >
                <span class="visually-hidden">Step {index + 1}:</span> {tabs?.[index] ?? title}
                {tabs?.[index] && tabs[index] !== title && (
                  <>
                    {' '}
                    <span class="visually-hidden">({title})</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div
        class="stepper-bar"
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={`Step ${current + 1} of ${total}`}
      >
        <div class="stepper-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </nav>
  );
}
