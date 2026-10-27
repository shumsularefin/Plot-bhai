import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import type { LineMethod, LineResult, ScherrerResult } from '../../core/xrd/size/methods';
import type { DataMessage } from '../../core/xrd/types';
import { formatWithSigma } from '../../ui/format';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { AxisLabels } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from './csv';
import type { XrdData } from './data';
import { METHOD_NAMES, type ResultPeak } from './sizeResults';

const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;
const LEVEL_ORDER = ['error', 'warning', 'info'] as const;

/**
 * Problems, checks and notes as a compact log that opens on demand. It starts open when it
 * holds a problem, so errors are never hidden.
 */
export function CheckLog({ messages }: { messages: readonly DataMessage[] }) {
  if (messages.length === 0) return null;
  const counts = LEVEL_ORDER.map((level) => ({
    level,
    n: messages.filter((m) => m.level === level).length,
  })).filter((c) => c.n > 0);
  return (
    <details class="check-log" open={counts[0]?.level === 'error'}>
      <summary>
        Checks and notes{' '}
        <span class="check-log-count">
          (
          {counts
            .map((c) => `${c.n} ${LEVEL_LABELS[c.level].toLowerCase()}${c.n === 1 ? '' : 's'}`)
            .join(', ')}
          )
        </span>
      </summary>
      <ul class="check-log-list">
        {[...messages]
          .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))
          .map((m, i) => (
            <li key={i} class={`message is-${m.level}`}>
              <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
            </li>
          ))}
      </ul>
    </details>
  );
}

const i = (text: string) => <tspan font-style="italic">{text}</tspan>;
const theta = i('θ');
const beta = i('β');

/** Axis labels and the plain-text names used in CSV headers. */
const AXES: Record<LineMethod, { labels: AxisLabels; x: string; y: string }> = {
  monshi: {
    labels: { x: <>ln(1/cos {theta})</>, y: <>ln {beta}</>, yValues: true },
    x: 'ln(1/cos θ)',
    y: 'ln β',
  },
  'linear-scherrer': {
    labels: {
      x: (
        <>
          1/{beta} (rad<tspan baseline-shift="super">−1</tspan>)
        </>
      ),
      y: <>cos {theta}</>,
      yValues: true,
    },
    x: '1/β (1/rad)',
    y: 'cos θ',
  },
  sahadat: {
    labels: {
      x: (
        <>
          1/{beta} (rad<tspan baseline-shift="super">−1</tspan>)
        </>
      ),
      y: <>cos {theta}</>,
      yValues: true,
    },
    x: '1/β (1/rad)',
    y: 'cos θ',
  },
  'wh-udm': {
    labels: {
      x: <>4 sin {theta}</>,
      y: (
        <>
          {beta} cos {theta}
        </>
      ),
      yValues: true,
    },
    x: '4 sin θ',
    y: 'β cos θ',
  },
  'wh-usdm': {
    labels: {
      x: (
        <>
          4 sin {theta}/{i('E')} (GPa<tspan baseline-shift="super">−1</tspan>)
        </>
      ),
      y: (
        <>
          {beta} cos {theta}
        </>
      ),
      yValues: true,
    },
    x: '4 sin θ / E (1/GPa)',
    y: 'β cos θ',
  },
  'wh-udedm': {
    labels: {
      x: (
        <>
          4 sin {theta} (2/{i('E')})<tspan baseline-shift="super">1/2</tspan> (GPa
          <tspan baseline-shift="super">−1/2</tspan>)
        </>
      ),
      y: (
        <>
          {beta} cos {theta}
        </>
      ),
      yValues: true,
    },
    x: '4 sin θ (2/E)^0.5 (GPa^-0.5)',
    y: 'β cos θ',
  },
  ssp: {
    labels: {
      x: (
        <>
          {i('d')}
          <tspan baseline-shift="super">2</tspan>
          {beta} cos {theta} (nm<tspan baseline-shift="super">2</tspan>)
        </>
      ),
      y: (
        <>
          ({i('d')}
          {beta} cos {theta})<tspan baseline-shift="super">2</tspan> (nm
          <tspan baseline-shift="super">2</tspan>)
        </>
      ),
      yValues: true,
    },
    x: 'd² β cos θ (nm²)',
    y: '(d β cos θ)² (nm²)',
  },
  hw: {
    labels: {
      x: (
        <>
          {beta}/(tan {theta} sin {theta})
        </>
      ),
      y: (
        <>
          ({beta}/tan {theta})<tspan baseline-shift="super">2</tspan>
        </>
      ),
      yValues: true,
    },
    x: 'β / (tan θ sin θ)',
    y: '(β / tan θ)²',
  },
};

