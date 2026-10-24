/*
 * Size distribution of particles: summary numbers, histogram bins and maximum likelihood fits.
 * All functions take diameters in one unit (the caller chooses nm, µm or px) and return numbers
 * in that same unit. Only finite values above zero are meant to go in; `cleanSizes` drops the rest.
 */

/** Keeps finite values above zero (a diameter cannot be zero or negative), sorted ascending. */
export function cleanSizes(values: readonly number[]): Float64Array {
  return Float64Array.from(values.filter((v) => Number.isFinite(v) && v > 0)).sort();
}

/**
 * Percentile by linear interpolation between the sorted values (the default of NumPy and the
 * PERCENTILE.INC function of spreadsheets): with n values, position h = (n − 1)·p/100 counted
 * from 0, and the result is x[⌊h⌋] + (h − ⌊h⌋)·(x[⌊h⌋ + 1] − x[⌊h⌋]).
 * `sorted` is ascending and not empty; `p` is in percent, 0 to 100.
 */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  const h = ((n - 1) * Math.min(100, Math.max(0, p))) / 100;
  const i = Math.floor(h);
  const lower = sorted[i] as number;
  const upper = sorted[Math.min(i + 1, n - 1)] as number;
  return lower + (h - i) * (upper - lower);
}

export interface SizeSummary {
  count: number;
  mean: number;
  /** Sample standard deviation, divisor n − 1 (NaN for one value). */
  sd: number;
  median: number;
  min: number;
  max: number;
  /** Number-based percentiles: 10 %, 50 % and 90 % of the particles are smaller than these. */
  d10: number;
  d50: number;
  d90: number;
  /** Width of the distribution relative to its middle, (D90 − D10) / D50. */
  span: number;
}

/** Summary of sorted, cleaned diameters (`cleanSizes`), or null when there are none. */
export function summarise(sorted: Float64Array): SizeSummary | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : NaN;
  const d10 = percentile(sorted, 10);
  const d50 = percentile(sorted, 50);
  const d90 = percentile(sorted, 90);
  return {
    count: n,
    mean,
    sd,
    median: d50,
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
    d10,
    d50,
    d90,
    span: (d90 - d10) / d50,
  };
}

/** Fewer particles than this give a distribution that is mostly noise; the site warns below it. */
export const MIN_RELIABLE_COUNT = 100;

/** The lower the count, the more the histogram changes from image to image. */
export function countWarning(count: number): string | null {
  if (count === 0) return 'No particles to show yet.';
  if (count < MIN_RELIABLE_COUNT) {
    return `Only ${count} particles. A size distribution is usually reported from at least ${MIN_RELIABLE_COUNT}; with fewer, the shape and the fits can change a lot with a few more particles. Measure more particles or pool more images.`;
  }
  return null;
}

export type BinMethod = 'freedman-diaconis' | 'sturges' | 'manual';

export const BIN_METHOD_NAMES: Record<BinMethod, string> = {
  'freedman-diaconis': 'Freedman–Diaconis',
  sturges: 'Sturges',
  manual: 'Manual',
};

/** Most bins ever drawn: more only shows noise and makes the figure unreadable. */
export const MAX_BINS = 200;

/** Sturges' rule: k = ⌈log₂ n⌉ + 1 bins for n values. */
export function sturgesBins(n: number): number {
  return n > 0 ? Math.ceil(Math.log2(n)) + 1 : 1;
}

/**
 * Freedman–Diaconis rule: bin width w = 2 · IQR / n^(1/3), where IQR is the inter-quartile range
 * (P75 − P25); the number of bins is ⌈(max − min) / w⌉. With a zero IQR or a single value it
 * falls back to Sturges' rule.
 */
export function freedmanDiaconisBins(sorted: Float64Array): number {
  const n = sorted.length;
  const iqr = n > 0 ? percentile(sorted, 75) - percentile(sorted, 25) : 0;
  const range = n > 0 ? (sorted[n - 1] as number) - (sorted[0] as number) : 0;
  if (!(iqr > 0) || !(range > 0)) return sturgesBins(n);
  const width = (2 * iqr) / Math.cbrt(n);
  return Math.min(MAX_BINS, Math.max(1, Math.ceil(range / width)));
}

export interface Histogram {
  /** Edges of the bins, ascending; one more than the counts. */
  edges: number[];
  counts: number[];
  /** Width of every bin, in the unit of the diameters. */
  binWidth: number;
}

/**
 * Histogram with equal-width bins from the smallest to the largest value. A value on a shared
 * edge goes in the upper bin, except the largest value, which closes the last bin.
 * `manualBins` is used for the 'manual' method (rounded, at least 1, at most MAX_BINS).
 */
