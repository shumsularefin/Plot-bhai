import type { StepContext } from '../../ui/wizard/types';
import type { XrdData } from './data';

/** Wizard step 7. The tables are built in a later stage; warnings that apply to them show now. */
export function ResultsStep({ data }: StepContext<XrdData>) {
  return (
    <div class="fit-step">
      {data.instrument.source === 'skip' && (
        <p class="message is-warning" role="note">
          <strong>Check:</strong> instrument correction was skipped (step 6). Widths include the
          instrument&apos;s own broadening, so every crystallite size in these results is smaller
          than reality.
        </p>
      )}
      <p class="placeholder-note">The results tables are built in a later stage.</p>
    </div>
  );
}
