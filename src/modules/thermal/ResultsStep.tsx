import { useMemo, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import {
  assignedLabel,
  calcinationOf,
  stepBands,
  stepNumberLabels,
  theoryView,
  useThermalView,
} from './analysis';
import { CompareRuns } from './CompareRuns';
import type { ThermalData } from './data';
import { methodsText } from './methodsText';
import { thermalSession } from './session';
import { ThermalPlot } from './ThermalPlot';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 5;

const num = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? '–' : formatNumber(value, digits);

/** Wizard step 6: results table, figure, methods text and session file. */
export function ResultsStep({ data, update }: StepContext<ThermalData>) {
  const { curve, view } = useThermalView(data);
  const steps = useMemo(() => view?.analysis.steps ?? [], [view]);
  const calcination = useMemo(() => calcinationOf(data, curve, steps), [data, curve, steps]);
  const methods = useMemo(() => methodsText(data, steps, calcination), [data, steps, calcination]);
  const theory = useMemo(() => theoryView(data, steps), [data, steps]);
  const bands = useMemo(() => stepBands(steps), [steps]);
  const numbers = useMemo(
    () => (curve ? stepNumberLabels(steps, curve.temperatureC, curve.massPct) : undefined),
    [curve, steps],
  );
  const [copied, setCopied] = useState<string | null>(null);

  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no cleaned TGA curve yet. Go back to Upload and load a run with a mass column.
      </p>
    );
  }
  const hasMg = curve.referenceMg !== null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };
  const gas =
    data.info.atmosphere === 'other' ? data.info.atmosphereOther || 'other' : data.info.atmosphere;
  const header = `TGA results. Atmosphere ${gas}${data.info.heatingRate !== null ? `, ${formatNumber(data.info.heatingRate, 1)} K/min` : ''}. Temperatures in C, mass in % of the reference mass${hasMg ? ` (${formatNumber(curve.referenceMg as number, 3)} mg = 100 %)` : ''}. Events are the user's interpretation of ranked suggestions; TGA alone cannot identify the evolved species.`;

  return (
    <div class="export-step">
      <section aria-labelledby="run-title">
        <h3 id="run-title" class="export-title">
          The run
        </h3>
        <ul>
          <li>Sample: {data.info.sample || 'not described'}</li>
          <li>Atmosphere: {gas}</li>
          <li>
            Heating rate:{' '}
            {data.info.heatingRate === null ? 'not entered' : `${data.info.heatingRate} K/min`}
          </li>
          <li>
            Initial mass:{' '}
            {data.info.initialMassMg === null ? 'not entered' : `${data.info.initialMassMg} mg`}
          </li>
          {data.file?.synthetic && <li>Generated example data, not a measurement.</li>}
        </ul>
      </section>

      <section aria-labelledby="results-title">
        <h3 id="results-title" class="export-title">
          Mass loss steps and events{' '}
          <HelpTip term="results table">
            <p>
              Onset and endset are extrapolated tangent intersections. The event column holds only
              what you accepted or wrote in step 4; those are interpretations from typical
              temperature ranges, and TGA alone cannot identify the evolved species.
            </p>
          </HelpTip>
        </h3>
        {steps.length === 0 ? (
          <p class="message is-warning">
            No steps were found. Go back to step 3 and adjust the detection.
          </p>
        ) : (
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Results table, scrolls sideways"
          >
            <table class="peak-table">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Onset (°C)</th>
                  <th scope="col">DTG peak (°C)</th>
                  <th scope="col">Endset (°C)</th>
                  <th scope="col">Mass loss (%)</th>
                  {hasMg && <th scope="col">Mass loss (mg)</th>}
                  <th scope="col">Residual (%)</th>
                  <th scope="col">Event (your interpretation)</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.id}</th>
                    <td>{num(s.onsetC)}</td>
                    <td>{num(s.peakC)}</td>
                    <td>{num(s.endsetC)}</td>
                    <td>{num(s.lossPct, 2)}</td>
                    {hasMg && <td>{num(s.lossMg, 3)}</td>}
                    <td>{num(s.residualPct, 2)}</td>
                    <td>{assignedLabel(data, s.id) || 'not assigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p class="field-hint">
          T5 % {num(view.t5)} °C, T10 % {num(view.t10)} °C, T50 % {num(view.t50)} °C. Residue at the
          end ({num(curve.temperatureC[curve.temperatureC.length - 1] ?? null, 0)} °C):{' '}
          {num(curve.massPct[curve.massPct.length - 1] ?? null, 2)} %.
        </p>
        {theory.step && theory.result.ok && (
          <p class="field-hint">
            Theoretical check, step {theory.step.id}: {data.theory.reaction.precursor} →{' '}
            {data.theory.reaction.product} gives {num(theory.result.lossPct, 2)} %; measured{' '}
            {num(theory.measuredPct, 2)} % of the mass before the step.
          </p>
        )}
        {calcination?.ok && (
          <p class="field-hint">
            Calcination (an estimate, to be confirmed experimentally): lowest temperature worth
            trying {num(calcination.minimumC, 0)} °C; candidates{' '}
            {calcination.candidatesC.map((t) => num(t, 0)).join(', ') || 'none inside the range'}{' '}
            °C.
          </p>
        )}
        <div class="export-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={steps.length === 0}
            onClick={() =>
              downloadCsv('tga-results', header, steps, [
                { header: 'Step', value: (s) => s.id },
                { header: 'From (C)', value: (s) => s.fromC },
                { header: 'To (C)', value: (s) => s.toC },
                { header: 'Onset (C)', value: (s) => s.onsetC },
                { header: 'DTG peak (C)', value: (s) => s.peakC },
                { header: 'Endset (C)', value: (s) => s.endsetC },
                { header: 'Mass loss (%)', value: (s) => s.lossPct },
                { header: 'Mass loss (mg)', value: (s) => s.lossMg ?? '' },
                { header: 'Residual (%)', value: (s) => s.residualPct },
                { header: 'Event (user interpretation)', value: (s) => assignedLabel(data, s.id) },
              ])
            }
          >
            Download results (CSV)
          </button>
        </div>
      </section>

      <section aria-labelledby="figure-title">
        <h3 id="figure-title" class="export-title">
          Figure
        </h3>
        <ThermalPlot
          curves={[
            { id: 'mass', name: 'Mass', temperatureC: curve.temperatureC, mass: curve.massPct },
          ]}
          massUnit="%"
          dtg={{ temperatureC: curve.temperatureC, values: view.dtg, unit: '%/°C' }}
          settings={data.plot}
          onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
          exportName="tga-results"
          bands={bands}
          {...(numbers && { peakLabels: numbers })}
        />
      </section>

      <CompareRuns data={data} update={update} curve={curve} />

      <section aria-labelledby="methods-title">
        <h3 id="methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">
          Written only from the settings you used. Nothing about the instrument is included because
          the data files do not say; add it yourself.
        </p>
        <textarea
          class="methods-text"
          readOnly
          rows={10}
          value={methods}
          aria-label="Methods paragraph"
        />
        <div class="export-actions">
          <button type="button" class="btn" onClick={() => void copy()}>
            Copy text
          </button>
        </div>
        <p class="export-status" role="status">
          {copied}
        </p>
      </section>

      <SessionSection
        codec={thermalSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem={data.file?.name ?? 'thermal'}
      />
    </div>
  );
}