export function histogram(sorted: Float64Array, method: BinMethod, manualBins = 10): Histogram {
  const n = sorted.length;
  if (n === 0) return { edges: [0, 1], counts: [0], binWidth: 1 };
  const requested =
    method === 'sturges'
      ? sturgesBins(n)
      : method === 'freedman-diaconis'
        ? freedmanDiaconisBins(sorted)
        : Math.round(manualBins);
  const bins = Math.min(MAX_BINS, Math.max(1, Number.isFinite(requested) ? requested : 1));
  const lo = sorted[0] as number;
  const hi = sorted[n - 1] as number;
  // All values equal: one bin of arbitrary width around the value, so a bar can be drawn.
  const binWidth = hi > lo ? (hi - lo) / bins : lo / 10;
  const start = hi > lo ? lo : lo - binWidth / 2;
  const count = hi > lo ? bins : 1;
  const counts = new Array<number>(count).fill(0);
  for (const v of sorted) {
    const index = Math.min(count - 1, Math.floor((v - start) / binWidth));
    counts[index] = (counts[index] as number) + 1;
  }
  const edges = Array.from({ length: count + 1 }, (_, i) => start + i * binWidth);
  return { edges, counts, binWidth };
}

/** Empirical cumulative distribution: after the i-th smallest of n values, the share is i / n. */
export function cumulative(sorted: Float64Array): { x: Float64Array; share: Float64Array } {
  const n = sorted.length;
  return { x: sorted, share: Float64Array.from(sorted, (_, i) => (i + 1) / n) };
}

export interface NormalFit {
  mean: number;
  /** Maximum likelihood standard deviation: divisor n (the sample SD in the summary uses n − 1). */
  sigma: number;
  logLikelihood: number;
}

/**
 * Normal distribution by maximum likelihood: μ = mean(x), σ² = mean((x − μ)²).
 * Log-likelihood ℓ = −n/2 · ln(2πσ²) − n/2. Needs at least two different values.
 */
export function fitNormal(sorted: Float64Array): NormalFit | null {
  const n = sorted.length;
  if (n < 2) return null;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  if (!(variance > 0)) return null;
  return {
    mean,
    sigma: Math.sqrt(variance),
    logLikelihood: (-n / 2) * Math.log(2 * Math.PI * variance) - n / 2,
  };
}

export interface LognormalFit {
  /** Mean of ln(x) (x in the unit of the diameters). */
  mu: number;
  /** Standard deviation of ln(x), maximum likelihood (divisor n). */
  sigma: number;
  /** Median of the distribution, exp(μ), in the unit of the diameters. */
  median: number;
  /** Mean of the distribution, exp(μ + σ²/2). */
  mean: number;
  /** Geometric standard deviation, exp(σ), a factor without unit. */
  geometricSd: number;
  logLikelihood: number;
}

/**
 * Lognormal distribution by maximum likelihood: ln x is normal with μ = mean(ln x) and
 * σ² = mean((ln x − μ)²). Log-likelihood ℓ = −Σ ln x − n/2 · ln(2πσ²) − n/2.
 * Needs at least two different positive values.
 */
export function fitLognormal(sorted: Float64Array): LognormalFit | null {
  const n = sorted.length;
  if (n < 2) return null;
  const logs = Array.from(sorted, Math.log);
  const mu = logs.reduce((s, v) => s + v, 0) / n;
  const variance = logs.reduce((s, v) => s + (v - mu) ** 2, 0) / n;
  if (!(variance > 0)) return null;
  const sigma = Math.sqrt(variance);
  return {
    mu,
    sigma,
    median: Math.exp(mu),
    mean: Math.exp(mu + variance / 2),
    geometricSd: Math.exp(sigma),
    logLikelihood:
      -logs.reduce((s, v) => s + v, 0) - (n / 2) * Math.log(2 * Math.PI * variance) - n / 2,
  };
}

export const normalPdf = (x: number, fit: Pick<NormalFit, 'mean' | 'sigma'>): number =>
  Math.exp(-0.5 * ((x - fit.mean) / fit.sigma) ** 2) / (fit.sigma * Math.sqrt(2 * Math.PI));

export const lognormalPdf = (x: number, fit: Pick<LognormalFit, 'mu' | 'sigma'>): number =>
  x > 0
    ? Math.exp(-0.5 * ((Math.log(x) - fit.mu) / fit.sigma) ** 2) /
      (x * fit.sigma * Math.sqrt(2 * Math.PI))
    : 0;

/**
 * Which fit has the higher likelihood. Both have two parameters, so the one with the larger
 * log-likelihood describes the data better; it is a hint, not a test of whether either is right.
 */
export function betterFit(normal: NormalFit | null, lognormal: LognormalFit | null) {
  if (!normal || !lognormal) return null;
  return lognormal.logLikelihood > normal.logLikelihood
    ? ('lognormal' as const)
    : ('normal' as const);
}