/** What each line's slope and intercept mean, shown under the plot. */
const EQUATIONS: Record<LineMethod, string> = {
  monshi: 'ln β = ln(Kλ/D) + ln(1/cos θ). Intercept ln(Kλ/D); the slope should be close to 1.',
  'linear-scherrer':
    'cos θ = (Kλ/D)(1/β), fitted with a free intercept. Slope Kλ/D; the intercept is not used. Rabiei et al., Nanomaterials 10 (2020) 1627.',
  sahadat:
    'cos θ = (Kλ/D)(1/β), with the line forced through the origin. Slope Kλ/D. Hossain et al., Chem. Pap. 76 (2022) 7245.',
  'wh-udm': 'β cos θ = Kλ/D + 4ε sin θ. Intercept Kλ/D, slope ε.',
  'wh-usdm': 'β cos θ = Kλ/D + 4σ sin θ / E. Intercept Kλ/D, slope σ (GPa).',
  'wh-udedm': 'β cos θ = Kλ/D + 4 sin θ (2u/E)^½. Intercept Kλ/D, slope √u (GPa^½).',
  ssp: '(dβ cos θ)² = (Kλ/D)(d²β cos θ) + 4ε²λ². Slope Kλ/D, intercept 4ε²λ². Papers that write the intercept as (ε/2)² report η = 4ε as the strain.',
  hw: '(β/tan θ)² = (Kλ/D) β/(tan θ sin θ) + 16ε². Slope Kλ/D, intercept 16ε². Same model as the size–strain plot in other units, so it gives the same D and ε.',
};

interface SectionProps {
  id: string;
  title: string;
  headline: string;
  children: ComponentChildren;
}

function MethodSection({ id, title, headline, children }: SectionProps) {
  return (
    <details class="method-details" id={id}>
      <summary>
        <span class="method-summary-title">{title}</span>
        <span class="method-summary-value">{headline}</span>
      </summary>
      <div class="method-body">{children}</div>
    </details>
  );
}

const sizeText = (value: number, sigma: number) =>
  Number.isFinite(value) ? `D = ${formatWithSigma(value, sigma)} nm` : 'no size';

interface ScherrerProps {
  result: ScherrerResult;
  peaks: readonly ResultPeak[];
  patternName: string;
  k: number;
  lambdaNm: number;
}

/** Per-peak Scherrer sizes with their mean and standard deviation. */
export function ScherrerDetails({ result, peaks, patternName, k, lambdaNm }: ScherrerProps) {
  const limited = (twoTheta: number) =>
    peaks.find((p) => p.used && Math.abs(p.twoTheta - twoTheta) < 1e-9)?.limited ?? false;
  const exportCsv = () =>
    downloadCsv(
      `${patternName}-scherrer`,
      `Scherrer D = Kλ/(β cos θ) for ${patternName}. K = ${k}, λ = ${lambdaNm} nm, β = corrected FWHM. Mean ${result.mean} nm, SD ${result.sd} nm.`,
      result.rows,
      [
        { header: '2θ (°)', value: (r) => r.twoTheta },
        { header: 'β (rad)', value: (r) => r.beta },
        { header: 'D (nm)', value: (r) => r.size.value },
        { header: 'σ D (nm)', value: (r) => r.size.sigma },
        {
          header: 'Note',
          value: (r) => (limited(r.twoTheta) ? 'limited by resolution: lower limit' : ''),
        },
      ],
    );
  return (
    <MethodSection
      id="method-scherrer"
      title={METHOD_NAMES.scherrer}
      headline={
        Number.isFinite(result.mean)
          ? `mean D = ${formatWithSigma(result.mean, result.sd)} nm (± SD)`
          : 'no peaks'
      }
    >
      <p class="field-hint">
        D = Kλ/(β cos θ) for each peak, with β the corrected FWHM in radians. The mean and the
        standard deviation (SD) over the selected peaks go into the summary.
      </p>
      <CheckLog messages={result.messages} />
      <TableBox label="Scherrer sizes" onExport={exportCsv}>
        <thead>
          <tr>
            <th scope="col">2θ (°)</th>
            <th scope="col">β (rad)</th>
            <th scope="col">D (nm)</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.twoTheta}>
              <td>{r.twoTheta.toFixed(3)}</td>
              <td>{r.beta.toExponential(3)}</td>
              <td>
                {limited(r.twoTheta) ? '≥ ' : ''}
                {formatWithSigma(r.size.value, r.size.sigma)}
              </td>
              <td class="peak-notes">
                {limited(r.twoTheta)
                  ? 'Limited by instrument resolution, size is a lower limit.'
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </MethodSection>
  );
}

interface LineProps extends StepContext<XrdData> {
  result: LineResult;
  patternName: string;
}

