import { useMemo } from 'preact/hooks';
import { EVOLVED_SPECIES_NOTE, rankEvents } from '../../core/thermal/events';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { useCleaned, useStepsView } from './analysis';
import { stepKey, type EventDecision, type ThermalData } from './data';
import { TheoryCheck } from './TheoryCheck';
import { decisionName, EVENT_RULES, EVENT_SOURCE, EVENT_VERIFICATION, ruleOf } from './eventTable';

const CONFIDENCE: Record<string, string> = { low: 'Low confidence', medium: 'Medium confidence' };

/** Wizard step 4: ranked event suggestions for every mass loss step; the user decides. */
export function AssignStep({ data, update }: StepContext<ThermalData>) {
  const { cleaned } = useCleaned(data);
  const view = useStepsView(data, cleaned);
  const steps = useMemo(() => view?.analysis.steps ?? [], [view]);
  const { atmosphere, category } = data.info;

  const candidates = useMemo(
    () =>
      steps.map((s) => ({
        step: s,
        list: rankEvents(s, { atmosphere, category }, EVENT_RULES),
      })),
    [steps, atmosphere, category],
  );

  if (steps.length === 0) {
    return (
      <p class="message is-info">
        No mass loss steps yet. Go back to step 3 and set the detection until the steps match your
        curve.
      </p>
    );
  }

  const decide = (key: string, decision: EventDecision | null) => {
    const others = Object.entries(data.events).filter(([k]) => k !== key);
    update({ events: Object.fromEntries(decision ? [...others, [key, decision]] : others) });
  };
  const todoCount = EVENT_RULES.filter((r) => r.status === 'todo').length;

  return (
    <div class="assign-step">
      <p class="message is-warning" role="note">
        {EVOLVED_SPECIES_NOTE}
      </p>
      <p>
        For each step the table below suggests up to three events, ranked by how well the
        temperature, the atmosphere and the kind of sample fit. These are suggestions, not results:
        accept one, choose another, type your own, or reject all.{' '}
        <HelpTip term="Confidence label">
          <p>
            The label says how many of the clues agree: the step overlaps the typical range, its
            fastest-loss temperature is inside it, and the kind of sample matches. It is never
            "high", because the same temperature range fits several events and TGA cannot tell them
            apart.
          </p>
        </HelpTip>
      </p>

      <p class="message is-info" role="note">
        The event table is incomplete and needs your verification. {todoCount} of{' '}
        {EVENT_RULES.length} events have no temperature range yet, so they are never suggested; you
        can still choose them by hand. {EVENT_VERIFICATION}
      </p>

      {candidates.map(({ step, list }) => {
        const key = stepKey(step.peakC);
        const decision = data.events[key];
        const chosenName = decisionName(decision);
        return (
          <section key={step.id} class="process-step is-on" aria-labelledby={`assign-${step.id}`}>
            <h3 id={`assign-${step.id}`} class="process-step-title">
              Step {step.id}: {formatNumber(step.lossPct, 1)} % lost, peak at{' '}
              {formatNumber(step.peakC, 0)} °C
            </h3>
            <p class="field-hint">
              Onset {formatNumber(step.onsetC, 0)} °C, endset {formatNumber(step.endsetC, 0)} °C
              {step.lossMg !== null ? `, ${formatNumber(step.lossMg, 3)} mg` : ''}.
            </p>

            <p class="assign-decision" role="status">
              {decision?.kind === 'rejected'
                ? 'No event assigned (you rejected the suggestions).'
                : chosenName
                  ? `Your choice: ${chosenName}`
                  : 'Not decided yet.'}
            </p>

            {list.length === 0 ? (
              <p class="field-hint">
                The table has no event with a temperature range that overlaps this step, for this
                atmosphere. Choose one by hand below if you know what it is.
              </p>
            ) : (
              <ol class="assign-candidates">
                {list.map((c) => {
                  const rule = ruleOf(c.ruleId);
                  const chosen = decision?.kind === 'rule' && decision.ruleId === c.ruleId;
                  return (
                    <li key={c.ruleId} class={chosen ? 'is-chosen' : undefined}>
                      <p>
                        <strong>{c.name}</strong>{' '}
                        <span class="badge">{CONFIDENCE[c.confidence]}</span>
                      </p>
                      <p class="field-hint">{c.reason}</p>
                      {rule && (
                        <details>
                          <summary>Source and overlap notes</summary>
                          <p class="field-hint">{rule.overlap}</p>
                          {rule.quote && <blockquote class="field-hint">{rule.quote}</blockquote>}
                          <p class="field-hint">
                            {EVENT_SOURCE.citation}. {EVENT_SOURCE.url}
                          </p>
                        </details>
                      )}
                      <button
                        type="button"
                        class="btn"
                        aria-pressed={chosen}
                        onClick={() => decide(key, { kind: 'rule', ruleId: c.ruleId })}
                      >
                        {chosen ? 'Accepted' : 'Accept'}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <div class="radiation-fields">
              <label class="inline-field">
                Choose another event
                <select
                  value={decision?.kind === 'rule' ? decision.ruleId : ''}
                  onChange={(e) => {
                    const id = e.currentTarget.value;
                    decide(key, id ? { kind: 'rule', ruleId: id } : null);
                  }}
                >
                  <option value="">Choose…</option>
                  {EVENT_RULES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.range ? '' : ' (no range in the table yet)'}
                    </option>
                  ))}
                </select>
              </label>
              <label class="inline-field">
                Or type your own
                <input
                  type="text"
                  value={decision?.kind === 'custom' ? decision.text : ''}
                  onInput={(e) => {
                    const text = e.currentTarget.value;
                    decide(key, text.trim() ? { kind: 'custom', text } : null);
                  }}
                />
              </label>
              <button
                type="button"
                class="btn btn-quiet"
                onClick={() => decide(key, { kind: 'rejected' })}
              >
                Reject all suggestions
              </button>
              <button
                type="button"
                class="btn btn-quiet"
                disabled={!decision}
                onClick={() => decide(key, null)}
              >
                Clear my choice
              </button>
            </div>
          </section>
        );
      })}

      <TheoryCheck data={data} steps={steps} update={update} />
    </div>
  );
}
