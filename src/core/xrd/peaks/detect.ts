import { localNoise } from './noise';

/** A peak found automatically, before fitting. Angles in degrees 2θ. */
export interface DetectedPeak {
  index: number;
  center: number;
  /** Intensity at the peak point. */
  height: number;
  /** Height above the higher of the two lowest points separating it from taller neighbours. */
  prominence: number;
  /** Width at half the prominence, interpolated (degrees). */
  width: number;
  /** Prominence divided by the local noise level (see noise.ts); Infinity on noise-free data. */
  snr: number;
}

export interface DetectionOptions {
  /** Minimum prominence as a percentage of the data range (max − min). */
  prominencePercent: number;
  /** Peaks closer than this (degrees) are merged, keeping the more prominent one. */
  minSeparationDeg: number;
  /** Smallest prominence in units of the local noise level (0 switches the test off). */
  minSnr: number;
  /** Smallest width at half prominence, in data steps (0 switches the test off). */
  minWidthSteps: number;
}

/**
 * Defaults of my own choosing. On simulated scans of pure counting noise (3500 points, 30 to
 * 1000 counts per point, 20 scans each; see tests/xrd-validation.test.ts) a signal-to-noise of
 * 7 and a width of 3 steps gave about 0.1 false peaks per scan, where 3 and 2 gave about 100
 * (topographic prominence makes a noise maximum look several σ tall). A real peak must also
 * stand out by 3 % of the data range. A weaker real peak can be found by lowering the limits.
 */
export const DEFAULT_DETECTION: DetectionOptions = {
  prominencePercent: 3,
  minSeparationDeg: 0.1,
  minSnr: 7,
  minWidthSteps: 3,
};

/**
 * Finds peaks by topographic prominence, the same definition as SciPy's find_peaks.
 *
 * 1. Local maxima: points higher than the point before and at least as high as the point after
 *    (flat tops count once).
 * 2. Prominence: walk left and right from the peak until a higher point or the end of the data;
 *    the lowest point on each side is that side's base. Prominence = peak − higher base.
 * 3. Peaks below the prominence threshold are dropped. Then, from the most prominent down, any
 *    peak closer than minSeparationDeg to a kept peak is dropped.
 * 4. Width: the distance between the points where the peak falls to (peak − prominence / 2),
 *    linearly interpolated, within the peak's bases.
 * 5. Noise tests: a peak whose prominence is below minSnr times the local noise level (see
 *    localNoise), or whose width is below minWidthSteps median data steps, is dropped. These
 *    remove single-point counting spikes, which the prominence threshold alone keeps on noisy
 *    scans.
 *
 * x: 2θ in degrees, increasing. Returns peaks sorted by position.
 */
export function detectPeaks(
  x: Float64Array,
  y: Float64Array,
  options: DetectionOptions,
): DetectedPeak[] {
  const n = y.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of y) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const threshold = ((hi - lo) * options.prominencePercent) / 100;
  const noise = options.minSnr > 0 ? localNoise(y) : null;
  const steps: number[] = [];
  for (let i = 1; i < n; i++) steps.push((x[i] as number) - (x[i - 1] as number));
  steps.sort((a, b) => a - b);
  const minWidth = options.minWidthSteps * (steps[steps.length >> 1] ?? 0);

  const higherLeft = nearestHigher(y, 1);
  const higherRight = nearestHigher(y, -1);
  const minimum = rangeMinimum(y);

  const candidates: DetectedPeak[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = y[i] as number;
    if (!(v > (y[i - 1] as number))) continue;
    let j = i;
    while (j + 1 < n && (y[j + 1] as number) === v) j++;
    if (j + 1 >= n || !((y[j + 1] as number) < v)) {
      i = j;
      continue;
    }
    const peak = (i + j) >> 1;
    const start = i;
    i = j;

    // Bases: lowest points between the peak and the nearest higher point (or the end) on each side.
    const leftBase = minimum(Math.max(0, (higherLeft[start] as number) + 1), start);
    const rightBase = minimum(j, Math.min(n - 1, (higherRight[j] as number) - 1));
    const prominence = v - Math.max(y[leftBase] as number, y[rightBase] as number);
    if (prominence < threshold || prominence <= 0) continue;

    const half = v - prominence / 2;
    let a = peak;
    while (a > leftBase && (y[a] as number) > half) a--;
    let b = peak;
    while (b < rightBase && (y[b] as number) > half) b++;
    const cross = (i0: number, i1: number) => {
      const y0 = y[i0] as number;
      const y1 = y[i1] as number;
      const t = y1 === y0 ? 0 : (half - y0) / (y1 - y0);
      return (x[i0] as number) + t * ((x[i1] as number) - (x[i0] as number));
    };
    const left = a < peak ? cross(a, a + 1) : (x[peak] as number);
    const right = b > peak ? cross(b, b - 1) : (x[peak] as number);
    const level = noise ? (noise[peak] as number) : 0;
    const snr = level > 0 ? prominence / level : Infinity;
    if (noise && snr < options.minSnr) continue;
    if (right - left < minWidth) continue;
    candidates.push({
      index: peak,
      center: x[peak] as number,
      height: v,
      prominence,
      width: right - left,
      snr,
    });
  }

  const kept: DetectedPeak[] = [];
  for (const peak of [...candidates].sort((p, q) => q.prominence - p.prominence)) {
    if (kept.every((k) => Math.abs(k.center - peak.center) >= options.minSeparationDeg))
      kept.push(peak);
  }
  return kept.sort((p, q) => p.center - q.center);
}

/**
 * For every point, the index of the nearest point that is strictly higher, searching left
 * (direction 1: result −1 if none) or right (direction −1: result n if none). One pass with a
 * stack of indices whose values decrease, so O(n).
 */
function nearestHigher(y: Float64Array, direction: 1 | -1): Int32Array {
  const n = y.length;
  const out = new Int32Array(n);
  const stack: number[] = [];
  for (let step = 0; step < n; step++) {
    const i = direction === 1 ? step : n - 1 - step;
    while (stack.length > 0 && (y[stack[stack.length - 1] as number] as number) <= (y[i] as number))
      stack.pop();
    out[i] = stack.length > 0 ? (stack[stack.length - 1] as number) : direction === 1 ? -1 : n;
    stack.push(i);
  }
  return out;
}

/**
 * Sparse table for the index of the minimum of y over any inclusive range [a, b] in O(1)
 * after O(n log n) preparation.
 */
function rangeMinimum(y: Float64Array): (a: number, b: number) => number {
  const n = y.length;
  const levels: Int32Array[] = [Int32Array.from({ length: n }, (_, i) => i)];
  for (let size = 2; size <= n; size *= 2) {
    const previous = levels[levels.length - 1] as Int32Array;
    const half = size / 2;
    const level = new Int32Array(n - size + 1);
    for (let i = 0; i < level.length; i++) {
      const p = previous[i] as number;
      const q = previous[i + half] as number;
      level[i] = (y[q] as number) < (y[p] as number) ? q : p;
    }
    levels.push(level);
  }
  return (a, b) => {
    const k = Math.floor(Math.log2(b - a + 1));
    const level = levels[k] as Int32Array;
    const p = level[a] as number;
    const q = level[b - (1 << k) + 1] as number;
    return (y[q] as number) < (y[p] as number) ? q : p;
  };
}
