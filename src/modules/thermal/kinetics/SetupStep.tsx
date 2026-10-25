import { useMemo } from 'preact/hooks';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { analyse, prepareRuns, windowOf } from './analysis';
import { METHOD_LABELS, type KineticMethod, type KineticsData } from './data';

/** Kinetics wizard step 2: choose the method and the temperature window of the event. */
export function KineticsSetupStep({ data, update }: StepContext<KineticsData>) {
  const prepared = useMemo(() => prepareRuns(data), [data]);
  const outcome = useMemo(() => analyse(data, prepared), [data, prepared]);
  const runs = useMemo(() => (prepared.ok ? prepared.runs : []), [prepared]);
  const window = prepared.ok ? windowOf(data, runs) : null;
  const kind = runs[0]?.kind ?? 'tga';
  const showMass = data.method !== 'kissinger';

  const sources = useMemo<SeriesSource[]>(
    () =>
      runs.map((r) => ({
        id: String(r.id),
        name: `${r.rate} K/min`,
        x: r.temperatureC,
        y: showMass || r.kind === 'dsc' ? r.value : r.signal,
        unit: showMass ? '%' : r.kind === 'dsc' ? '' : '%/°C',
      })),
    [runs, showMass],
  );
  const yLabel = showMass ? 'Mass (%)' : kind === 'dsc' ? 'Heat flow (as recorded)' : 'DTG (%/°C)';
  const points =
    outcome.ok && outcome.method === 'kissinger'
      ? outcome.peaks.map((p) => ({ x: p.tpC, y: p.signalAtPeak }))
      : [];

  return (
    <div class="kinetics-setup">
      <fieldset class="segmented">
        <legend>
          Method{' '}
          <HelpTip term="kinetic method">
            <p>
              Kissinger uses the peak temperature of one event in each run. The two isoconversional
              methods use the temperature at which the same fraction of the mass has been lost, for
              many fractions, so they show whether the activation energy changes during the step.
              Use TGA runs for those.
            </p>
          </HelpTip>
        </legend>
        {(Object.keys(METHOD_LABELS) as KineticMethod[]).map((m) => (
          <label key={m} class={data.method === m ? 'is-selected' : ''}>
            <input
              type="radio"
              name="kinetic-method"
              checked={data.method === m}
              onChange={() => update({ method: m })}
            />
            {METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>

      <div class="run-form">
        <NumberInput
          label="Window from (°C)"
          value={data.fromC ?? window?.[0] ?? null}
          onChange={(v) => update({ fromC: v })}
        />
        <NumberInput
          label="Window to (°C)"
          value={data.toC ?? window?.[1] ?? null}
          onChange={(v) => update({ toC: v })}
        />
        {data.method === 'kissinger' && kind === 'tga' && (
          <NumberInput
            label="DTG smoothing window (°C)"
            value={data.dtgWindowC}
            min={0}
            onChange={(v) => update({ dtgWindowC: v ?? 10 })}
          />
        )}
        {data.method === 'kissinger' && kind === 'dsc' && (
          <label class="inline-field">
            Event points
            <select
              aria-label="Event direction"
              value={data.peakUp ? 'up' : 'down'}
              onChange={(e) => update({ peakUp: e.currentTarget.value === 'up' })}
            >
              <option value="down">Down in the file</option>
              <option value="up">Up in the file</option>
            </select>
          </label>
        )}
        {!showMass ? null : (
          <>
            <NumberInput
              label="Conversion from"
              value={data.alphaFrom}
              min={0}
              max={1}
              onChange={(v) => update({ alphaFrom: v ?? 0.1 })}
            />
            <NumberInput
              label="Conversion to"
              value={data.alphaTo}
              min={0}
              max={1}
              onChange={(v) => update({ alphaTo: v ?? 0.9 })}
            />
            <NumberInput
              label="Conversion step"
              value={data.alphaStep}
              min={0}
              max={1}
              onChange={(v) => update({ alphaStep: v ?? 0.1 })}
            />
          </>
        )}
      </div>
      <p class="field-hint">
        Choose a window that contains the whole event in every run and no other event. By default
        the window is the temperature range all runs share.
      </p>

      {!prepared.ok && (
        <p class="message is-error" role="alert">
          {prepared.error}
        </p>
      )}
      {prepared.ok && !outcome.ok && (
        <p class="message is-error" role="alert">
          {outcome.error}
        </p>
      )}
      {prepared.ok && (
        <PlotPanel
          sources={sources}
          settings={data.plot}
          onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
          labels={() => ({ x: 'Temperature (°C)', y: yLabel, yValues: true })}
          xName="T"
          xUnit=" °C"
          exportName="kinetics-runs"
          showOverlayOptions={false}
          points={points}
          {...(window && {
            bands: [{ fromX: window[0], toX: window[1], label: 'Window' }],
          })}
        />
      )}
    </div>
  );
}
