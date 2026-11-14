/**
 * Sequential refinement of a series of patterns (temperature, composition, time …), as GSAS-II's
 * sequential refinement with "copy results to next histogram": the patterns are refined one after
 * another in order of the series value, with the same settings, and each starts from the cell
 * and, when the structure was refined, the atoms (positions, occupancies, displacement) refined on
 * the one before: the shift between neighbours is small, so they start close to their answer and
 * the reflections line up. Scale, background and profile are released in stages from the same
 * start on every pattern.
 *
 * The results keep only what the series table and plot need (cells, volume, weight fractions,
 * size, microstrain, R values), not the calculated patterns, so long series stay small.
 */
import type { WeightedLinearFit } from '../../math/linearFit';
import { refinedStructure } from '../export/gsas';
import type { Cell } from '../reference/powder';
// Types only, so the page can use the helpers below without loading the refinement itself.
import type {
  Estimate,
  refineRietveld,
  RietveldInput,
  RietveldOutcome,
  RietveldResult,
  RietveldStats,
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
 * and the refined atoms of the previous pattern that succeeded (matched by phase id); otherwise
 * every pattern starts from the input cells and structures. `refine` is the single refinement (refineRietveld, or a stand-in
 * in tests); `progress` is told which pattern is running and its stage.
 */
export function refineSeries(
  items: readonly SeriesItem[],
  copyForward: boolean,
  refine: typeof refineRietveld,
  progress: (index: number, total: number, stage: string) => void = () => {},
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
              if (!refined) return phase;
              return {
                ...phase,
                cell: cellOf(refined),
                ...(phase.structure
                  ? { structure: refinedStructure(phase.structure, refined) }
                  : {}),
              };
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

/** The unit in brackets at the end of a series label, "°C" from "Temperature (°C)"; "" if none. */
export function labelUnit(label: string): string {
  return label.match(/\(([^()]*)\)\s*$/)?.[1]?.trim() ?? '';
}

/** A straight line through one quantity of the series, for the methods text. */
export interface SeriesTrend {
  label: string;
  unit: string;
  fit: WeightedLinearFit;
  /** The fitted value at the lowest series value, for the relative slope. */
  start: number;
}

/**
 * The relative change per unit of the series value, (1/y₀)·dy/dx with y₀ the fitted value at the
 * lowest x: for a lattice parameter against temperature this is the linear thermal expansion
 * coefficient. Its uncertainty is σ(slope)/y₀ (the uncertainty of y₀ is far smaller here).
 */
export const relativeSlope = (trend: Pick<SeriesTrend, 'fit' | 'start'>) => ({
  value: trend.fit.slope / trend.start,
  sigma: trend.fit.slopeSigma / Math.abs(trend.start),
});

/** Number ± uncertainty, rounded to the uncertainty's first two significant digits. */
const withSigma = (value: number, sigma: number) => {
  if (!(sigma > 0) || !Number.isFinite(sigma)) return value.toPrecision(4);
  const digits = Math.max(0, 1 - Math.floor(Math.log10(sigma)));
  return `${value.toFixed(digits)} ± ${sigma.toFixed(digits)}`;
};
const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
};
/** "(1.95 ± 0.26) × 10⁻⁵": value and uncertainty with the value's power of ten taken out. */
export function scientificText(value: number, sigma: number): string {
  const power = Math.floor(Math.log10(Math.abs(value) || Math.abs(sigma) || 1));
  const scale = 10 ** power;
  if (power === 0) return withSigma(value, sigma);
  const exponent = [...String(power)].map((c) => SUPERSCRIPT[c]).join('');
  return `(${withSigma(value / scale, sigma / scale)}) × 10${exponent}`;
}

/**
 * Methods sentences for a sequential refinement: what was refined in which order, how each
 * pattern started, and the straight line through the chosen quantity when there is one.
 */
export function seriesMethods(options: {
  label: string;
  points: readonly SeriesPoint[];
  copyForward: boolean;
  trend: SeriesTrend | null;
}): string {
  const { label, points, copyForward, trend } = options;
  const good = points.filter((p) => !p.error);
  const values = points.map((p) => p.value);
  const name = label.replace(/\s*\([^()]*\)\s*$/, '').trim() || 'series value';
  const unit = labelUnit(label);
  const range = `${name.toLowerCase()} ${Math.min(...values)} to ${Math.max(...values)}${unit ? ` ${unit}` : ''}`;
  const parts = [
    `The ${points.length} patterns of the series (${range}) were refined sequentially with the same model and settings, in order of increasing ${name.toLowerCase()}, ${
      copyForward
        ? 'each starting from the unit cells (and, where refined, the atomic parameters) refined on the previous pattern'
        : 'each starting from the reference unit cells and structures'
    }; the other parameters were released in the same stages from the same starting values for every pattern.`,
  ];
  const failed = points.length - good.length;
  if (failed > 0)
    parts.push(
      failed === 1
        ? '1 pattern could not be refined and is left out of the trend.'
        : `${failed} patterns could not be refined and are left out of the trend.`,
    );
  if (trend) {
    const per = unit ? `${trend.unit ? `${trend.unit} ` : ''}per ${unit}` : trend.unit;
    const rel = relativeSlope(trend);
    parts.push(
      `A weighted straight line (weights 1/s.u.², ${Number.isFinite(trend.fit.reducedChi2) ? `uncertainties scaled by the scatter about the line, χ²_ν = ${trend.fit.reducedChi2.toFixed(2)}` : 'through two points, so without an uncertainty'}) through ${trend.label} against ${name.toLowerCase()} over ${trend.fit.n} patterns gives a slope of ${scientificText(trend.fit.slope, trend.fit.slopeSigma)} ${per}, a relative change (1/y₀)·dy/dx of ${scientificText(rel.value, rel.sigma)}${unit ? ` per ${unit}` : ''} (y₀ the fitted value at the lowest ${name.toLowerCase()})${trend.fit.n > 2 ? `, R² = ${trend.fit.rSquared.toFixed(4)}` : ''}.`,
    );
  }
  return parts.join(' ');
}
