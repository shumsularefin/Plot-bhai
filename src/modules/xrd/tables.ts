import { peakTable, type CsvColumn, type PeakRow } from '../../core/xrd/peaks/table';
import type { RegionFit } from '../../core/xrd/peaks/fit';
import { ANODES } from '../../core/xrd/radiation';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { makeTable, type CsvTable } from './csv';
import { assignmentFor, type AssignedPeak, type AssignmentResult } from './assignment';
import { peaksFor, type XrdData } from './data';
import { METHOD_NAMES, sizeResults, type ResultPeak, type SummaryRow } from './sizeResults';

/** Signed number with a real minus sign, for example "+0.05". */
export const sign = (v: number, digits: number) =>
  `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;

/** Columns of the fitted-peak table: value, and its uncertainty where the fit gives one. */
export const PEAK_COLUMNS: {
  key: keyof PeakRow;
  label: string;
  sigma?: keyof PeakRow;
  /** Plain fixed decimals for values without an uncertainty. */
  decimals?: number;
}[] = [
  { key: 'twoTheta', label: '2θ (°)', sigma: 'twoThetaSigma' },
  { key: 'd', label: 'd (Å)', sigma: 'dSigma' },
  { key: 'fwhm', label: 'FWHM (°)', sigma: 'fwhmSigma' },
  { key: 'fwhmRad', label: 'FWHM (rad)', sigma: 'fwhmRadSigma' },
  { key: 'breadth', label: 'Integral breadth (°)', sigma: 'breadthSigma' },
  { key: 'height', label: 'Height', sigma: 'heightSigma' },
  { key: 'area', label: 'Area', sigma: 'areaSigma' },
  { key: 'relativeIntensity', label: 'I/Imax (%)', decimals: 1 },
  { key: 'eta', label: 'η', sigma: 'etaSigma' },
];

/** The fitted peaks of one pattern, with uncertainties, region R² and the fit's notes. */
export function peakFitTable(
  patternName: string,
  rows: readonly PeakRow[],
  regions: readonly RegionFit[],
  intensityUnit: string,
  lambda: number,
): CsvTable {
  const columns: CsvColumn<PeakRow>[] = [
    ...PEAK_COLUMNS.flatMap((c) => [
      { header: c.label, value: (r: PeakRow) => r[c.key] },
      ...(c.sigma
        ? [{ header: `σ ${c.label}`, value: (r: PeakRow) => r[c.sigma as keyof PeakRow] }]
        : []),
    ]),
    { header: 'Region R²', value: (r) => regions[r.region]?.rSquared ?? '' },
    {
      header: 'Notes',
      value: (r) => (regions[r.region]?.peaks[r.peak]?.messages ?? []).map((m) => m.text).join(' '),
    },
  ];
  return makeTable(
    `${patternName}-peaks`,
    `Peak fit for ${patternName}. d from Bragg's law with λ = ${lambda} Å. Height in ${intensityUnit}; area in ${intensityUnit} × degrees. σ = standard uncertainty from the fit covariance.`,
    rows,
    columns,
  );
}

/** Peaks used for size and strain with observed and corrected widths. */
export function sizePeaksTable(
  patternName: string,
  peaks: readonly ResultPeak[],
  skipped: boolean,
  hkl: readonly string[] | undefined,
): CsvTable {
  return makeTable(
    `${patternName}-size-peaks`,
    `Peaks used for size and strain, ${patternName}. Widths in degrees 2θ; ${skipped ? 'instrument correction skipped' : 'β is the instrument-corrected FWHM'}.`,
    peaks,
    [
      { header: '2θ (°)', value: (p) => p.twoTheta },
      ...(hkl ? [{ header: '(hkl)', value: (p: ResultPeak) => hkl[p.index] ?? '' }] : []),
      { header: 'Observed FWHM (°)', value: (p) => p.observed },
      { header: 'Corrected β (°)', value: (p) => p.corrected },
      { header: 'σ β (°)', value: (p) => p.correctedSigma },
      { header: 'Used', value: (p) => (p.used ? 'yes' : 'no') },
      { header: 'E_hkl (GPa)', value: (p) => p.modulusGPa ?? '' },
      { header: 'Notes', value: (p) => p.messages.map((m) => m.text).join(' ') },
    ],
  );
}

