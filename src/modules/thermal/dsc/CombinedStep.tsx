import { useMemo } from 'preact/hooks';
import { CALCINATION_WARNING } from '../../../core/thermal/calcination';
import { DEFAULT_MASS_THRESHOLD_PCT } from '../../../core/thermal/combined';
import { displayExoUp } from '../../../core/thermal/dscClean';
import { DSC_NO_CERTAINTY_NOTE } from '../../../core/thermal/dscGuidance';
import { NO_CERTAINTY_NOTE } from '../../../core/thermal/events';
import { HelpTip } from '../../../ui/HelpTip';
import type { PlotBand } from '../../../ui/plot/types';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { stepBands } from '../analysis';
import type { EventAssignment } from '../data';
import { ThermalPlot } from '../ThermalPlot';
import { useDscCurve, useDscView } from './analysis';
import { COMBINED_UNVERIFIED_NOTE, useCombined } from './combinedAnalysis';
import type { DscData } from './data';
import { heatFlowLabel } from './DscPlot';
import { num } from './EventsStep';

interface Option {
  id: string;
  name: string;
  confidence: string;
  reason: string;
}

interface ChoiceCardProps {
  id: string;
  title: string;
  intro?: string;
  options: readonly Option[];
  current: EventAssignment | undefined;
  onChange: (next: EventAssignment | null) => void;
  emptyText: string;
}

