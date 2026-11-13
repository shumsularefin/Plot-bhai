/**
 * Sequential refinement of a series of patterns (temperature, composition, time …), as GSAS-II's
 * sequential refinement with "copy results to next histogram": the patterns are refined one after
 * another in order of the series value, with the same settings, and each starts from the cell
 * refined on the one before (the shift between neighbours is small, so the cell starts close to
 * its answer and the reflections line up). Everything else is released in stages from the same
 * start on every pattern, so a pattern's result does not depend on how it was reached.
 *
 * The results keep only what the series table and plot need (cells, volume, weight fractions,
 * size, microstrain, R values), not the calculated patterns, so long series stay small.
 */
import type { Cell } from '../reference/powder';
import {
  refineRietveld,
  type Estimate,
  type RietveldInput,
  type RietveldOutcome,
  type RietveldResult,
  type RietveldStats,
} from './refine';

export interface SeriesItem {
  /** Pattern id and name. */
  id: string;
  name: string;
  /** The series value (temperature, composition x, time …) in the unit the user chose. */
  value: number;
  input: RietveldInput;
}

export interface SeriesPhase {
  id: string;
  name: string;
  cell: Record<keyof Cell, Estimate>;
  volume: Estimate;
  weightFraction: Estimate | null;
  size: Estimate | null;
  microstrain: Estimate | null;
}

export interface SeriesPoint {
  id: string;
  name: string;
  value: number;
  /** The refinement's error message when it failed (then the other fields are empty). */
  error: string | null;
  stats: RietveldStats | null;
  zero: Estimate | null;
  converged: boolean;
  phases: SeriesPhase[];
  warnings: string[];
}

/** The part of a result the series keeps. */
export function seriesPoint(
  item: Omit<SeriesItem, 'input'>,
  outcome: RietveldOutcome,
): SeriesPoint {
  const base = { id: item.id, name: item.name, value: item.value };
  if (!outcome.ok)
    return {
      ...base,
      error: outcome.error,
      stats: null,
      zero: null,
      converged: false,
      phases: [],
      warnings: [],
    };
  return {
    ...base,
    error: null,
    stats: outcome.stats,
    zero: outcome.zero,
    converged: outcome.converged,
    phases: outcome.phases.map((p) => ({
      id: p.id,
      name: p.name,
      cell: p.cell,
      volume: p.volume,
      weightFraction: p.weightFraction,
      size: p.size,
      microstrain: p.microstrain,
    })),
    warnings: outcome.warnings,
  };
}

const cellOf = (phase: RietveldResult['phases'][number]): Cell => ({
  a: phase.cell.a.value,
  b: phase.cell.b.value,
  c: phase.cell.c.value,
  alpha: phase.cell.alpha.value,
  beta: phase.cell.beta.value,
  gamma: phase.cell.gamma.value,
});

/** The series in refinement order: by value, then by the order given (stable). */
export const seriesOrder = <T extends { value: number }>(items: readonly T[]): T[] =>
  items
    .map((item, i) => ({ item, i }))
    .sort((p, q) => p.item.value - q.item.value || p.i - q.i)
    .map((p) => p.item);

/**
 * Refines every pattern in order of value. With `copyForward`, each phase starts from the cell
 * refined on the previous pattern that succeeded (matched by phase id); otherwise every pattern
 * starts from the input cells. `progress` is told which pattern is running and its stage.
 * `refine` is the single refinement (the default; replaceable for tests).
 */
export function refineSeries(
  items: readonly SeriesItem[],
  copyForward: boolean,
  progress: (index: number, total: number, stage: string) => void = () => {},
  refine: typeof refineRietveld = refineRietveld,
): SeriesPoint[] {
  const ordered = seriesOrder(items);
  const points: SeriesPoint[] = [];
  let previous: RietveldResult | null = null;
  ordered.forEach((item, index) => {
    const start = previous;
    const input: RietveldInput =
      copyForward && start
        ? {
            ...item.input,
            phases: item.input.phases.map((phase) => {
              const refined = start.phases.find((p) => p.id === phase.id);
              return refined ? { ...phase, cell: cellOf(refined) } : phase;
            }),
          }
        : item.input;
    progress(index, ordered.length, 'Starting');
    let outcome: RietveldOutcome;
    try {
      outcome = refine(input, (stage) => progress(index, ordered.length, stage));
    } catch (e) {
      outcome = {
        ok: false,
        error: `The refinement failed: ${e instanceof Error ? e.message : 'unknown problem'}.`,
      };
    }
    if (outcome.ok) previous = outcome;
    points.push(seriesPoint(item, outcome));
  });
  return points;
}

