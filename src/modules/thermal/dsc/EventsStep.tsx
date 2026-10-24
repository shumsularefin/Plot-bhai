import { useMemo } from 'preact/hooks';
import {
  BASELINE_LABELS,
  DEFAULT_DETECT_DSC,
  type BaselineKind,
  type DscEventLimit,
} from '../../../core/thermal/dsc';
import { displayExoUp } from '../../../core/thermal/dscClean';
import { DSC_NO_CERTAINTY_NOTE } from '../../../core/thermal/dscGuidance';
import { formatNumber } from '../../../core/xrd/parsers/numbers';
import { HelpTip } from '../../../ui/HelpTip';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import type { EventAssignment } from '../data';
import { dscRules, eventBands, guidance, useDscCurve, useDscView } from './analysis';
import type { DscData } from './data';
import { DscPlot } from './DscPlot';

export const num = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : formatNumber(value, digits);

/** DSC wizard step 3: find peaks, set baselines and limits, read onset, peak, endset and ΔH, get guidance. */
export function DscEventsStep({ data, update }: StepContext<DscData>) {
  const { cleaned } = useDscCurve(data);
  const view = useDscView(data, cleaned);
  const curve = cleaned?.ok ? cleaned.curve : null;
  const bands = useMemo(() => (view ? eventBands(view.events) : []), [view]);

  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no DSC curve yet. Go back to the earlier steps.
      </p>
    );
  }
  const { limits, events } = view;
  const exoUp = displayExoUp(data.setup);

  const setLimits = (next: DscEventLimit[]) =>
    update({
      limits: next.map((l, i) => ({ ...l, id: i + 1 })),
      assignments: {},
      glassWindows: null,
    });
  const editLimit = (id: number, patch: Partial<DscEventLimit>) =>
    setLimits(limits.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const setAssignment = (eventId: number, next: EventAssignment | null) => {
    const rest = Object.fromEntries(
      Object.entries(data.assignments).filter(([id]) => Number(id) !== eventId),
    );
    update({ assignments: next ? { ...rest, [eventId]: next } : rest });
  };
  const enthalpyHeader = curve.specific ? 'ΔH (J/g)' : 'ΔH (mJ)';

  return (
    <div class="events-step">
      <p class="message is-info" role="note">
        Sign convention: {exoUp ? 'exothermic peaks point up' : 'exothermic peaks point down'} on
        the plot. In the table, ΔH is positive for endothermic events (heat absorbed, such as
        melting) and negative for exothermic ones.
      </p>
      <DscPlot
        lines={[
          {
            id: 'curve',
            name: curve.segment.label,
            temperatureC: curve.temperatureC,
            exo: curve.exo,
          },
        ]}
        unit={curve.unit}
        setup={data.setup}
        events={events}
        bands={bands}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="dsc-events"
      />

      <section class="process-step is-on" aria-labelledby="detect-title">
        <h3 id="detect-title" class="process-step-title">
          Find events{' '}
          <HelpTip term="baseline">
            <p>
              The area of a peak is measured from a baseline, the line the curve would follow
              without the event. Linear joins the two ends with a straight line. Sigmoidal lets the
              baseline step across the peak in proportion to the area passed, as it does when the
              heat capacity changes through melting. Spline joins the ends smoothly with their
              slopes. Use linear unless the level before and after the peak differs clearly.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="Smallest peak (% of the curve's range)"
            value={data.detect.prominencePercent}
            min={0}
            max={100}
            onChange={(v) =>
              update({
                detect: {
                  ...data.detect,
                  prominencePercent: v ?? DEFAULT_DETECT_DSC.prominencePercent,
                },
                limits: null,
                assignments: {},
                glassWindows: null,
              })
            }
          />
          <label class="inline-field">
            Baseline for new events
            <select
              value={data.baseline}
              onChange={(e) =>
                update({
                  baseline: e.currentTarget.value as BaselineKind,
                  limits: limits.map((l) => ({
                    ...l,
                    baseline: e.currentTarget.value as BaselineKind,
                  })),
                })
              }
            >
              {Object.entries(BASELINE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            class="btn btn-quiet"
            disabled={data.limits === null}
            onClick={() => update({ limits: null, assignments: {}, glassWindows: null })}
          >
            Back to automatic limits
          </button>
        </div>
        {limits.length === 0 && (
          <p class="message is-warning" role="status">
            No events were found. Lower the smallest peak size above, or check the ramp chosen in
            step 2.
          </p>
        )}
        {limits.map((limit) => (
          <div key={limit.id} class="radiation-fields event-limits">
            <strong>Event {limit.id}</strong>
            <NumberInput
              label="From (°C)"
              value={Number(limit.fromC.toFixed(2))}
              onChange={(v) => v !== null && editLimit(limit.id, { fromC: v })}
            />
            <NumberInput
              label="To (°C)"
              value={Number(limit.toC.toFixed(2))}
              onChange={(v) => v !== null && editLimit(limit.id, { toC: v })}
            />
            <label class="inline-field">
              Baseline
              <select
                value={limit.baseline}
                onChange={(e) =>
                  editLimit(limit.id, { baseline: e.currentTarget.value as BaselineKind })
                }
              >
                {Object.entries(BASELINE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              class="btn btn-quiet"
              onClick={() => setLimits(limits.filter((l) => l.id !== limit.id))}
            >
              Remove<span class="visually-hidden"> event {limit.id}</span>
            </button>
          </div>
        ))}
        <NumberInput
          label="Molar mass (g/mol, optional, gives ΔH in kJ/mol)"
          value={data.molarMassGPerMol}
          min={0}
          onChange={(v) => update({ molarMassGPerMol: v })}
        />
      </section>

      {events.length > 0 && (
        <div class="table-scroll">
          <table class="peak-table">
            <caption>
              Events of {curve.segment.label.toLowerCase()}; exo {exoUp ? 'up' : 'down'} on the
              plot; ΔH endothermic positive
            </caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Type</th>
                <th scope="col">Onset (°C)</th>
                <th scope="col">Peak (°C)</th>
                <th scope="col">Endset (°C)</th>
                <th scope="col">{enthalpyHeader}</th>
                {data.molarMassGPerMol !== null && <th scope="col">ΔH (kJ/mol)</th>}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{e.id}</th>
                  <td>{e.direction === 'endo' ? 'endothermic' : 'exothermic'}</td>
                  <td>{num(e.onsetC)}</td>
                  <td>{num(e.peakC)}</td>
                  <td>{num(e.endsetC)}</td>
                  <td>{num(e.enthalpy, 2)}</td>
                  {data.molarMassGPerMol !== null && <td>{num(e.enthalpyKJPerMol, 2)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {curve.rateKPerMin === null && (
        <p class="message is-warning" role="status">
          No scan rate is known, so there are no enthalpies. Enter the rate in step 1.
        </p>
      )}
      <p class="field-hint">
        {curve.cooling
          ? 'On a cooling ramp the onset is the side at the higher temperature.'
          : 'Onset and endset are extrapolated: the tangent at the steepest flank meets the baseline.'}
      </p>

      <section aria-labelledby="guide-title">
        <h3 id="guide-title" class="process-step-title">
          What could each event be? (guidance, not a result)
        </h3>
        <p class="message is-info" role="note">
          {DSC_NO_CERTAINTY_NOTE}
        </p>
        <p class="message is-warning" role="note">
          <strong>Table not verified yet:</strong> the typical temperature ranges are broad
          placeholders flagged "TODO, verify" in <code>data/thermal/dsc-events.json</code>. Treat
          the ranking as a rough guide until you have checked the ranges against your own sources.
        </p>
        {events.map((event) => {
          const ranked = guidance(data, event, curve.cooling);
          const current = data.assignments[event.id];
          return (
            <article key={event.id} class="step-card" aria-labelledby={`event-${event.id}-title`}>
              <h4 id={`event-${event.id}-title`}>
                Event {event.id}: {event.direction === 'endo' ? 'endothermic' : 'exothermic'} peak
                at {num(event.peakC, 0)} °C
              </h4>
              {ranked.length === 0 ? (
                <p class="field-hint">
                  No typical range in the table fits this event. You can still write your own
                  interpretation.
                </p>
              ) : (
                <ol class="candidate-list">
                  {ranked.map((g) => {
                    const accepted = current?.ruleId === g.rule.id && current.status === 'accepted';
                    return (
                      <li key={g.rule.id}>
                        <p>
                          <strong>{g.rule.name}</strong>{' '}
                          <span class="badge">{g.confidence} confidence</span>
                        </p>
                        <p class="field-hint">
                          {g.reason} {g.rule.notes}
                        </p>
                        <button
                          type="button"
                          class="btn"
                          aria-pressed={accepted}
                          onClick={() =>
                            setAssignment(event.id, {
                              status: 'accepted',
                              ruleId: g.rule.id,
                              label: g.rule.name,
                            })
                          }
                        >
                          {accepted ? 'Accepted' : 'Accept this'}
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
                      setAssignment(
                        event.id,
                        label === '' ? null : { status: 'changed', ruleId: null, label },
                      );
                    }}
                  />
                </label>
                <button
                  type="button"
                  class="btn btn-quiet"
                  onClick={() =>
                    setAssignment(event.id, { status: 'rejected', ruleId: null, label: '' })
                  }
                >
                  Reject all suggestions
                </button>
                <button
                  type="button"
                  class="btn btn-quiet"
                  disabled={!current}
                  onClick={() => setAssignment(event.id, null)}
                >
                  Clear my choice
                </button>
              </div>
              <p class="field-hint" role="status">
                {current
                  ? current.status === 'rejected'
                    ? 'You rejected the suggestions for this event; it stays unassigned.'
                    : `Your choice: ${current.label}${current.status === 'accepted' ? ' (accepted suggestion)' : ' (your own words)'}.`
                  : 'Not decided yet.'}
              </p>
            </article>
          );
        })}
        <p class="field-hint">Ranges are for {dscRules.rangesFor}</p>
      </section>
    </div>
  );
}
