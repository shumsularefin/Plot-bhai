import { useMemo, useState } from 'preact/hooks';
import { thermalMethodsParagraph } from '../../core/thermal/methods';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { useCalcination, useCleaned, useStepsView } from './analysis';
import { stepKey, type ThermalData } from './data';
import { decisionName } from './eventTable';
import { ATMOSPHERES, CATEGORIES } from './names';
import { thermalSession } from './session';
import { ThermalPlot } from './ThermalPlot';
import { useTheory } from './TheoryCheck';
import { EVOLVED_SPECIES_NOTE } from '../../core/thermal/events';
import { CALCINATION_WARNING } from '../../core/thermal/calcination';

const RESULTS_STEP = 5;
const num = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? '–' : formatNumber(value, digits);

/** Wizard step 6: everything in one place, with tables, figure, methods text and session file. */
export function ResultsStep({ data, update }: StepContext<ThermalData>) {
  const { cleaned } = useCleaned(data);
  const view = useStepsView(data, cleaned);
  const suggestion = useCalcination(data, cleaned, view);
  const steps = useMemo(() => view?.analysis.steps ?? [], [view]);
  const theory = useTheory(data.theory, steps);
  const [copied, setCopied] = useState('');
  const curve = cleaned?.ok ? cleaned.curve : null;
  const info = data.info;

  const stepNote = useMemo(
    () => (s: { peakC: number }) => {
      const name = decisionName(data.events[stepKey(s.peakC)]);
      return name ? ` (suggested: ${name})` : '';
    },
    [data.events],
  );

  const methods = useMemo(() => {
    if (!curve || !view) return '';
    const T = curve.temperatureC;
    const eventOf = (peakC: number) => decisionName(data.events[stepKey(peakC)]);
    const matched = theory?.result.ok && theory.step ? theory : null;
    return thermalMethodsParagraph({
      synthetic: data.file?.synthetic ?? false,
      atmosphere:
        info.atmosphere === 'other'
          ? info.atmosphereOther.trim() || 'another gas'
          : (ATMOSPHERES[info.atmosphere] as string).toLowerCase(),
      heatingRate: info.heatingRate,
      initialMassMg: info.initialMassMg,
      sample: info.sample,
      rangeC: { fromC: T[0] as number, toC: T[T.length - 1] as number },
      smoothWindowC: data.clean.smoothWindowC,
      blankSubtracted: data.clean.useBlank && data.blank !== null,
      normaliseAtC: data.clean.normaliseAtC,
      dtgWindowC: data.steps.dtgWindowC,
      prominencePercent: data.steps.detect.prominencePercent,
      minSeparationC: data.steps.detect.minSeparationC,
      limitsEdited: data.steps.limits !== null,
      stepCount: steps.length,
      events: steps.flatMap((s) => {
        const name = eventOf(s.peakC);
        return name ? [{ peakC: s.peakC, name }] : [];
      }),
      theory:
        matched?.result.ok && matched.step
          ? {
              reaction: `${data.theory.precursor} → ${data.theory.product}`,
              theoreticalPct: matched.result.value.lossPct,
              measuredPct: matched.step.lossPct,
            }
          : null,
      calcination:
        suggestion?.minimumC != null
          ? {
              thresholdPct: data.calcination.thresholdPct,
              marginC: data.calcination.marginC,
              minimumC: suggestion.minimumC,
            }
          : null,
    });
  }, [curve, view, data, info, steps, theory, suggestion]);

  if (!curve || !view) {
    return (
      <p class="message is-info">
        There are no results yet. Go back to the first steps and load a run with a mass column.
      </p>
    );
  }

  const eventOf = (peakC: number) => decisionName(data.events[stepKey(peakC)]);
  const hasMg = curve.referenceMg !== null;
  const note = `TGA of ${data.file?.name ?? 'run'}${data.file?.synthetic ? ' (synthetic example, not a measurement)' : ''}. Temperatures in °C; mass in % of the reference mass${hasMg ? ` (${num(curve.referenceMg, 3)} mg = 100 %)` : ''}. Onset and endset are extrapolated tangent intersections. Event names are suggestions only; TGA alone cannot identify the evolved species.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };

  const runRows: [string, string][] = [
    ['File', `${data.file?.name ?? ''}${data.file?.synthetic ? ' (synthetic example)' : ''}`],
    [
      'Atmosphere',
      info.atmosphere === 'other'
        ? `Other gas: ${info.atmosphereOther || 'not named'}`
        : (ATMOSPHERES[info.atmosphere] as string),
    ],
    ['Heating rate', info.heatingRate !== null ? `${num(info.heatingRate)} K/min` : 'not given'],
    [
      'Initial mass',
      info.initialMassMg !== null ? `${num(info.initialMassMg, 3)} mg` : 'not given',
    ],
    ['Sample', info.sample || 'not described'],
    ['Sample kind', CATEGORIES[info.category] as string],
    [
      'Temperature range used',
      `${num(curve.temperatureC[0] as number, 0)} to ${num(curve.temperatureC[curve.temperatureC.length - 1] as number, 0)} °C`,
    ],
  ];

  return (
    <div class="results-step">
      <p class="message is-warning" role="note">
        {EVOLVED_SPECIES_NOTE} Event names and the calcination temperature below are suggestions
        (estimates), not results.
      </p>

      <section aria-labelledby="run-title">
        <h3 id="run-title" class="export-title">
          The run
        </h3>
        <div class="table-scroll">
          <table class="peak-table">
            <tbody>
              {runRows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="steps-results">
        <h3 id="steps-results" class="export-title">
          Mass loss steps
        </h3>
        {steps.length === 0 ? (
          <p class="field-hint">No steps were found. Go back to step 3.</p>
        ) : (
          <div class="table-scroll">
            <table class="peak-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Onset (°C)</th>
                  <th>DTG peak (°C)</th>
                  <th>Endset (°C)</th>
                  <th>Loss (%)</th>
                  <th>Loss (mg)</th>
                  <th>Residual (%)</th>
                  <th>Suggested event</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{num(s.onsetC, 0)}</td>
                    <td>{num(s.peakC, 0)}</td>
                    <td>{num(s.endsetC, 0)}</td>
                    <td>{num(s.lossPct, 1)}</td>
                    <td>{num(s.lossMg, 3)}</td>
                    <td>{num(s.residualPct, 1)}</td>
                    <td>{eventOf(s.peakC) ?? 'not assigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          T<sub>5%</sub> {num(view.t5, 0)} °C, T<sub>10%</sub> {num(view.t10, 0)} °C, T
          <sub>50%</sub> {num(view.t50, 0)} °C
          {data.steps.residueAtC !== null
            ? `; residue at ${num(data.steps.residueAtC, 0)} °C: ${num(view.residuePct, 1)} %`
            : ''}
          .
        </p>
        {theory?.result.ok && theory.step && (
          <p>
            Theory: {data.theory.precursor} → {data.theory.product} loses{' '}
            {num(theory.result.value.lossPct, 2)} %; step {theory.step.id} lost{' '}
            {num(theory.step.lossPct, 2)} % (difference{' '}
            {num(theory.step.lossPct - theory.result.value.lossPct, 2)} percentage points).
          </p>
        )}
        {suggestion?.minimumC != null && (
          <p>
            Calcination (estimate): minimum {num(suggestion.minimumC, 0)} °C; temperatures to test:{' '}
            {suggestion.candidatesC.join(', ')} °C. {CALCINATION_WARNING}
          </p>
        )}
        <div class="export-actions">
          <button
            type="button"
            class="btn"
            disabled={steps.length === 0}
            onClick={() =>
              downloadCsv('tga-results', note, steps, [
                { header: 'Step', value: (s) => s.id },
                { header: 'Onset (C)', value: (s) => s.onsetC },
                { header: 'DTG peak (C)', value: (s) => s.peakC },
                { header: 'Endset (C)', value: (s) => s.endsetC },
                { header: 'Mass loss (%)', value: (s) => s.lossPct },
                { header: 'Mass loss (mg)', value: (s) => s.lossMg ?? '' },
                { header: 'Residual mass (%)', value: (s) => s.residualPct },
                { header: 'Suggested event', value: (s) => eventOf(s.peakC) ?? '' },
              ])
            }
          >
            Download results (CSV)
          </button>
        </div>
      </section>

      <ThermalPlot
        curves={[
          { id: 'mass', name: 'Mass', temperatureC: curve.temperatureC, mass: curve.massPct },
        ]}
        massUnit="%"
        steps={steps}
        stepNote={stepNote}
        dtg={{ temperatureC: curve.temperatureC, values: view.dtg, unit: '%/°C' }}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="tga-results"
      />

      <section aria-labelledby="thermal-methods">
        <h3 id="thermal-methods" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">
          Written only from the settings you used. Add the instrument, crucible and gas flow
          yourself; the data file does not state them reliably.
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
        stem={data.file?.name.replace(/\.[^.]+$/, '') ?? 'tga'}
      />
    </div>
  );
}