/** One straight-line method: the plot with its fit, the points and the results. */
export function LineDetails({ result, patternName, data, update }: LineProps) {
  const { method, fit, points } = result;
  const axes = AXES[method];
  const name = METHOD_NAMES[method];
  const headline = result.unavailable
    ? 'needs input'
    : !fit
      ? 'not enough peaks'
      : `${result.size ? sizeText(result.size.value, result.size.sigma) : ''}${
          result.strain && Number.isFinite(result.strain.value)
            ? `, ε = ${formatWithSigma(result.strain.value * 1e3, result.strain.sigma * 1e3)} × 10⁻³`
            : ''
        }${Number.isFinite(fit.rSquared) ? `, R² = ${fit.rSquared.toFixed(3)}` : ''}`;

  const sources = useMemo(() => {
    if (!fit) return [];
    const xMax = Math.max(...points.map((p) => p.x)) * 1.05;
    const xMin = Math.min(0, ...points.map((p) => p.x));
    const n = 50;
    const x = Float64Array.from({ length: n }, (_, k) => xMin + ((xMax - xMin) * k) / (n - 1));
    return [
      {
        id: 'fit',
        name: 'Least-squares line',
        x,
        y: x.map((v) => fit.intercept + fit.slope * v),
        unit: '',
        colorIndex: 0,
      },
    ];
  }, [fit, points]);

  const exportCsv = () =>
    fit &&
    downloadCsv(
      `${patternName}-${method}`,
      `${name} for ${patternName}. ${EQUATIONS[method]} Fit: intercept ${fit.intercept} ± ${fit.interceptSigma}, slope ${fit.slope} ± ${fit.slopeSigma}, R² ${fit.rSquared}, n ${fit.n}. Size ${result.size?.value ?? ''} ± ${result.size?.sigma ?? ''} nm; strain ${result.strain?.value ?? ''} ± ${result.strain?.sigma ?? ''}.`,
      points,
      [
        { header: '2θ (°)', value: (p) => p.twoTheta },
        { header: `x = ${axes.x}`, value: (p) => p.x },
        { header: `y = ${axes.y}`, value: (p) => p.y },
        { header: 'Fitted y', value: (p) => fit.intercept + fit.slope * p.x },
        { header: 'Residual', value: (p) => p.y - fit.intercept - fit.slope * p.x },
      ],
    );

  return (
    <MethodSection id={`method-${method}`} title={name} headline={headline}>
      <p class="field-hint">{EQUATIONS[method]}</p>
      {result.unavailable && <p class="field-hint">{result.unavailable}</p>}
      <CheckLog messages={result.messages} />
      {fit && (
        <>
          <dl class="fit-values">
            <div>
              <dt>Intercept</dt>
              <dd>{formatWithSigma(fit.intercept, fit.interceptSigma)}</dd>
            </div>
            <div>
              <dt>Slope</dt>
              <dd>{formatWithSigma(fit.slope, fit.slopeSigma)}</dd>
            </div>
            <div>
              <dt>R²</dt>
              <dd>{Number.isFinite(fit.rSquared) ? fit.rSquared.toFixed(4) : '–'}</dd>
            </div>
            <div>
              <dt>Peaks</dt>
              <dd>{fit.n}</dd>
            </div>
          </dl>
          <PlotPanel
            sources={sources}
            settings={data.plot}
            onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
            dock="manual"
            labels={() => axes.labels}
            xName={axes.x}
            xUnit=""
            exportName={`${patternName}-${method}`}
            showOverlayOptions={false}
            points={points.map((p) => ({ x: p.x, y: p.y }))}
          />
          <TableBox label={`${name} points`} onExport={exportCsv}>
            <thead>
              <tr>
                <th scope="col">2θ (°)</th>
                <th scope="col">x = {axes.x}</th>
                <th scope="col">y = {axes.y}</th>
                <th scope="col">Residual</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.twoTheta}>
                  <td>{p.twoTheta.toFixed(3)}</td>
                  <td>{p.x.toPrecision(5)}</td>
                  <td>{p.y.toPrecision(5)}</td>
                  <td>{(p.y - fit.intercept - fit.slope * p.x).toPrecision(3)}</td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        </>
      )}
    </MethodSection>
  );
}

interface TableBoxProps {
  label: string;
  onExport: () => void;
  /** Tighter rows, for long tables. */
  compact?: boolean;
  children: ComponentChildren;
}

/** A scrolling table with a CSV button above it. */
export function TableBox({ label, onExport, compact, children }: TableBoxProps) {
  return (
    <div class="table-box">
      <button type="button" class="btn" onClick={onExport}>
        Download CSV<span class="visually-hidden">: {label}</span>
      </button>
      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${label}, scrolls sideways`}
      >
        <table class={compact ? 'peak-table is-compact' : 'peak-table'}>{children}</table>
      </div>
    </div>
  );
}
