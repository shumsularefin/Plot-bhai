import { SIGMOID_N } from '../../core/uvvis/crossChecks';
import { indexFromGap } from '../../core/uvvis/optics';
import { DISPLAY_LABELS } from '../../core/uvvis/process';
import { GAP_METHODS, TRANSITIONS, type TaucGap } from '../../core/uvvis/tauc';
import type { CsvColumn } from '../../core/xrd/peaks/table';
import { baselineUsed, type ResultRow } from './analysis';

/** Number to a fixed number of decimals, or an empty cell when it is not a finite number. */
const num = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '' : value;

/** Columns of the results table, shared by the screen and the CSV file. */
export const RESULT_COLUMNS: readonly CsvColumn<ResultRow>[] = [
  { header: 'Sample', value: (r) => r.spectrum.name },
  { header: 'Data type', value: (r) => r.spectrum.kind },
  { header: 'lambda_max (nm)', value: (r) => num(r.lambdaMax?.wavelengthNm) },
  {
    header: 'lambda_max quantity',
    value: (r) => (r.lambdaMax ? DISPLAY_LABELS[r.lambdaMax.quantity] : ''),
  },
  { header: 'Absorption edge (nm)', value: (r) => num(r.edgeNm) },
  { header: 'Eg (eV)', value: (r) => num(r.analysis.fit?.egEv) },
  { header: 'Eg uncertainty (eV)', value: (r) => num(r.analysis.fit?.egSigma) },
  { header: 'Method', value: (r) => (r.analysis.fit ? 'Tauc' : '') },
  {
    header: 'Eg read from',
    value: (r) =>
      r.analysis.fit
        ? `${GAP_METHODS[r.analysis.method].short}${r.analysis.automatic ? ' (automatic)' : ''}`
        : '',
  },
  {
    header: 'Baseline from (eV)',
    value: (r) => num(baselineUsed(r.analysis)?.[0]),
  },
  {
    header: 'Baseline to (eV)',
    value: (r) => num(baselineUsed(r.analysis)?.[1]),
  },
  {
    header: 'Baseline shape',
    value: (r) =>
      r.analysis.powerBaseline
        ? 'power law a + c*E^m'
        : r.analysis.method === 'subtract-baseline' && r.analysis.signalBaseline
          ? 'straight line'
          : '',
  },
  { header: 'Baseline exponent m', value: (r) => num(r.analysis.powerBaseline?.m) },
  {
    header: 'Baseline exponent m uncertainty',
    value: (r) => {
      const p = r.analysis.powerBaseline;
      return !p ? '' : p.mFixed ? 'typed' : num(Math.sqrt(p.covariance[2]?.[2] ?? NaN));
    },
  },
  { header: 'Second component', value: (r) => r.analysis.component?.name ?? '' },
  {
    header: 'Factor c',
    value: (r) => num(r.analysis.component ? r.analysis.componentFactor?.value : null),
  },
  {
    header: 'Factor c uncertainty',
    value: (r) =>
      r.analysis.component && r.analysis.componentFactor?.n
        ? num(r.analysis.componentFactor.sigma)
        : r.analysis.component && r.analysis.componentFactor
          ? 'typed'
          : '',
  },
  { header: 'Transition', value: (r) => TRANSITIONS[r.choice.transition].label },
  {
    header: 'Transition role',
    value: (r) => (r.primary ? 'in use' : 'also reported'),
  },
  { header: 'n', value: (r) => TRANSITIONS[r.choice.transition].nText },
  { header: 'R2', value: (r) => num(r.analysis.fit?.rSquared) },
  { header: 'Fit from (eV)', value: (r) => num(r.analysis.fit?.fromEv) },
  { header: 'Fit to (eV)', value: (r) => num(r.analysis.fit?.toEv) },
  { header: 'Points in fit', value: (r) => num(r.analysis.fit?.n) },
  { header: 'Region', value: (r) => (r.analysis.suggested ? 'suggested' : 'set by user') },
  { header: 'Sample type', value: (r) => r.choice.sample },
  {
    header: 'Film thickness (nm)',
    value: (r) => (r.choice.sample === 'film' ? num(r.choice.thicknessNm) : ''),
  },
  {
    header: 'Path length (cm)',
    value: (r) => (r.choice.sample === 'solution' ? num(r.choice.pathCm) : ''),
  },
  { header: 'Signal', value: (r) => SIGNAL_TEXT[r.analysis.signal.unit] },
  {
    header: 'Reflection correction',
    value: (r) =>
      r.analysis.reflection?.state === 'corrected'
        ? `corrected with ${r.analysis.reflection.name}`
        : r.analysis.reflection
          ? 'none'
          : '',
  },
  {
    header: 'Urbach energy (meV)',
    value: (r) => num((r.analysis.urbach?.fit?.euEv ?? NaN) * 1000),
  },
  {
    header: 'Urbach uncertainty (meV)',
    value: (r) => num((r.analysis.urbach?.fit?.euSigma ?? NaN) * 1000),
  },
  {
    header: 'Derivative method',
    value: (r) => (r.analysis.derivative ? r.choice.derivative : ''),
  },
  { header: 'Derivative Eg (eV)', value: (r) => num(r.analysis.derivative?.egEv) },
  { header: 'Cody Eg (eV)', value: (r) => num(r.analysis.cody?.fit?.egEv) },
  { header: 'Cody Eg uncertainty (eV)', value: (r) => num(r.analysis.cody?.fit?.egSigma) },
  { header: 'Cody fit from (eV)', value: (r) => num(r.analysis.cody?.fit?.fromEv) },
  { header: 'Cody fit to (eV)', value: (r) => num(r.analysis.cody?.fit?.toEv) },
  { header: 'Sigmoid type', value: (r) => r.analysis.sigmoid?.fit?.type ?? '' },
  {
    header: 'Sigmoid n_type',
    value: (r) => (r.analysis.sigmoid?.fit ? SIGMOID_N[r.analysis.sigmoid.fit.type] : ''),
  },
  { header: 'Sigmoid E0 (eV)', value: (r) => num(r.analysis.sigmoid?.fit?.e0Ev) },
  { header: 'Sigmoid dE (eV)', value: (r) => num(r.analysis.sigmoid?.fit?.deltaEv) },
  { header: 'Sigmoid Eg (eV)', value: (r) => num(r.analysis.sigmoid?.fit?.egEv) },
  { header: 'Sigmoid Eg uncertainty (eV)', value: (r) => num(r.analysis.sigmoid?.fit?.egSigma) },
  { header: 'Sigmoid fit from (eV)', value: (r) => num(r.analysis.sigmoid?.fit?.fromEv) },
  { header: 'Sigmoid fit to (eV)', value: (r) => num(r.analysis.sigmoid?.fit?.toEv) },
  {
    header: 'n Moss (estimate)',
    value: (r) => num(r.analysis.fit ? indexFromGap('moss', r.analysis.fit.egEv) : null),
  },
  {
    header: 'n Ravindra (estimate)',
    value: (r) => num(r.analysis.fit ? indexFromGap('ravindra', r.analysis.fit.egEv) : null),
  },
  {
    header: 'n Herve-Vandamme (estimate)',
    value: (r) => num(r.analysis.fit ? indexFromGap('herve-vandamme', r.analysis.fit.egEv) : null),
  },
];