/** Size and strain by every method. */
export function sizeSummaryTable(
  patternName: string,
  k: number,
  rows: readonly SummaryRow[],
): CsvTable {
  return makeTable(
    `${patternName}-size-strain-summary`,
    `Size and strain summary for ${patternName}. K = ${k}. Scherrer: mean and standard deviation over peaks; other methods: value and standard uncertainty from the line fit. Strain in the Williamson–Hall convention (β_ε = 4ε tan θ). Empty cells: not defined by the method or not physical.`,
    rows,
    [
      { header: 'Method', value: (r) => METHOD_NAMES[r.method] },
      { header: 'D (nm)', value: (r) => r.size?.value ?? '' },
      { header: 'SD or σ D (nm)', value: (r) => r.size?.sigma ?? '' },
      { header: 'ε', value: (r) => r.strain?.value ?? '' },
      { header: 'σ ε', value: (r) => r.strain?.sigma ?? '' },
      { header: 'Stress (GPa)', value: (r) => r.stress?.value ?? '' },
      { header: 'σ stress (GPa)', value: (r) => r.stress?.sigma ?? '' },
      { header: 'u (kJ/m³)', value: (r) => r.energyDensity?.value ?? '' },
      { header: 'σ u (kJ/m³)', value: (r) => r.energyDensity?.sigma ?? '' },
      { header: 'δ (m⁻²)', value: (r) => r.dislocation?.value ?? '' },
      { header: 'σ δ (m⁻²)', value: (r) => r.dislocation?.sigma ?? '' },
      { header: 'S (m²/g)', value: (r) => r.surface?.value ?? '' },
      { header: 'σ S (m²/g)', value: (r) => r.surface?.sigma ?? '' },
      { header: 'R²', value: (r) => r.rSquared },
      { header: 'Peaks', value: (r) => r.n },
      {
        header: 'Notes',
        value: (r) => [r.unavailable ?? '', ...r.messages.map((m) => m.text)].join(' ').trim(),
      },
    ],
  );
}

/** Notes shown for one assigned peak. */
export function assignmentNotes(p: AssignedPeak): string[] {
  const out: string[] = [];
  if (p.phase && p.assignment.candidates.length > 1) out.push('Overlapping reflections.');
  if (p.assignment.competing.length > 0) out.push('Another phase has a line here too.');
  return out;
}

/** Each fitted peak with its nearest reference line, COD ID and the user's own JCPDS number. */
export function assignedPeaksTable(
  data: XrdData,
  patternName: string,
  result: AssignmentResult,
): CsvTable {
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  const jcpds = (id: string) => data.material.jcpds[id]?.trim() ?? '';
  return makeTable(
    `${patternName}-assigned-peaks`,
    `Peak assignment, ${patternName}. ${data.radiation.anode} Kα1, λ = ${lambda} Å. Reference positions are from the Crystallography Open Database entry named in each row; zero shifts: ${result.phases.map((p) => `${p.phase.name} ${sign(p.shift, 2)}°`).join(', ')}. Δ2θ = observed − reference. JCPDS numbers are entered by the user and not verified.`,
    result.peaks,
    [
      { header: 'Phase', value: (p) => p.phase?.name ?? 'unassigned' },
      { header: 'COD ID', value: (p) => p.phase?.codId ?? '' },
      {
        header: 'JCPDS number (entered by user, not verified)',
        value: (p) => (p.phase ? jcpds(p.phase.id) : ''),
      },
      { header: '(hkl)', value: (p) => p.hklText },
      { header: '2θ observed (°)', value: (p) => p.peak.twoTheta },
      { header: '2θ reference (°)', value: (p) => p.line?.twoTheta ?? '' },
      { header: 'Δ2θ (°)', value: (p) => (p.line ? p.peak.twoTheta - p.line.twoTheta : '') },
      { header: 'd observed (Å)', value: (p) => p.peak.d },
      { header: 'd reference (Å)', value: (p) => p.line?.d ?? '' },
      { header: 'I/I0 observed (%)', value: (p) => p.peak.relativeIntensity },
      { header: 'I/I0 reference (%)', value: (p) => p.line?.intensity ?? '' },
      { header: 'FWHM (°)', value: (p) => p.peak.fwhm },
      { header: 'Notes', value: (p) => assignmentNotes(p).join(' ') },
    ],
  );
}

/**
 * Every table the Export step can offer for the whole analysis: for each pattern the peak
 * fit, the assigned peaks (when reference phases are chosen) and the size and strain tables.
 * Texture, crystallinity and the per-method line fits stay as downloads in their own sections.
 */
export function allTables(data: XrdData, library: readonly ReferencePhase[]): CsvTable[] {
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  return data.patterns.flatMap((pattern) => {
    const tables: CsvTable[] = [];
    const fit = peaksFor(data, pattern.id).fit;
    if (!fit) return tables;
    const rows = peakTable(fit.regions, lambda);
    if (rows.length === 0) return tables;
    tables.push(peakFitTable(pattern.name, rows, fit.regions, pattern.intensityUnit, lambda));
    const assigned = assignmentFor(data, pattern.id, library, false);
    if (assigned) tables.push(assignedPeaksTable(data, pattern.name, assigned));
    const size = sizeResults(data, pattern.id);
    if (size.kind === 'ok') {
      const hkl = assigned ? assigned.peaks.map((p) => p.hklText) : undefined;
      tables.push(sizePeaksTable(pattern.name, size.peaks, size.skipped, hkl));
      tables.push(sizeSummaryTable(pattern.name, data.results.k, size.summary));
    }
    return tables;
  });
}

/** All tables in one CSV file, each preceded by a "## name" line and followed by a blank line. */
export function combinedCsv(tables: readonly CsvTable[]): string {
  return tables.map((t) => `## ${t.name}\r\n${t.text}`).join('\r\n');
}