/**
 * The series value suggested by a file name: the last number in the name without its extension,
 * for example 300 from "ZnO_300C.xy" or 0.05 from "Zn1-xMgxO_x0.05.xye". Null when there is none.
 * Only a starting suggestion; the user types the real value.
 */
export function valueFromName(name: string): number | null {
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '');
  const numbers = stem.match(/\d+(?:[.,]\d+)?/g);
  const last = numbers?.[numbers.length - 1];
  return last === undefined ? null : Number(last.replace(',', '.'));
}

/** One quantity followed through the series, for the table, the plot and the line fit. */
export interface SeriesQuantity {
  key: string;
  /** Plain label, for example "ZnO: a" or "R_wp". */
  label: string;
  unit: string;
  /** One entry per point, null where the quantity is missing (failed or not refined). */
  values: (Estimate | null)[];
}

const CELL_UNITS: Record<keyof Cell, string> = {
  a: 'Å',
  b: 'Å',
  c: 'Å',
  alpha: '°',
  beta: '°',
  gamma: '°',
};

/**
 * The quantities worth following: for each phase the cell parameters that were refined
 * independently on some pattern (a, then b and c only where they differ from a or are refined on
 * their own, and the angles a cell lets vary), the volume, the weight % with more than one phase,
 * size and microstrain when refined; then R_wp and χ², and the zero shift when refined.
 */
export function seriesQuantities(points: readonly SeriesPoint[]): SeriesQuantity[] {
  const out: SeriesQuantity[] = [];
  const phaseIds = [...new Set(points.flatMap((p) => p.phases.map((ph) => ph.id)))];
  const phaseCount = phaseIds.length;
  for (const id of phaseIds) {
    const per = points.map((p) => p.phases.find((ph) => ph.id === id) ?? null);
    const name = per.find((ph) => ph)?.name ?? id;
    const independent = (key: keyof Cell) =>
      per.some((ph) => {
        if (!ph?.cell[key].refined) return false;
        if (key === 'a' || key === 'alpha') return true;
        // b and c follow a in cubic, tetragonal (b) and hexagonal (b) cells; β, γ follow α in
        // rhombohedral ones. The refined value equals the leader's exactly when it follows it.
        const leader = key === 'b' || key === 'c' ? ph.cell.a : ph.cell.alpha;
        return ph.cell[key].value !== leader.value || ph.cell[key].esd !== leader.esd;
      });
    for (const key of Object.keys(CELL_UNITS) as (keyof Cell)[])
      if (independent(key))
        out.push({
          key: `${id}:${key}`,
          label: `${name}: ${key === 'alpha' ? 'α' : key === 'beta' ? 'β' : key === 'gamma' ? 'γ' : key}`,
          unit: CELL_UNITS[key],
          values: per.map((ph) => ph?.cell[key] ?? null),
        });
    out.push({
      key: `${id}:volume`,
      label: `${name}: V`,
      unit: 'Å³',
      values: per.map((ph) => ph?.volume ?? null),
    });
    if (phaseCount > 1 && per.some((ph) => ph?.weightFraction))
      out.push({
        key: `${id}:weight`,
        label: `${name}: weight %`,
        unit: '%',
        values: per.map((ph) =>
          ph?.weightFraction
            ? {
                ...ph.weightFraction,
                value: ph.weightFraction.value * 100,
                esd: ph.weightFraction.esd * 100,
              }
            : null,
        ),
      });
    if (per.some((ph) => ph?.size && Number.isFinite(ph.size.value)))
      out.push({
        key: `${id}:size`,
        label: `${name}: crystallite size`,
        unit: 'nm',
        values: per.map((ph) => (ph?.size && Number.isFinite(ph.size.value) ? ph.size : null)),
      });
    if (per.some((ph) => ph?.microstrain))
      out.push({
        key: `${id}:strain`,
        label: `${name}: microstrain`,
        unit: '10⁻⁶',
        values: per.map((ph) => ph?.microstrain ?? null),
      });
  }
  const fixed = (value: number): Estimate => ({ value, esd: 0, refined: false });
  out.push({
    key: 'rwp',
    label: 'R_wp',
    unit: '%',
    values: points.map((p) => (p.stats ? fixed(p.stats.rwp * 100) : null)),
  });
  out.push({
    key: 'chi2',
    label: 'χ²',
    unit: '',
    values: points.map((p) => (p.stats ? fixed(p.stats.chi2) : null)),
  });
  if (points.some((p) => p.zero?.refined))
    out.push({
      key: 'zero',
      label: 'Zero shift',
      unit: '° 2θ',
      values: points.map((p) => p.zero ?? null),
    });
  return out;
}
