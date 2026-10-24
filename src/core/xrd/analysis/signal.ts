/*
 * Is there a peak where a reference line is expected? Compares the height of the pattern at that
 * position with the point-to-point noise around it.
 */

export interface LineSignal {
  /** Highest intensity within the tolerance of the expected position above the local baseline, in the data's unit. */
  height: number;
  /** Point-to-point noise (standard deviation) around the position, in the data's unit. */
  noise: number;
  /** height / noise, dimensionless; Infinity when the data show no noise at all but a bump. */
  ratio: number;
}

/** Half-width of the window around the expected position used for baseline and noise, degrees 2θ. */
export const SIGNAL_WINDOW_DEG = 1;
/** A bump taller than this many noise standard deviations counts as a peak that is really there. */
export const VISIBLE_SIGNAL_RATIO = 3;
const MIN_WINDOW_POINTS = 12;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * Signal at an expected line position, 2θ in degrees (twoTheta must increase).
 *
 *   baseline = mean of the medians of the outer quarters of the window (a straight background)
 *   height   = max Ī within ±tolerance of the position − baseline, Ī the mean of three neighbouring points
 *   noise σ  = 1.4826 · MAD(ΔI) / √2, with ΔI the differences of neighbouring points
 *
 * The differences of neighbouring points remove a smooth background and peaks, and the factor √2
 * turns the spread of a difference of two noisy points into the spread of one point. The top is
 * read from the three-point mean because the single highest of a dozen noisy points sits about
 * 1.7 σ above the baseline even where there is no peak. Returns null
 * when the window holds too few points (the position is at the edge of the data).
 */
export function signalAt(
  twoTheta: ArrayLike<number>,
  intensity: ArrayLike<number>,
  position: number,
  tolerance: number,
): LineSignal | null {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < twoTheta.length; i++) {
    const t = twoTheta[i] as number;
    if (Math.abs(t - position) <= SIGNAL_WINDOW_DEG + tolerance) {
      x.push(t);
      y.push(intensity[i] as number);
    }
  }
  if (y.length < MIN_WINDOW_POINTS) return null;
  const quarter = Math.max(1, y.length >> 2);
  const baseline = (median(y.slice(0, quarter)) + median(y.slice(-quarter))) / 2;
  let top = -Infinity;
  x.forEach((t, i) => {
    if (Math.abs(t - position) > tolerance) return;
    const near = y.slice(Math.max(0, i - 1), i + 2);
    top = Math.max(top, near.reduce((sum, v) => sum + v, 0) / near.length);
  });
  if (top === -Infinity) return null;
  const steps = y.slice(1).map((v, i) => Math.abs(v - (y[i] as number)));
  const noise = (1.4826 * median(steps)) / Math.SQRT2;
  const height = Math.max(0, top - baseline);
  return { height, noise, ratio: noise > 0 ? height / noise : height > 0 ? Infinity : 0 };
}
