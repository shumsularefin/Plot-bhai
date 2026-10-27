import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ANODES } from '../../core/xrd/radiation';
import { formatHkl } from '../../core/xrd/reference/hkl';
import { phaseReference } from '../../core/xrd/reference/source';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { Hkl } from '../../core/xrd/rietveld/reflections';
import {
  DEFAULT_CHOICES,
  type Estimate,
  type RefineChoices,
  type RietveldInput,
  type RietveldResult,
} from '../../core/xrd/rietveld/refine';
import { rietveldMethods, withUncertainty } from '../../core/xrd/rietveld/report';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { ReferenceLane } from '../../ui/plot/ReferenceLanes';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from './csv';
import { DEFAULT_RIETVELD, type RietveldState, type XrdData } from './data';
import { xrdLabels } from './labels';
import { NumberInput } from './NumberInput';
import { RietveldClient } from './rietveldClient';
import { useCandidatePhases } from './useReferencePhases';
import { ATOMIC_WEIGHTS } from './atomicWeights';

const PHASE_COLORS = [0, 1, 2, 3, 4, 5, 6];

const CHOICE_LABELS: [keyof RefineChoices, string, string][] = [
  ['zero', 'Zero shift', 'A constant 2θ offset of the instrument.'],
  [
    'displacement',
    'Sample displacement',
    'A 2θ shift that falls off as cos θ, from a sample surface above or below the focusing circle. It is strongly correlated with the zero shift: refine both only with a wide 2θ range.',
  ],
  ['cell', 'Unit cells', 'Cell lengths and angles, keeping the symmetry of each phase.'],
  ['width', 'Peak width W and shape η', 'The width of every peak and its Lorentzian fraction.'],
  ['widthSlope', 'Width against angle (U, V)', 'How the width changes with 2θ (Caglioti U and V).'],
  [
    'orientation',
    'Preferred orientation',
    'March–Dollase correction along the direction you type for each phase below.',
  ],
  [
    'overallB',
    'Overall displacement factor B',
    'Thermal vibration on top of the values in the reference structures. Strongly correlated with the background; refine it last and only with good data to high angle.',
  ],
];

/** "0 0 1", "001" or "1,0,0" as (h k l); null when empty or not three integers. */
function parseDirection(text: string): Hkl | null {
  const parts =
    text.trim().includes(' ') || text.includes(',')
      ? text.trim().split(/[\s,]+/)
      : [...text.trim()];
  if (parts.length !== 3) return null;
  const values = parts.map(Number);
  if (!values.every(Number.isInteger) || values.every((v) => v === 0)) return null;
  return values as Hkl;
}

const pct = (e: Estimate | null) => (e ? withUncertainty(100 * e.value, 100 * e.esd, 2) : '–');
const num = (e: Estimate, fixed = 5) => withUncertainty(e.value, e.esd, fixed);

