import type { ComponentChildren } from 'preact';

/** Everything the wizard saves: where the user is, and the tool's own data. */
export interface WizardState<D> {
  /** Index of the step on screen. */
  step: number;
  /** Highest step index the user has reached; earlier steps can be revisited from the stepper. */
  furthest: number;
  data: D;
}

export interface StepContext<D> {
  data: D;
  /** Merges a partial change into the tool data. Saved automatically. */
  update: (patch: Partial<D>) => void;
}

export interface WizardStep<D> {
  id: string;
  /** Full title, shown as the step heading. */
  title: string;
  render: (context: StepContext<D>) => ComponentChildren;
  /**
   * Validation hook, run when the user presses Next. Return a plain-language message that
   * explains what to do, or null when the step is complete.
   */
  validate?: (data: D) => string | null;
}

export function initialWizardState<D>(data: D): WizardState<D> {
  return { step: 0, furthest: 0, data };
}
