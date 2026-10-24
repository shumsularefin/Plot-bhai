import { DISPLAY_LABELS } from '../../core/uvvis/process';
import { TRANSITIONS } from '../../core/uvvis/tauc';
import type { CsvColumn } from '../../core/xrd/peaks/table';
import type { ResultRow } from './analysis';

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
  { header: 'Transition', value: (r) => TRANSITIONS[r.choice.transition].label },
  { header: 'n', value: (r) => TRANSITIONS[r.choice.transition].nText },
  { header: 'R2', value: (r) => num(r.analysis.fit?.rSquared) },
  { header: 'Fit from (eV)', value: (r) => num(r.analysis.fit?.fromEv) },
  { header: 'Fit to (eV)', value: (r) => num(r.analysis.fit?.toEv) },
  { header: 'Points in fit', value: (r) => num(r.analysis.fit?.n) },
  { header: 'Region', value: (r) => (r.analysis.suggested ? 'suggested' : 'set by user') },
  { header: 'Film thickness (nm)', value: (r) => num(r.choice.thicknessNm) },
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
];

export const RESULTS_NOTE =
  'UV-Vis results. Eg is an estimate from the Tauc method; its uncertainty is that of the straight-line fit only. lambda_max is the highest data point of the absorbance (F(R) for reflectance). Example data are synthetic.';

/** Band gap with its uncertainty for display, in eV, for example "3.204 ± 0.005" or "3.200 ± < 0.001". */
export function gapText(fit: { egEv: number; egSigma: number }): string {
  const sigma = !Number.isFinite(fit.egSigma)
    ? '?'
    : fit.egSigma < 0.0005
      ? '< 0.001'
      : fit.egSigma.toFixed(3);
  return `${fit.egEv.toFixed(3)} ± ${sigma}`;
}