/** Ranked suggestions with Accept, the user's own words, Reject and Clear. */
function ChoiceCard({ id, title, intro, options, current, onChange, emptyText }: ChoiceCardProps) {
  return (
    <article class="step-card" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>{title}</h4>
      {intro && <p>{intro}</p>}
      {options.length === 0 ? (
        <p class="field-hint">{emptyText}</p>
      ) : (
        <ol class="candidate-list">
          {options.map((o) => {
            const accepted = current?.ruleId === o.id && current.status === 'accepted';
            return (
              <li key={o.id}>
                <p>
                  <strong>{o.name}</strong> <span class="badge">{o.confidence} confidence</span>
                </p>
                <p class="field-hint">{o.reason}</p>
                <button
                  type="button"
                  class="btn"
                  aria-pressed={accepted}
                  onClick={() => onChange({ status: 'accepted', ruleId: o.id, label: o.name })}
                >
                  {accepted ? 'Accepted' : 'Accept this'}
                  <span class="visually-hidden"> {o.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div class="radiation-fields">
        <label class="inline-field">
          My own interpretation
          <input
            type="text"
            value={current?.status === 'changed' ? current.label : ''}
            placeholder="for example: enthalpy relaxation"
            onChange={(e) => {
              const label = e.currentTarget.value.trim();
              onChange(label === '' ? null : { status: 'changed', ruleId: null, label });
            }}
          />
        </label>
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => onChange({ status: 'rejected', ruleId: null, label: '' })}
        >
          Reject all suggestions
        </button>
        <button
          type="button"
          class="btn btn-quiet"
          disabled={!current}
          onClick={() => onChange(null)}
        >
          Clear my choice
        </button>
      </div>
      <p class="field-hint" role="status">
        {current
          ? current.status === 'rejected'
            ? 'You rejected the suggestions; it stays unassigned.'
            : `Your choice: ${current.label}${current.status === 'accepted' ? ' (accepted suggestion)' : ' (your own words)'}.`
          : 'Not decided yet.'}
      </p>
    </article>
  );
}

const without = (record: Record<number, EventAssignment>, id: number) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => Number(key) !== id));

/** DSC wizard step 5: read the DSC events against the mass curve and re-rank the suggestions. */
export function DscCombinedStep({ data, update }: StepContext<DscData>) {
  const { cleaned } = useDscCurve(data);
  const view = useDscView(data, cleaned);
  const curve = cleaned?.ok ? cleaned.curve : null;
  const combined = useCombined(data, curve, view?.events ?? []);
  const bands = useMemo<PlotBand[]>(
    () => [
      ...(view?.events ?? []).map((e) => ({ fromX: e.fromC, toX: e.toC, label: `E${e.id}` })),
      ...(combined.ok ? stepBands(combined.view.steps) : []).map((b) => ({
        ...b,
        label: `S${b.label}`,
      })),
    ],
    [view, combined],
  );

  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no DSC curve yet. Go back to the earlier steps.
      </p>
    );
  }
  if (!combined.ok) {
    return (
      <p class="message is-warning" role="status">
        {combined.message}
      </p>
    );
  }
  const exoUp = displayExoUp(data.setup);
  const c = combined.view;
  const sign = exoUp ? 1 : -1;
  const setEvent = (id: number, next: EventAssignment | null) =>
    update({
      assignments: next
        ? { ...without(data.assignments, id), [id]: next }
        : without(data.assignments, id),
    });
  const setStep = (id: number, next: EventAssignment | null) =>
    update({
      stepAssignments: next
        ? { ...without(data.stepAssignments, id), [id]: next }
        : without(data.stepAssignments, id),
    });

  return (
    <div class="combined-step">
      <p class="message is-info" role="note">
        The mass curve ({c.source}) is placed on the temperatures of the DSC curve by linear
        interpolation, so both panels share one temperature axis. Heat flow: exo{' '}
        {exoUp ? 'up' : 'down'}. Everything below is guidance, not a result.
      </p>
      <ThermalPlot
        curves={[
          {
            id: 'mass',
            name: 'Mass',
            temperatureC: c.aligned.temperatureC,
            mass: c.aligned.massPct,
          },
        ]}
        massUnit="%"
        heatFlow={{
          temperatureC: c.aligned.temperatureC,
          values: sign === 1 ? c.aligned.exo : c.aligned.exo.map((v) => -v),
          unit: curve.unit,
          axis: heatFlowLabel(curve.unit, exoUp),
        }}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="tga-dsc-combined"
        bands={bands}
      />
      <p class="field-hint">
        E marks a DSC event and S a mass loss step. The aligned curves cover{' '}
        {num(c.aligned.fromC, 0)} to {num(c.aligned.toC, 0)} °C.
      </p>

      <section class="process-step is-on" aria-labelledby="combined-rules-title">
        <h3 id="combined-rules-title" class="process-step-title">
          How a DSC event and the mass are read together{' '}
          <HelpTip term="mass change threshold">
            <p>
              A change smaller than the threshold counts as "no mass change". The default is a small
              value to ignore noise and drift; raise it for a noisy balance.
            </p>
          </HelpTip>
        </h3>
        <ul>
          <li>Mass loss with an endotherm suggests dehydration, evaporation or decomposition.</li>
          <li>Mass loss with an exotherm suggests combustion or oxidation.</li>
          <li>
            No mass change with an exotherm suggests crystallisation, a phase transition or
            structural ordering.
          </li>
          <li>No mass change with an endotherm suggests melting or a solid-solid transition.</li>
        </ul>
        <NumberInput
          label="Counts as no mass change below (% points)"
          value={data.massThresholdPct}
          min={0}
          onChange={(v) =>
            update({ massThresholdPct: Math.max(0, v ?? DEFAULT_MASS_THRESHOLD_PCT) })
          }
        />
        <p class="message is-info" role="note">
          {DSC_NO_CERTAINTY_NOTE} {NO_CERTAINTY_NOTE}
        </p>
        <p class="message is-warning" role="note">
          <strong>Table not verified yet:</strong> {COMBINED_UNVERIFIED_NOTE}
        </p>
      </section>

      <section aria-labelledby="combined-events-title">
        <h3 id="combined-events-title" class="process-step-title">
          DSC events read against the mass (guidance)
        </h3>
        {view.events.length === 0 && (
          <p class="field-hint">No DSC events were found. Go back to step 3.</p>
        )}
        {view.events.map((event, i) => {
          const correlation = c.correlations[i];
          return (
            <ChoiceCard
              key={event.id}
              id={`combined-event-${event.id}`}
              title={`Event ${event.id}: ${event.direction === 'endo' ? 'endothermic' : 'exothermic'} peak at ${num(event.peakC, 0)} °C`}
              intro={correlation?.text ?? ''}
              options={(c.eventGuidance.get(event.id) ?? []).map((g) => ({
                id: g.rule.id,
                name: g.rule.name,
                confidence: g.confidence,
                reason: `${g.reason} ${g.rule.notes}`,
              }))}
              current={data.assignments[event.id]}
              onChange={(next) => setEvent(event.id, next)}
              emptyText="No typical range in the table fits this event. You can still write your own interpretation."
            />
          );
        })}
      </section>

      <section aria-labelledby="combined-steps-title">
        <h3 id="combined-steps-title" class="process-step-title">
          Mass loss steps read against the DSC (guidance)
        </h3>
        {c.steps.length === 0 && <p class="field-hint">No mass loss steps were found.</p>}
        {c.steps.map((step) => {
          const guide = c.stepGuidance.get(step.id);
          return (
            <ChoiceCard
              key={step.id}
              id={`combined-step-${step.id}`}
              title={`Step ${step.id}: ${num(step.lossPct, 1)} % lost between ${num(step.fromC, 0)} and ${num(step.toC, 0)} °C`}
              intro={
                guide?.eventId != null
                  ? `DSC event ${guide.eventId} lies in this step, so the suggestions below use its direction.`
                  : 'No DSC event lies in this step, so the suggestions are those of the TGA alone.'
              }
              options={(guide?.candidates ?? []).map((cand) => ({
                id: cand.rule.id,
                name: cand.rule.name,
                confidence: cand.confidence,
                reason: cand.reason,
              }))}
              current={data.stepAssignments[step.id]}
              onChange={(next) => setStep(step.id, next)}
              emptyText="No typical range in the table fits this step. You can still write your own interpretation."
            />
          );
        })}
      </section>

      <section aria-labelledby="combined-calc-title">
        <h3 id="combined-calc-title" class="process-step-title">
          Calcination starting point (an estimate)
        </h3>
        <p class="message is-warning" role="note">
          <strong>Read this first:</strong> {CALCINATION_WARNING}
        </p>
        {c.calcination.ok ? (
          <p role="status">
            <strong>Lowest temperature worth trying: {num(c.calcination.minimumC, 0)} °C.</strong>{' '}
            {c.calcination.candidatesC.length > 0 &&
              `Candidates: ${c.calcination.candidatesC.map((t) => num(t, 0)).join(', ')} °C.`}
          </p>
        ) : (
          <p class="message is-warning" role="status">
            {c.calcination.error}
          </p>
        )}
        {c.marks.length > 0 ? (
          <ul>
            {c.marks.map((m) => (
              <li key={m.eventId}>{m.text}</li>
            ))}
          </ul>
        ) : (
          <p class="field-hint">
            No exotherm without a mass change lies above the last mass loss step, so the DSC adds no
            mark to the suggestion.
          </p>
        )}
      </section>
    </div>
  );
}
