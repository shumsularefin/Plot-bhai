import { useMemo, useState } from 'preact/hooks';
import { EA_VARIATION_LIMIT } from '../../../core/thermal/kinetics';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import { SessionSection } from '../../../ui/SessionSection';
import type { StepContext } from '../../../ui/wizard/types';
import { downloadCsv } from '../../xrd/csv';
import { TableBox } from '../../xrd/MethodDetails';
import { analyse, prepareRuns, type KineticOutcome } from './analysis';
import { METHOD_LABELS, type KineticsData } from './data';
import { kineticsMethodsText } from './methodsText';
import { kineticsSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 2;

const pm = (v: number, s: number, digits = 1) => `${v.toFixed(digits)} ± ${s.toFixed(digits)}`;

/** Kinetics wizard step 3: the activation energy, its plot and table, methods text and export. */
export function KineticsResultsStep({ data, update }: StepContext<KineticsData>) {
  const prepared = useMemo(() => prepareRuns(data), [data]);
  const outcome = useMemo<KineticOutcome>(() => analyse(data, prepared), [data, prepared]);
  const methods = useMemo(
    () => kineticsMethodsText(data, prepared, outcome),
    [data, prepared, outcome],
  );
  const [copied, setCopied] = useState<string | null>(null);
  if (!outcome.ok) {
    return (
      <p class="message is-error" role="alert">
        {outcome.error}
      </p>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };

  let headline: string;
  let sources: SeriesSource[];
  let points: { x: number; y: number }[];
  let labels: { x: string; y: string };
  let xName: string;
  let xUnit: string;
  if (outcome.method === 'kissinger') {
    const r = outcome.result;
    headline = `Apparent activation energy Ea = ${pm(r.eaKJ, r.eaSigmaKJ)} kJ/mol (R² = ${r.rSquared.toFixed(4)})`;
    const xs = r.points.map((p) => p.x);
    const ends = Float64Array.of(Math.min(...xs), Math.max(...xs));
    sources = [
      {
        id: 'fit',
        name: 'Straight-line fit',
        x: ends.map((x) => x * 1000),
        y: ends.map((x) => r.line.intercept + r.line.slope * x),
        unit: '',
      },
    ];
    points = r.points.map((p) => ({ x: p.x * 1000, y: p.y }));
    labels = { x: '1000 / T_p (K⁻¹)', y: 'ln(β / T_p²)  (β in K/min, T_p in K)' };
    xName = '1000/T';
    xUnit = ' K⁻¹';
  } else {
    const levels = outcome.levels;
    const mean = levels.reduce((s, l) => s + l.eaKJ, 0) / levels.length;
    headline = `Ea ranges from ${Math.min(...levels.map((l) => l.eaKJ)).toFixed(1)} to ${Math.max(...levels.map((l) => l.eaKJ)).toFixed(1)} kJ/mol (mean ${mean.toFixed(1)}) over α = ${levels[0]?.alpha} to ${levels[levels.length - 1]?.alpha}`;
    sources = [
      {
        id: 'ea',
        name: 'Ea',
        x: Float64Array.from(levels, (l) => l.alpha),
        y: Float64Array.from(levels, (l) => l.eaKJ),
        unit: 'kJ/mol',
      },
    ];
    points = levels.map((l) => ({ x: l.alpha, y: l.eaKJ }));
    labels = { x: 'Conversion α', y: 'Apparent Ea (kJ/mol)' };
    xName = 'α';
    xUnit = '';
  }

  const exportTable = () => {
    if (outcome.method === 'kissinger') {
      downloadCsv(
        'kinetics-kissinger',
        `Kissinger method, Ea = ${outcome.result.eaKJ.toFixed(3)} kJ/mol; beta in K/min, Tp in degC`,
        outcome.peaks,
        [
          { header: 'Run', value: (p) => p.name },
          { header: 'Heating rate (K/min)', value: (p) => p.betaKPerMin },
          { header: 'Tp (°C)', value: (p) => p.tpC },
        ],
      );
    } else {
      downloadCsv(
        `kinetics-${outcome.method}`,
        `${METHOD_LABELS[outcome.method]}; Ea in kJ/mol with standard error of the fit`,
        outcome.levels,
        [
          { header: 'Conversion', value: (l) => l.alpha },
          { header: 'Ea (kJ/mol)', value: (l) => l.eaKJ },
          { header: 'Ea standard error (kJ/mol)', value: (l) => l.eaSigmaKJ },
          { header: 'R²', value: (l) => l.rSquared },
        ],
      );
    }
  };

  return (
    <div class="results-step">
      <p class="message is-info" role="note">
        {METHOD_LABELS[outcome.method]}: {headline}. This is an estimate of an{' '}
        <strong>apparent</strong> activation energy.
      </p>
      <ul class="pattern-messages">
        {outcome.notes.map((n, i) => (
          <li key={i} class={`message is-${n.level}`}>
            {n.text}
          </li>
        ))}
      </ul>

      <section aria-labelledby="kin-table-title">
        <h3 id="kin-table-title" class="export-title">
          {outcome.method === 'kissinger' ? 'Peak temperatures' : 'Activation energy by conversion'}{' '}
          <HelpTip term="apparent activation energy">
            <p>
              The energy that best describes how the rate changes with temperature for the whole
              process. A real process with several steps has no single activation energy; if the
              value changes a lot with conversion (more than {EA_VARIATION_LIMIT * 100} % of the
              mean here) treat one number with care.
            </p>
          </HelpTip>
        </h3>
        <TableBox label="Kinetics table" onExport={exportTable}>
          {outcome.method === 'kissinger' ? (
            <>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">β (K/min)</th>
                  <th scope="col">Tp (°C)</th>
                </tr>
              </thead>
              <tbody>
                {outcome.peaks.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.betaKPerMin}</td>
                    <td>{p.tpC.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr>
                  <th scope="col">α</th>
                  <th scope="col">Ea (kJ/mol)</th>
                  <th scope="col">R²</th>
                  <th scope="col">Runs used</th>
                </tr>
              </thead>
              <tbody>
                {outcome.levels.map((l) => (
                  <tr key={l.alpha}>
                    <td>{l.alpha}</td>
                    <td>{pm(l.eaKJ, l.eaSigmaKJ)}</td>
                    <td>{l.rSquared.toFixed(4)}</td>
                    <td>{l.points.length}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </TableBox>
      </section>

      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() => ({ ...labels, yValues: true })}
        xName={xName}
        xUnit={xUnit}
        exportName={`kinetics-${outcome.method}`}
        showOverlayOptions={false}
        points={points}
      />

      <section aria-labelledby="kin-methods-title">
        <h3 id="kin-methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">Written only from the settings you used and the numbers above.</p>
        <textarea
          class="methods-text"
          readOnly
          rows={8}
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
        codec={kineticsSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem="kinetics"
      />
    </div>
  );
}
