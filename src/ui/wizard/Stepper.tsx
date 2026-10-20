interface StepperProps {
  titles: readonly string[];
  current: number;
  furthest: number;
  onSelect: (index: number) => void;
}

/**
 * Progress indicator. Wide screens show every step; narrow screens show a compact
 * "Step 2 of 8" line with a progress bar. Steps already reached can be revisited.
 */
export function Stepper({ titles, current, furthest, onSelect }: StepperProps) {
  const total = titles.length;
  const percent = Math.round(((current + 1) / total) * 100);

  return (
    <nav class="stepper" aria-label="Progress">
      <div class="stepper-compact">
        <p class="stepper-compact-label">
          Step {current + 1} of {total}
          <span aria-hidden="true"> · </span>
          <span class="visually-hidden">: </span>
          {titles[current]}
        </p>
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
      </div>

      <ol class="stepper-list">
        {titles.map((title, index) => {
          const state = index === current ? 'current' : index <= furthest ? 'reached' : 'todo';
          const content = (
            <>
              <span class="stepper-number" aria-hidden="true">
                {index + 1}
              </span>
              <span class="stepper-title">{title}</span>
            </>
          );
          return (
            <li key={title} class={`stepper-item is-${state}`}>
              {state === 'todo' ? (
                <span class="stepper-target" aria-disabled="true">
                  {content}
                </span>
              ) : (
                <button
                  type="button"
                  class="stepper-target"
                  aria-current={index === current ? 'step' : undefined}
                  onClick={() => onSelect(index)}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