const SIGNAL_TEXT = {
  alpha: 'alpha (cm-1)',
  proportional: 'absorbance (proportional to alpha)',
  'kubelka-munk': 'F(R)',
} as const;

export const RESULTS_NOTE =
  'UV-Vis results, one row per sample and reported transition. Eg is an estimate from the Tauc method, read as stated in the Eg read from column; its uncertainty is that of the straight-line fits only. Cody (Eg where (S/E)^(1/2) meets zero) and sigmoid (Zanatta, Sci. Rep. 9 (2019) 11225: Eg = E0 - n_type*dE) values are cross-check estimates, not replacements. Refractive indices n from Eg (Moss n^4*Eg = 95 eV; Ravindra n = 4.084 - 0.62*Eg; Herve-Vandamme n^2 = 1 + (13.6/(Eg + 3.47))^2, as given by Tripathy, Opt. Mater. 46 (2015) 240) are rough empirical estimates. lambda_max is the highest data point of the absorbance (F(R) for reflectance). Example data are synthetic.';

/** Band gap with its uncertainty for display, in eV, for example "3.204 ± 0.005" or "3.200 ± < 0.001". */
export function gapText(fit: { egEv: number; egSigma: number }): string {
  const sigma = !Number.isFinite(fit.egSigma)
    ? '?'
    : fit.egSigma < 0.0005
      ? '< 0.001'
      : fit.egSigma.toFixed(3);
  return `${fit.egEv.toFixed(3)} ± ${sigma}`;
}

/**
 * The power-law baseline in words for the screen and the figure legend, for example
 * "power-law baseline, m = 1.93 ± 0.05", or an empty string when a straight line or none is used.
 */
export function powerBaselineText(analysis: Pick<TaucGap, 'powerBaseline'>): string {
  const p = analysis.powerBaseline;
  if (!p) return '';
  const sigma = Math.sqrt(p.covariance[2]?.[2] ?? NaN);
  return p.mFixed
    ? `power-law baseline, m = ${p.m} (set by you)`
    : `power-law baseline, m = ${p.m.toFixed(2)}${Number.isFinite(sigma) ? ` ± ${sigma.toFixed(2)}` : ''}`;
}
