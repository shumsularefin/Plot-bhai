import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, type PersistedStore } from '../persist/persistedStore';
import { editsText, emptyHistory, historyKey, record, redo, undo, type History } from './history';
import { Stepper } from './Stepper';
import type { WizardState, WizardStep } from './types';
import { StepGuide } from './StepGuide';
import { recordAnalysis } from '../feedback/client';
import { ValidateButton, ValidateOffer } from '../feedback/ValidateButton';
import { setAdvancedShown, useAdvancedShown } from '../advancedMode';
import { DockSlot, useDockEnabled } from '../Dock';
import { Popover } from '../Popover';
import { ThemeToggle } from '../ThemeToggle';
import { ToolModeSelect } from './ToolMode';
import './wizard.css';

interface WizardProps<D> {
  /** Tool name, shown in the title bar and used for the step list's name. */
  title: string;
  steps: readonly WizardStep<D>[];
  store: PersistedStore<WizardState<D>>;
  /** A way back to where this tool was opened from, shown at the start of the title bar. */
  back?: { href: string; label: string };
}

const icon = (d: string) => (
  <svg class="btn-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

const GEAR =
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';

/**
 * The analysis workbench, laid out like a desktop application window: a title bar, a header
 * with the steps as tabs, and below it the open step in a panel on the left with the figure it
 * works on in a pane on the right (src/ui/Dock.tsx puts the figure there). All state lives in a
 * persisted store, so a refresh resumes where the user was. Next checks the step first.
 */
export function Wizard<D>({ title, steps, store, back }: WizardProps<D>) {
  const { state, status } = useStore(store);
  // After a refused Next, the message stays while the problem lasts and goes once it is fixed.
  const [checking, setChecking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const movedByUser = useRef(false);
  // Undo and redo of the data (not of the step shown); kept for this visit, not saved.
  const history = useRef<History<D>>(emptyHistory());
  const advanced = useAdvancedShown();
  const [dockEnabled, setDockEnabled] = useDockEnabled();
  const [, setHistoryTick] = useState(0);
  // The right-hand pane, once it exists, for the figure kept in view.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);

  const last = steps.length - 1;
  const index = Math.min(Math.max(state.step, 0), last);
  const step = steps[index];

  const travel = (direction: 'undo' | 'redo') => {
    const current = store.get().data;
    const moved = (direction === 'undo' ? undo : redo)(history.current, current);
    if (!moved) return;
    history.current = moved.history;
    store.set((previous) => ({ ...previous, data: moved.data }));
    setHistoryTick((t) => t + 1);
  };

  // Ctrl/Cmd + Z undoes and Ctrl + Y or Ctrl/Cmd + Shift + Z redoes, anywhere in the tool except
  // inside a text box, which keeps its own undo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = historyKey(event);
      if (!action || editsText(event.target)) return;
      event.preventDefault();
      travel(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Reaching the last step finishes an analysis: it is counted, and the section can be validated.
  useEffect(() => {
    if (status === 'ready' && index === last) void recordAnalysis(title);
  }, [status, index, last, title]);

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
    setChecking(false);
    movedByUser.current = true;
    store.set((previous) => ({
      ...previous,
      step: target,
      furthest: Math.max(previous.furthest, target),
    }));
  };

  const next = () => {
    const message = step.validate?.(state.data) ?? null;
    setChecking(message !== null);
    if (message === null && index < last) goTo(index + 1);
  };

  const update = (patch: Partial<D>) => {
    store.set((previous) => {
      history.current = record(history.current, previous.data, Date.now());
      return { ...previous, data: { ...previous.data, ...patch } };
    });
    setHistoryTick((t) => t + 1);
  };

  const startOver = () => {
    if (window.confirm('Start over? This clears every step of this analysis.')) {
      setChecking(false);
      history.current = emptyHistory();
      store.reset();
    }
  };

  const error = checking ? (step.validate?.(state.data) ?? null) : null;
  const errorId = `wizard-error-${step.id}`;

  const chevron = (d: string, side: 'start' | 'end') => (
    <svg class={`btn-icon is-${side}`} viewBox="4 0 8 16" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  return (
    <div class="wizard-frame workbench">
      <div class="wb-titlebar">
        {back ? (
          <p class="wb-titlebar-side">
            <a class="wb-back" href={back.href}>
              <span aria-hidden="true">←</span> {back.label}
            </a>
          </p>
        ) : (
          <span class="wb-titlebar-side" aria-hidden="true" />
        )}
        <p class="wb-titlebar-title">
          Plot Bhai <span aria-hidden="true">–</span> {title}
        </p>
        <div class="wb-titlebar-side is-end">
          <p class={`wizard-saved${status === 'unavailable' ? ' is-off' : ''}`}>
            {status === 'unavailable' ? 'Not saved in this browser' : 'Saved on this device'}
          </p>
          <ValidateButton tool={title} />
        </div>
      </div>

      <header class="wb-head">
        <div class="wb-head-start">
          <a href="#/" class="wb-logo" title="All tools">
            <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 20h18M4 17c3 0 3-9 6-9s3 6 5 6 2-8 5-8" />
            </svg>
            Plot Bhai
          </a>
          <ToolModeSelect />
        </div>
        <Stepper
          label={`${title} steps`}
          titles={steps.map((s) => s.title)}
          tabs={steps.map((s) => s.tab ?? s.title)}
          summaries={steps.map((s) => s.summary)}
          current={index}
          furthest={Math.min(state.furthest, last)}
          onSelect={goTo}
        />
        <div class="wb-head-end">
          <div class="wb-history" role="group" aria-label="Edit history">
            <button
              type="button"
              class="btn wb-icon-button"
              onClick={() => travel('undo')}
              disabled={history.current.past.length === 0}
              aria-keyshortcuts="Control+Z"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
            >
              {icon('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11')}
            </button>
            <button
              type="button"
              class="btn wb-icon-button"
              onClick={() => travel('redo')}
              disabled={history.current.future.length === 0}
              aria-keyshortcuts="Control+Y"
              aria-label="Redo"
              title="Redo (Ctrl+Y)"
            >
              {icon('m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13')}
            </button>
          </div>
          <Popover
            title="Settings"
            label={
              <>
                {icon(GEAR)}
                Settings
              </>
            }
          >
            {(close) => (
              <div class="menu">
                <label class="menu-row switch">
                  <span class="menu-text">
                    Advanced options
                    <small>Show the settings most analyses never need</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={advanced}
                    onChange={(e) => setAdvancedShown(e.currentTarget.checked)}
                  />
                </label>
                <label class="menu-row switch">
                  <span class="menu-text">
                    Keep the figure in view
                    <small>Show the plot in the pane on the right while you work</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={dockEnabled}
                    onChange={(e) => setDockEnabled(e.currentTarget.checked)}
                  />
                </label>
                <div class="menu-row">
                  <span class="menu-text">Theme</span>
                  <ThemeToggle />
                </div>
                <hr class="menu-rule" />
                <button
                  type="button"
                  class="btn btn-quiet menu-danger"
                  onClick={() => {
                    close();
                    startOver();
                  }}
                >
                  Start over
                </button>
              </div>
            )}
          </Popover>
          <Popover
            title="Help"
            label={
              <>
                {icon(
                  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9M12 17h.01',
                )}
                Help
              </>
            }
          >
            <div class="menu help-menu">
              <p class="menu-heading">{step.title}</p>
              {step.summary && <p class="menu-note">{step.summary}</p>}
              {step.guide && (
                <ol class="help-steps">
                  {step.guide.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ol>
              )}
              <hr class="menu-rule" />
              <p class="menu-heading">Keyboard</p>
              <dl class="help-keys">
                <dt>
                  <kbd>Ctrl</kbd> <kbd>Z</kbd>
                </dt>
                <dd>Undo a change to your data</dd>
                <dt>
                  <kbd>Ctrl</kbd> <kbd>Y</kbd>
                </dt>
                <dd>Redo</dd>
                <dt>
                  <kbd>Ctrl</kbd> + scroll
                </dt>
                <dd>Zoom the plot; drag to pan</dd>
              </dl>
              <hr class="menu-rule" />
              <p class="help-links">
                <a href="#/about">Equations and limits</a>
                <a href="#/validation">How it is validated</a>
                <a href="#/">All tools</a>
              </p>
            </div>
          </Popover>
        </div>
      </header>

      <DockSlot.Provider value={slot}>
        <section class="wizard wb-main" aria-labelledby="wizard-step-heading">
          <div class="wizard-main wb-left" ref={leftRef}>
            <header class="wizard-step-head">
              <h2 id="wizard-step-heading" class="wizard-step-title" tabIndex={-1} ref={headingRef}>
                {step.title}
              </h2>
              <span class="wizard-count">
                Step {index + 1} of {steps.length}
              </span>
            </header>
            {step.summary && <p class="wizard-step-summary">{step.summary}</p>}

            {status === 'unavailable' && (
              <p class="wizard-notice" role="status">
                This browser is not letting the site save your work, so it will be lost if you
                refresh. Private browsing often causes this.
              </p>
            )}

            <ValidateOffer tool={title} show={status === 'ready' && index === last} />

            {step.guide && (
              <StepGuide key={step.id} id={`${title}/${step.id}`} items={step.guide} />
            )}
            <div class="wizard-content">{step.render({ data: state.data, update })}</div>

            <div class="wizard-footer">
              {error !== null && (
                <p id={errorId} class="wizard-error" role="alert">
                  {error}
                </p>
              )}
              <div class="wizard-actions">
                <button
                  type="button"
                  class="btn wizard-back"
                  onClick={() => goTo(index - 1)}
                  disabled={index === 0}
                >
                  {chevron('M10 3.5 5.5 8l4.5 4.5', 'start')}
                  Back
                </button>
                <span class="wizard-position" aria-hidden="true">
                  {index < last ? `Next: ${steps[index + 1]?.title}` : 'Last step'}
                </span>
                <button
                  type="button"
                  class="btn btn-primary wizard-next"
                  onClick={next}
                  disabled={index === last}
                  aria-describedby={error !== null ? errorId : undefined}
                >
                  Next
                  {chevron('M6 3.5 10.5 8 6 12.5', 'end')}
                </button>
              </div>
            </div>
          </div>
          <div class="wb-right" ref={setSlot} />
        </section>
      </DockSlot.Provider>
    </div>
  );
}
