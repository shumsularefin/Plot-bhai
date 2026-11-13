import type { Estimate } from '../../core/xrd/size/methods';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { assignmentFor } from './assignment';
import { makeTable, type CsvTable } from './csv';
import type { XrdData } from './data';
import { sizeResults } from './sizeResults';

/**
 * One pattern's headline results, for comparing samples side by side. Nothing is calculated
 * here: every value is taken from the same functions that fill the per-pattern tables, so the
 * comparison can never disagree with them.
 */
export interface ComparisonRow {
  id: string;
  name: string;
  /** Peaks used for size out of the fitted peaks; null when the pattern has no usable fit. */
  peaks: { used: number; fitted: number } | null;
  /** Scherrer size, nm: mean, with sigma the standard deviation over the peaks. */
  scherrer: Estimate | null;
  /** Williamson–Hall UDM size (nm) and microstrain (dimensionless), with the line-fit uncertainty. */
  whSize: Estimate | null;
  whStrain: Estimate | null;
  /** The first chosen phase with a refined cell: its name, cell edges (Å) and volume (Å³). */
  phase: string | null;
  edges: { name: 'a' | 'b' | 'c'; a: Estimate }[];
  volume: Estimate | null;
  /** Why values are missing, in plain language; empty when nothing is. */
  note: string;
}

/** The comparison rows of every loaded pattern, in upload order. */
export function comparisonRows(
  data: XrdData,
  phases: readonly ReferencePhase[] | null,
): ComparisonRow[] {
  return data.patterns.map((pattern) => {
    const size = sizeResults(data, pattern.id);
    const row = (method: 'scherrer' | 'wh-udm') =>
      size.kind === 'ok' ? size.summary.find((r) => r.method === method && !r.unavailable) : null;
    const assignment = phases ? assignmentFor(data, pattern.id, phases, false) : null;
    const refined = assignment?.phases.flatMap((p) =>
      'outcome' in p.lattice && p.lattice.outcome.ok
        ? [{ name: p.phase.name, fit: p.lattice.outcome.fit }]
        : [],
    )[0];
    return {
      id: pattern.id,
      name: pattern.name,
      peaks:
        size.kind === 'ok'
          ? { used: size.peaks.filter((p) => p.used).length, fitted: size.peaks.length }
          : null,
      scherrer: row('scherrer')?.size ?? null,
      whSize: row('wh-udm')?.size ?? null,
      whStrain: row('wh-udm')?.strain ?? null,
      phase: refined?.name ?? null,
      edges: refined?.fit.edges ?? [],
      volume: refined?.fit.volume ?? null,
      note: size.kind === 'none' ? size.reason : '',
    };
  });
}

const edge = (row: ComparisonRow, name: 'a' | 'b' | 'c') =>
  row.edges.find((e) => e.name === name)?.a ?? null;

/** The comparison as a CSV table, one row per pattern, each value next to its uncertainty. */
export function comparisonTable(data: XrdData, rows: readonly ComparisonRow[]): CsvTable {
  const pair = (header: string, sigma: string, get: (r: ComparisonRow) => Estimate | null) => [
    { header, value: (r: ComparisonRow) => get(r)?.value ?? '' },
    { header: sigma, value: (r: ComparisonRow) => get(r)?.sigma ?? '' },
  ];
  return makeTable(
    'sample-comparison',
    `Comparison of ${rows.length} patterns. K = ${data.results.k}. Scherrer: mean and standard deviation over the peaks used. Williamson–Hall UDM: value and standard uncertainty from the line fit; strain in the convention β_ε = 4ε tan θ. Cell: least-squares refinement from the assigned peaks of the first chosen phase, without a zero-shift term. ${data.instrument.source === 'skip' ? 'Instrument correction was skipped, so sizes are smaller than reality. ' : ''}All values are estimates. Empty cells: not available for that pattern.`,
    rows,
    [
      { header: 'Pattern', value: (r) => r.name },
      { header: 'Peaks used', value: (r) => r.peaks?.used ?? '' },
      { header: 'Peaks fitted', value: (r) => r.peaks?.fitted ?? '' },
      ...pair('D Scherrer (nm)', 'SD D Scherrer (nm)', (r) => r.scherrer),
      ...pair('D W–H UDM (nm)', 'σ D W–H UDM (nm)', (r) => r.whSize),
      ...pair('ε W–H UDM', 'σ ε W–H UDM', (r) => r.whStrain),
      { header: 'Phase', value: (r) => r.phase ?? '' },
      ...pair('a (Å)', 'σ a (Å)', (r) => edge(r, 'a')),
      ...pair('b (Å)', 'σ b (Å)', (r) => edge(r, 'b')),
      ...pair('c (Å)', 'σ c (Å)', (r) => edge(r, 'c')),
      ...pair('V (Å³)', 'σ V (Å³)', (r) => r.volume),
      { header: 'Notes', value: (r) => r.note },
    ],
  );
}
