import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, type PersistedStore } from '../persist/persistedStore';
import { Stepper } from './Stepper';
import type { WizardState, WizardStep } from './types';
import './wizard.css';

interface WizardProps<D> {
  /** Tool name, shown above the stepper. */
  title: string;
  steps: readonly WizardStep<D>[];
  store: PersistedStore<WizardState<D>>;
}

/**
 * Sequential step-by-step flow with Back and Next, a progress indicator and per-step
 * validation. All state lives in a persisted store, so a refresh resumes where the user was.
 */
export function Wizard<D>({ title, steps, store }: WizardProps<D>) {
  const { state, status } = useStore(store);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const movedByUser = useRef(false);

  const last = steps.length - 1;
  const index = Math.min(Math.max(state.step, 0), last);
  const step = steps[index];

  useEffect(() => {
    // Move focus to the new step's heading so keyboard and screen reader users follow along.
    if (movedByUser.current) headingRef.current?.focus();
    movedByUser.current = false;
  }, [index]);

  if (status === 'loading') {
    return <p class="loading wizard-loading">Loading your saved work…</p>;
  }
  if (!step) return null;

  const goTo = (target: number) => {
    setError(null);
    movedByUser.current = true;
    store.set((previous) => ({
      ...previous,
      step: target,
      furthest: Math.max(previous.furthest, target),
    }));
  };

  const next = () => {
    const message = step.validate?.(state.data) ?? null;
    setError(message);
    if (message === null && index < last) goTo(index + 1);
  };

  const update = (patch: Partial<D>) =>
    store.set((previous) => ({ ...previous, data: { ...previous.data, ...patch } }));

  const startOver = () => {
    if (window.confirm('Start over? This clears every step of this analysis.')) {
      setError(null);
      store.reset();
    }
  };

  const errorId = `wizard-error-${step.id}`;

  return (
    <section class="wizard" aria-labelledby="wizard-step-heading">
      <div class="wizard-header">
        <p class="wizard-tool">{title}</p>
        <button type="button" class="btn btn-quiet" onClick={startOver}>
          Start over
        </button>
      </div>

      <Stepper
        titles={steps.map((s) => s.title)}
        current={index}
        furthest={Math.min(state.furthest, last)}
        onSelect={goTo}
      />

      {status === 'unavailable' && (
        <p class="wizard-notice" role="status">
          This browser is not letting the site save your work, so it will be lost if you refresh.
          Private browsing often causes this.
        </p>
      )}

      <div class="wizard-body">
        <h2 id="wizard-step-heading" class="wizard-step-title" tabIndex={-1} ref={headingRef}>
          {step.title}
        </h2>
        <div class="wizard-content">{step.render({ data: state.data, update })}</div>
      </div>

      <div class="wizard-footer">
        {error !== null && (
          <p id={errorId} class="wizard-error" role="alert">
            {error}
          </p>
        )}
        <div class="wizard-actions">
          <button type="button" class="btn" onClick={() => goTo(index - 1)} disabled={index === 0}>
            Back
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={next}
            disabled={index === last}
            aria-describedby={error !== null ? errorId : undefined}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
