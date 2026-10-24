import { useMemo } from 'preact/hooks';
import { NO_CERTAINTY_NOTE } from '../../core/thermal/events';
import { REACTION_EXAMPLES, type Reaction } from '../../core/thermal/formula';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import {
  atomicWeights,
  ATOMIC_WEIGHTS_CITATION,
  candidatesFor,
  eventTable,
  stepBands,
  stepNumberLabels,
  theoryView,
  useThermalView,
} from './analysis';
import type { EventAssignment, ThermalData } from './data';
import { ThermalPlot } from './ThermalPlot';

const num = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? '–' : formatNumber(value, digits);

/** Wizard step 4: ranked event suggestions for each step, and the theoretical mass loss check. */
export function AssignStep({ data, update }: StepContext<ThermalData>) {
  const { curve, view } = useThermalView(data);
  const steps = useMemo(() => view?.analysis.steps ?? [], [view]);
  const theory = useMemo(() => theoryView(data, steps), [data, steps]);
  const candidates = useMemo(() => candidatesFor(data, steps, theory), [data, steps, theory]);
  const bands = useMemo(() => stepBands(steps), [steps]);
  const numbers = useMemo(
    () => (curve ? stepNumberLabels(steps, curve.temperatureC, curve.massPct) : undefined),
    [curve, steps],
  );

  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no cleaned TGA curve yet. Go back to Upload and load a run with a mass column.
      </p>
    );
  }

  const setAssignment = (stepId: number, next: EventAssignment | null) => {
    const rest = Object.fromEntries(
      Object.entries(data.assignments).filter(([id]) => Number(id) !== stepId),
    );
    update({ assignments: next ? { ...rest, [stepId]: next } : rest });
  };
  const setReaction = (patch: Partial<Reaction>, exampleId = 'custom') =>
    update({
      theory: { ...data.theory, exampleId, reaction: { ...data.theory.reaction, ...patch } },
    });

  return (
    <div class="assign-step">
      <p class="message is-info" role="note">
        {NO_CERTAINTY_NOTE}
      </p>
      <p class="message is-warning" role="note">
        <strong>Table not verified yet:</strong> the typical temperature ranges used below are broad
        placeholders and are flagged "TODO, verify" in <code>data/thermal/events.json</code>. Treat
        the ranking as a rough guide until you have checked the ranges against your own sources.
      </p>

      <ThermalPlot
        curves={[
          { id: 'mass', name: 'Mass', temperatureC: curve.temperatureC, mass: curve.massPct },
        ]}
        massUnit="%"
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="tga-events"
        bands={bands}
        {...(numbers && { peakLabels: numbers })}
      />

      <section aria-labelledby="theory-title">
        <h3 id="theory-title" class="process-step-title">
          Theoretical mass loss{' '}
          <HelpTip term="theoretical mass loss">
            <p>
              If you think a step is a known reaction, such as a hydroxide losing water to give an
              oxide, the mass loss can be calculated from the formulas: loss = (moles of precursor ×
              its molar mass − moles of product × its molar mass) ÷ (moles of precursor × its molar
              mass). It is compared with the measured loss as a percentage of the mass just before
              that step. If the precursor lost moisture earlier, use "Set 100 % at" in step 2 or
              enter the dry formula. Agreement supports the idea but does not prove it.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Ready example
            <select
              value={data.theory.exampleId}
              onChange={(e) => {
                const id = e.currentTarget.value;
                const example = REACTION_EXAMPLES.find((x) => x.id === id);
                if (example)
                  update({ theory: { ...data.theory, exampleId: id, reaction: example.reaction } });
                else update({ theory: { ...data.theory, exampleId: 'custom' } });
              }}
            >
              {REACTION_EXAMPLES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
              <option value="custom">My own reaction</option>
            </select>
          </label>
          <label class="inline-field">
            Precursor formula
            <input
              type="text"
              value={data.theory.reaction.precursor}
              onChange={(e) => setReaction({ precursor: e.currentTarget.value })}
            />
          </label>
          <NumberInput
            label="Moles of precursor"
            value={data.theory.reaction.precursorMoles}
            min={0}
            onChange={(v) => setReaction({ precursorMoles: v ?? 1 })}
          />
          <label class="inline-field">
            Solid product formula
            <input
              type="text"
              value={data.theory.reaction.product}
              onChange={(e) => setReaction({ product: e.currentTarget.value })}
            />
          </label>
          <NumberInput
            label="Moles of product"
            value={data.theory.reaction.productMoles}
            min={0}
            onChange={(v) => setReaction({ productMoles: v ?? 1 })}
          />
          <label class="inline-field">
            Compare with step
            <select
              value={data.theory.stepId === null ? '' : String(data.theory.stepId)}
              onChange={(e) => {
                const v = e.currentTarget.value;
                update({ theory: { ...data.theory, stepId: v === '' ? null : Number(v) } });
              }}
            >
              <option value="">none</option>
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  Step {s.id} ({num(s.peakC, 0)} °C)
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Agree within (% points)"
            value={data.theory.agreeWithinPct}
            onChange={(v) =>
              update({ theory: { ...data.theory, agreeWithinPct: Math.max(0, v ?? 1) } })
            }
          />
        </div>
        {!theory.result.ok ? (
          <p class="message is-warning" role="status">
            {theory.result.error}
          </p>
        ) : (
          <div class="table-scroll">
            <table class="peak-table">
              <caption class="visually-hidden">Theoretical and measured mass loss</caption>
              <tbody>
                <tr>
                  <th scope="row">Molar mass of precursor (g/mol)</th>
                  <td>{num(theory.result.precursorGPerMol, 3)}</td>
                </tr>
                <tr>
                  <th scope="row">Molar mass of product (g/mol)</th>
                  <td>{num(theory.result.productGPerMol, 3)}</td>
                </tr>
                <tr>
                  <th scope="row">Theoretical mass loss (%)</th>
                  <td>{num(theory.result.lossPct, 2)}</td>
                </tr>
                {theory.step && (
                  <>
                    <tr>
                      <th scope="row">
                        Measured, step {theory.step.id} (% of mass before the step)
                      </th>
                      <td>{num(theory.measuredPct, 2)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Difference, measured − theoretical (% points)</th>
                      <td>{num(theory.differencePct, 2)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
        {theory.step && theory.result.ok && (
          <p class="field-hint" role="status">
            {theory.agrees
              ? `The measured loss agrees with the theoretical value within ${num(data.theory.agreeWithinPct, 1)} % points. That raises the confidence of the suggestions for step ${theory.step.id}, but it does not prove the reaction.`
              : `The measured loss differs from the theoretical value by more than ${num(data.theory.agreeWithinPct, 1)} % points. The step may be a different reaction, or overlap with another one.`}
          </p>
        )}
        <p class="field-hint">
          Molar masses use the IUPAC abridged standard atomic weights ({ATOMIC_WEIGHTS_CITATION},{' '}
          {Object.keys(atomicWeights).length} elements).
        </p>
      </section>

      <section aria-labelledby="assign-title">
        <h3 id="assign-title" class="process-step-title">
          Suggested events for each step
        </h3>
        <p class="field-hint">
          Ranked from {eventTable.rangesFor} Accept a suggestion, write your own, or reject it. The
          confidence label says how well the evidence fits, not how likely the event is.
        </p>
        {steps.length === 0 && (
          <p class="message is-warning">
            There are no mass loss steps yet. Go back to step 3 to find them.
          </p>
        )}
        {steps.map((step) => {
          const ranked = candidates.get(step.id) ?? [];
          const current = data.assignments[step.id];
          return (
            <article key={step.id} class="step-card" aria-labelledby={`step-${step.id}-title`}>
              <h4 id={`step-${step.id}-title`}>
                Step {step.id}: {num(step.fromC, 0)} to {num(step.toC, 0)} °C, DTG peak{' '}
                {num(step.peakC, 0)} °C, loses {num(step.lossPct, 2)} %
              </h4>
              {ranked.length === 0 ? (
                <p class="field-hint">
                  No typical range in the table fits this temperature and atmosphere. You can still
                  write your own interpretation.
                </p>
              ) : (
                <ol class="candidate-list">
                  {ranked.map((c) => (
                    <li key={c.rule.id}>
                      <p>
                        <strong>{c.rule.name}</strong>{' '}
                        <span class="badge">{c.confidence} confidence</span>
                      </p>
                      <p class="field-hint">
                        {c.reason} {c.rule.notes}
                      </p>
                      <button
                        type="button"
                        class="btn"
                        aria-pressed={
                          current?.ruleId === c.rule.id && current.status === 'accepted'
                        }
                        onClick={() =>
                          setAssignment(step.id, {
                            status: 'accepted',
                            ruleId: c.rule.id,
                            label: c.rule.name,
                          })
                        }
                      >
                        {current?.ruleId === c.rule.id && current.status === 'accepted'
                          ? 'Accepted'
                          : 'Accept this'}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div class="radiation-fields">
                <label class="inline-field">
                  My own interpretation
                  <input
                    type="text"
                    value={current?.status === 'changed' ? current.label : ''}
                    placeholder="for example: loss of coordinated ethanol"
                    onChange={(e) => {
                      const label = e.currentTarget.value.trim();
                      setAssignment(
                        step.id,
                        label === '' ? null : { status: 'changed', ruleId: null, label },
                      );
                    }}
                  />
                </label>
                <button
                  type="button"
                  class="btn btn-quiet"
                  onClick={() =>
                    setAssignment(step.id, { status: 'rejected', ruleId: null, label: '' })
                  }
                >
                  Reject all suggestions
                </button>
                <button
                  type="button"
                  class="btn btn-quiet"
                  disabled={!current}
                  onClick={() => setAssignment(step.id, null)}
                >
                  Clear my choice
                </button>
              </div>
              <p class="field-hint" role="status">
                {current
                  ? current.status === 'rejected'
                    ? 'You rejected the suggestions for this step; it stays unassigned.'
                    : `Your choice: ${current.label}${current.status === 'accepted' ? ' (accepted suggestion)' : ' (your own words)'}.`
                  : 'Not decided yet.'}
              </p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