/** Wizard step 5: basic Rietveld refinement of the candidate phases (optional). */
export function RietveldStep({ data, update }: StepContext<XrdData>) {
  const settings = data.rietveld ?? DEFAULT_RIETVELD;
  const set = (patch: Partial<RietveldState>) => update({ rietveld: { ...settings, ...patch } });
  const { phases, failed } = useCandidatePhases(data.material);
  const pattern = data.patterns.find((p) => p.id === settings.patternId) ?? data.patterns[0];
  const included = (phases ?? []).filter((p) => !settings.excluded.includes(p.id));
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<RietveldClient | null>(null);
  useEffect(() => {
    client.current = new RietveldClient();
    return () => client.current?.dispose();
  }, []);

  const lines = ANODES[data.radiation.anode];
  const ratio = data.radiation.kAlpha1Only ? 0 : data.radiation.kAlpha2Ratio;
  const orientationOf = (phase: ReferencePhase) =>
    parseDirection(settings.orientation[phase.id] ?? '');
  const key = JSON.stringify([
    pattern?.id,
    included.map((p) => [p.id, orientationOf(p)]),
    settings.choices,
    settings.backgroundTerms,
    settings.from,
    settings.to,
    data.radiation,
  ]);
  const result: RietveldResult | null =
    settings.result?.outcome.ok === true ? settings.result.outcome : null;
  const stale = settings.result !== null && settings.result.key !== key;

  const methodsOf = (outcome: RietveldResult) =>
    rietveldMethods({
      result: outcome,
      choices: settings.choices,
      backgroundTerms: settings.backgroundTerms,
      phases: outcome.phases.map((r) => {
        const phase = included.find((p) => p.id === r.id);
        return { name: r.name, reference: phase ? phaseReference(phase) : 'reference structure' };
      }),
      radiation:
        ratio > 0
          ? `${data.radiation.anode} Kα1/Kα2 radiation (λ = ${lines.kAlpha1}, ${lines.kAlpha2} Å, intensity ratio ${ratio})`
          : `${data.radiation.anode} Kα1 radiation (λ = ${lines.kAlpha1} Å)`,
    });

  const run = async () => {
    if (!pattern || included.length === 0 || !client.current) return;
    const lo = settings.from ?? -Infinity;
    const hi = settings.to ?? Infinity;
    const keep: number[] = [];
    pattern.twoTheta.forEach((x, i) => {
      if (x >= lo && x <= hi) keep.push(i);
    });
    const input: RietveldInput = {
      x: Float64Array.from(keep, (i) => pattern.twoTheta[i] as number),
      y: Float64Array.from(keep, (i) => pattern.intensity[i] as number),
      wavelengths: { kAlpha1: lines.kAlpha1, kAlpha2: lines.kAlpha2, ratio },
      phases: included.map((p) => ({
        id: p.id,
        name: p.name,
        crystalSystem: p.crystalSystem,
        cell: p.cell,
        peaks: p.peaks,
        ...(p.cellContents && { cellContents: p.cellContents }),
        orientation: settings.choices.orientation ? orientationOf(p) : null,
      })),
      choices: settings.choices,
      backgroundTerms: settings.backgroundTerms,
      atomicWeights: ATOMIC_WEIGHTS,
    };
    setError(null);
    setStage('Starting');
    const outcome = await client.current.refine(input, setStage);
    setStage(null);
    if (!outcome) return;
    if (!outcome.ok) setError(outcome.error);
    else set({ result: { key, outcome, methods: methodsOf(outcome) } });
  };

  const colorOf = (id: string) =>
    PHASE_COLORS[
      Math.max(
        0,
        included.findIndex((p) => p.id === id),
      ) % PHASE_COLORS.length
    ] as number;
  const unit = pattern?.intensityUnit === 'counts' ? 'counts' : 'cps';
  const sources = useMemo<SeriesSource[]>(() => {
    if (!pattern) return [];
    if (!result)
      return [
        {
          id: 'obs',
          name: pattern.name,
          x: pattern.twoTheta,
          y: pattern.intensity,
          unit,
          colorIndex: 7,
        },
      ];
    const x = Float64Array.from(result.x);
    return [
      {
        id: 'obs',
        name: 'Measured',
        x,
        y: Float64Array.from(result.observed),
        unit,
        colorIndex: 7,
      },
      {
        id: 'calc',
        name: 'Calculated',
        x,
        y: Float64Array.from(result.calculated),
        unit,
        colorIndex: 1,
      },
      {
        id: 'bg',
        name: 'Background',
        x,
        y: Float64Array.from(result.background),
        unit,
        colorIndex: 6,
        dashed: true,
      },
    ];
  }, [pattern, result, unit]);
  const residual = useMemo<SeriesSource | undefined>(
    () =>
      result
        ? {
            id: 'diff',
            name: 'Measured − calculated',
            x: Float64Array.from(result.x),
            y: Float64Array.from(result.observed, (v, i) => v - (result.calculated[i] as number)),
            unit,
            colorIndex: 7,
          }
        : undefined,
    [result, unit],
  );
  const lanes = useMemo<ReferenceLane[]>(
    () =>
      (result?.phases ?? []).map((phase) => ({
        id: phase.id,
        name: `${phase.name} (refined positions)`,
        colorIndex: colorOf(phase.id),
        lines: phase.ticks.map((t) => ({ x: t.twoTheta, height: 0.6 })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours follow the result's phases
    [result],
  );

  if (!pattern) return <p>No patterns are loaded. Go back to Upload to add one.</p>;
  if (data.material.candidates.length === 0)
    return (
      <p class="message is-info">
        <strong>Note:</strong> no candidate phase is chosen, so there is nothing to refine. Choose
        phases in step 3, or skip this optional step with Next.
      </p>
    );
  if (failed)
    return (
      <p class="message is-error">
        <strong>Problem:</strong> the reference phases could not be loaded. Reload the page, or skip
        this optional step.
      </p>
    );

  return (
    <div class="rietveld-step">
      <p class="message is-info">
        <strong>Optional.</strong> Fits the whole calculated pattern of your phases to the measured
        one: scale, background, zero shift, cell and peak shape, and weight fractions for mixtures.
        Atom positions are not refined, so this is not a structure refinement. Skip it with Next if
        you only need peak fitting.{' '}
        <HelpTip term="Rietveld refinement">
          <p>
            Every reflection of every phase is drawn with a peak shape whose width follows FWHM² = U
            tan²θ + V tanθ + W, and its intensity comes from the reference structure. The parameters
            are refined in stages by weighted least squares (weights 1/counts). It uses your
            original data, not the cleaned copy, because the weights need raw counts; the zero shift
            and background are refined here.
          </p>
        </HelpTip>
      </p>

      {pattern.synthetic && (
        <p class="field-hint">
          The example patterns have made-up peaks, not those of a real material, so no reference
          phase fits them well. Use your own data to see a meaningful refinement.
        </p>
      )}

      {data.patterns.length > 1 && (
        <label class="inline-field">
          Pattern
          <select
            value={pattern.id}
            onChange={(e) => set({ patternId: e.currentTarget.value, result: null })}
          >
            {data.patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset class="rietveld-phases">
        <legend>Phases to refine</legend>
        {!phases && <p aria-busy="true">Loading the reference phases…</p>}
        {(phases ?? []).map((phase) => (
          <label key={phase.id} class="check">
            <input
              type="checkbox"
              checked={!settings.excluded.includes(phase.id)}
              onChange={(e) =>
                set({
                  excluded: e.currentTarget.checked
                    ? settings.excluded.filter((id) => id !== phase.id)
                    : [...settings.excluded, phase.id],
                })
              }
            />
            {phase.name} <span class="field-hint">({phaseReference(phase)})</span>
          </label>
        ))}
      </fieldset>

      <div class="export-actions">
        {stage === null ? (
          <button
            type="button"
            class="btn btn-primary"
            disabled={included.length === 0}
            onClick={() => void run()}
          >
            {result ? 'Refine again' : 'Refine'}
          </button>
        ) : (
          <button type="button" class="btn" onClick={() => client.current?.cancel()}>
            Cancel
          </button>
        )}
        <p class="export-status" role="status" aria-live="polite">
          {stage !== null
            ? `${stage}…`
            : stale
              ? 'Settings changed since the last refinement. Refine again to update the results.'
              : ''}
        </p>
      </div>
      {error && <p class="message is-warning">{error}</p>}

      <Advanced id="rietveld-choices" title="What to refine">
        <p class="field-hint">
          Scale factors and background are always refined. Parameters are released in the order
          listed.
        </p>
        <div class="rietveld-choices">
          {CHOICE_LABELS.map(([choice, label, help]) => (
            <label key={choice} class="check">
              <input
                type="checkbox"
                checked={settings.choices[choice]}
                onChange={(e) =>
                  set({ choices: { ...settings.choices, [choice]: e.currentTarget.checked } })
                }
              />
              {label}{' '}
              <HelpTip term={label.toLowerCase()}>
                <p>{help}</p>
              </HelpTip>
            </label>
          ))}
        </div>
        {settings.choices.orientation &&
          included.map((phase) => (
            <label key={phase.id} class="inline-field">
              {phase.name}: preferred direction (h k l)
              <input
                value={settings.orientation[phase.id] ?? ''}
                placeholder="for example 0 0 1; empty for none"
                aria-invalid={
                  (settings.orientation[phase.id] ?? '').trim() !== '' && !orientationOf(phase)
                }
                onInput={(e) =>
                  set({
                    orientation: { ...settings.orientation, [phase.id]: e.currentTarget.value },
                  })
                }
              />
            </label>
          ))}
        <div class="radiation-fields">
          <NumberInput
            label="Background terms"
            value={settings.backgroundTerms}
            min={2}
            max={12}
            step={1}
            onChange={(v) => v !== null && set({ backgroundTerms: Math.round(v) })}
          />
          <NumberInput
            label="From 2θ (°)"
            value={settings.from}
            onChange={(v) => set({ from: v })}
          />
          <NumberInput label="To 2θ (°)" value={settings.to} onChange={(v) => set({ to: v })} />
        </div>
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() =>
            set({
              choices: DEFAULT_CHOICES,
              backgroundTerms: DEFAULT_RIETVELD.backgroundTerms,
              from: null,
              to: null,
            })
          }
        >
          Reset to defaults
        </button>
      </Advanced>

      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={xrdLabels}
        xName="2θ"
        xUnit="°"
        exportName={`${pattern.name}-rietveld`}
        showOverlayOptions={false}
        lanes={lanes}
        {...(residual && {
          residual,
          lowerAxis: { y: 'Meas. − calc.', description: 'Measured minus calculated pattern.' },
        })}
      />

      {result && (
        <Results result={result} methods={settings.result?.methods ?? ''} name={pattern.name} />
      )}
    </div>
  );
}

function Results({
  result,
  methods,
  name,
}: {
  result: RietveldResult;
  methods: string;
  name: string;
}) {
  const { stats } = result;
  const [copied, setCopied] = useState('');
  const fractions = result.phases.some((p) => p.weightFraction) && result.phases.length > 1;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying was not allowed here. Select the text and copy it by hand.');
    }
  };
  return (
    <section class="rietveld-results" aria-labelledby="rietveld-results-title">
      <h3 id="rietveld-results-title" class="export-title">
        Refinement results (estimates)
      </h3>
      <dl class="result-summary">
        <div>
          <dt>
            R<sub>wp</sub>{' '}
            <HelpTip term="R_wp">
              <p>
                Weighted profile R-factor: how far the calculated pattern is from the measured one,
                weighting each point by 1/counts. Lower is better; compare it with R_exp.
              </p>
            </HelpTip>
          </dt>
          <dd>{(100 * stats.rwp).toFixed(2)} %</dd>
        </div>
        <div>
          <dt>
            R<sub>exp</sub>{' '}
            <HelpTip term="R_exp">
              <p>
                Expected R-factor: the best R_wp the counting noise allows. An R_wp close to R_exp
                means the model explains the data down to the noise.
              </p>
            </HelpTip>
          </dt>
          <dd>{(100 * stats.rexp).toFixed(2)} %</dd>
        </div>
        <div>
          <dt>
            R<sub>p</sub>
          </dt>
          <dd>{(100 * stats.rp).toFixed(2)} %</dd>
        </div>
        <div>
          <dt>
            χ² (GOF = {stats.gof.toFixed(2)}){' '}
            <HelpTip term="χ² and GOF">
              <p>
                χ² = (R_wp / R_exp)². Near 1 is ideal; well above 1 means the model misses
                something; well below 1 usually means the intensities are not raw counts.
              </p>
            </HelpTip>
          </dt>
          <dd>{stats.chi2.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Zero shift (° 2θ)</dt>
          <dd>{num(result.zero, 4)}</dd>
        </div>
      </dl>

      {(stats.gof > 3 || stats.rwp > 0.25) && (
        <p class="message is-warning">
          <strong>Poor fit:</strong> the calculated pattern does not match the measured one, so the
          numbers below are not reliable. Check that the phases are right (step 3) and look at the
          difference curve under the plot.
        </p>
      )}
      {result.warnings.map((w) => (
        <p key={w} class="message is-warning">
          {w}
        </p>
      ))}

      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Refined phases, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">a (Å)</th>
              <th scope="col">b (Å)</th>
              <th scope="col">c (Å)</th>
              <th scope="col">α (°)</th>
              <th scope="col">β (°)</th>
              <th scope="col">γ (°)</th>
              <th scope="col">V (Å³)</th>
              {fractions && <th scope="col">Weight %</th>}
              <th scope="col">
                R<sub>Bragg</sub> (%)
              </th>
            </tr>
          </thead>
          <tbody>
            {result.phases.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td>{num(p.cell.a)}</td>
                <td>{num(p.cell.b)}</td>
                <td>{num(p.cell.c)}</td>
                <td>{num(p.cell.alpha, 3)}</td>
                <td>{num(p.cell.beta, 3)}</td>
                <td>{num(p.cell.gamma, 3)}</td>
                <td>{num(p.volume, 3)}</td>
                {fractions && <td>{pct(p.weightFraction)}</td>}
                <td>{Number.isFinite(p.rBragg) ? (100 * p.rBragg).toFixed(2) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="field-hint">
        Numbers in brackets are standard uncertainties in the last digits. They come from the
        least-squares fit and usually underestimate the real uncertainty.
      </p>

      <Advanced id="rietveld-details" title="Peak shape, orientation and refinement stages">
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Profile parameters, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">U (deg²)</th>
                <th scope="col">V (deg²)</th>
                <th scope="col">W (deg²)</th>
                <th scope="col">η</th>
                <th scope="col">March–Dollase r</th>
                <th scope="col">B (Å²)</th>
                <th scope="col">Scale</th>
              </tr>
            </thead>
            <tbody>
              {result.phases.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td>{num(p.u)}</td>
                  <td>{num(p.v)}</td>
                  <td>{num(p.w)}</td>
                  <td>{num(p.eta, 3)}</td>
                  <td>
                    {p.orientation && p.orientationDirection
                      ? `${num(p.orientation, 3)} along ${formatHkl([p.orientationDirection])}`
                      : '–'}
                  </td>
                  <td>{num(p.overallB, 3)}</td>
                  <td>{p.scale.value.toExponential(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ol class="rietveld-stages">
          {result.stages.map((s) => (
            <li key={s.name}>
              {s.name}: R<sub>wp</sub> {(100 * s.rwp).toFixed(2)} %
            </li>
          ))}
        </ol>
        {result.displacement.refined && (
          <p>Sample displacement coefficient D (° 2θ): {num(result.displacement, 4)}</p>
        )}
      </Advanced>

      <div class="export-actions">
        <button
          type="button"
          class="btn"
          onClick={() =>
            downloadCsv(
              `${name}-rietveld-phases`,
              `Basic Rietveld refinement (estimates). Rwp ${(100 * stats.rwp).toFixed(3)} %, Rexp ${(100 * stats.rexp).toFixed(3)} %, chi2 ${stats.chi2.toFixed(3)}, zero shift ${result.zero.value} deg (s.u. ${result.zero.esd}).`,
              result.phases,
              [
                { header: 'Phase', value: (p) => p.name },
                ...(['a', 'b', 'c', 'alpha', 'beta', 'gamma'] as const).flatMap((k) => [
                  {
                    header: `${k}${k.length === 1 ? ' (A)' : ' (deg)'}`,
                    value: (p: (typeof result.phases)[number]) => p.cell[k].value,
                  },
                  {
                    header: `s.u. ${k}`,
                    value: (p: (typeof result.phases)[number]) => p.cell[k].esd,
                  },
                ]),
                { header: 'V (A^3)', value: (p) => p.volume.value },
                { header: 's.u. V', value: (p) => p.volume.esd },
                { header: 'Weight fraction', value: (p) => p.weightFraction?.value ?? '' },
                { header: 's.u. weight fraction', value: (p) => p.weightFraction?.esd ?? '' },
                { header: 'R_Bragg', value: (p) => p.rBragg },
                { header: 'U (deg^2)', value: (p) => p.u.value },
                { header: 'V (deg^2)', value: (p) => p.v.value },
                { header: 'W (deg^2)', value: (p) => p.w.value },
                { header: 'eta', value: (p) => p.eta.value },
                { header: 'March-Dollase r', value: (p) => p.orientation?.value ?? '' },
                { header: 'B (A^2)', value: (p) => p.overallB.value },
                { header: 'Scale', value: (p) => p.scale.value },
              ],
            )
          }
        >
          Download results CSV
        </button>
        <button
          type="button"
          class="btn"
          onClick={() =>
            downloadCsv(
              `${name}-rietveld-pattern`,
              'Basic Rietveld refinement: measured, calculated and background intensity.',
              result.x.map((_, i) => i),
              [
                { header: '2theta (deg)', value: (i) => result.x[i] as number },
                { header: 'Measured', value: (i) => result.observed[i] as number },
                { header: 'Calculated', value: (i) => result.calculated[i] as number },
                { header: 'Background', value: (i) => result.background[i] as number },
                {
                  header: 'Difference',
                  value: (i) => (result.observed[i] as number) - (result.calculated[i] as number),
                },
              ],
            )
          }
        >
          Download pattern CSV
        </button>
      </div>

      <h4 class="export-title">Methods text</h4>
      <p class="methods-text">{methods}</p>
      <div class="export-actions">
        <button type="button" class="btn" onClick={() => void copy()}>
          Copy text
        </button>
        <p class="export-status" role="status">
          {copied}
        </p>
      </div>
    </section>
  );
}
