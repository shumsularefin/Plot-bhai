/*
 * Crystallinity index: the share of the scattered intensity that is in sharp peaks rather than
 * in a broad amorphous hump.
 */

/** How the amorphous hump is described. Angles in degrees 2θ. */
export type HumpModel =
  | {
      /** Gaussian of fixed centre and FWHM; its height is fitted to the points outside the peaks. */
      kind: 'gaussian';
      centre: number;
      fwhm: number;
      /** 2θ intervals [from, to] around crystalline peaks, left out of the height fit. */
      exclude: readonly (readonly [number, number])[];
    }
  | {
      /** Straight lines between the pattern's own level at the given 2θ positions. */
      kind: 'anchors';
      positions: readonly number[];
      /** The level at an anchor is the lowest intensity within ± this many degrees. */
      halfWidth?: number;
    };

export interface CrystallinityResult {
  ok: true;
  /** 2θ points inside the range, degrees. */
  x: Float64Array;
  /** The amorphous curve at those points, in the data's intensity unit. */
  hump: Float64Array;
  /** Areas in intensity × degrees. */
  totalArea: number;
  amorphousArea: number;
  crystallineArea: number;
  /** Crystalline area / total area × 100, percent. */
  index: number;
}

export type CrystallinityOutcome = CrystallinityResult | { ok: false; reason: string };

/** Narrowest 2θ range that gives a meaningful index, degrees. */
export const MIN_RANGE_DEG = 2;
/**
 * Points within this many FWHM of a crystalline peak are left out of the hump-height fit: the
 * slowly falling tails of a peak would otherwise be taken for amorphous intensity.
 */
export const PEAK_EXCLUSION_FWHM = 6;
const DEFAULT_ANCHOR_HALF_WIDTH = 0.25;
const MIN_FIT_POINTS = 5;

/** Half-width of the moving mean the hump is clipped to, degrees 2θ. */
const CLIP_HALF_WIDTH_DEG = 0.25;

/** Mean of y within ±half of each x (x increasing). */
function movingMean(x: ArrayLike<number>, y: ArrayLike<number>, half: number): Float64Array {
  const out = new Float64Array(x.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    while (hi < x.length && (x[hi] as number) <= (x[i] as number) + half) sum += y[hi++] as number;
    while ((x[lo] as number) < (x[i] as number) - half) sum -= y[lo++] as number;
    out[i] = sum / (hi - lo);
  }
  return out;
}

/** Trapezoid rule area of y(x) over increasing x. */
function trapezoid(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 1; i < x.length; i++)
    sum +=
      (((y[i] as number) + (y[i - 1] as number)) / 2) * ((x[i] as number) - (x[i - 1] as number));
  return sum;
}

/**
 * Crystallinity index over a 2θ range:
 *
 *   index = A_crystalline / (A_crystalline + A_amorphous) × 100,
 *   A_total = ∫ I dθ over the range,  A_amorphous = ∫ h dθ,  A_crystalline = A_total − A_amorphous
 *
 * I is the intensity after your cleaning steps (so a background you removed is not counted) and h
 * the amorphous curve. Areas by the trapezoid rule, in intensity × degrees 2θ. The Gaussian hump is
 *   h(2θ) = H · exp(−4 ln 2 · (2θ − c)² / w²)
 * with centre c and FWHM w given, and H (the height) from least squares over the points outside
 * `exclude`: H = Σ g·I / Σ g², g the unit-height Gaussian. The anchor hump is linear between the
 * lowest intensities within ±halfWidth of each anchor position and flat beyond the outer anchors.
 * The lowest value is used because the slowly falling tails of nearby peaks only add to the
 * level, and the minimum ignores most of that. Either hump is then clipped to the data
 * (h = min(h, Ī), Ī the mean of I within ±0.25°), because the amorphous part cannot be larger
 * than the measured intensity. The mean, not the single point, so that counting noise does not
 * cut into the hump at every point where a count happens to fall low.
 *
 * It is a relative index: it depends on the range, the background and the hump you choose, and it
 * is not an absolute degree of crystallinity.
 */
export function crystallinity(
  twoTheta: ArrayLike<number>,
  intensity: ArrayLike<number>,
  range: readonly [number, number],
  model: HumpModel,
): CrystallinityOutcome {
  const [lo, hi] = range;
  const indices: number[] = [];
  for (let i = 0; i < twoTheta.length; i++) {
    const t = twoTheta[i] as number;
    if (t >= lo && t <= hi) indices.push(i);
  }
  if (hi - lo < MIN_RANGE_DEG || indices.length < MIN_FIT_POINTS)
    return {
      ok: false,
      reason: `The 2θ range is too narrow: choose at least ${MIN_RANGE_DEG}° that contains the data.`,
    };
  const x = Float64Array.from(indices, (i) => twoTheta[i] as number);
  const y = Float64Array.from(indices, (i) => intensity[i] as number);

  let hump: Float64Array;
  if (model.kind === 'gaussian') {
    if (!(model.fwhm > 0))
      return { ok: false, reason: 'The hump width must be greater than zero.' };
    const g = x.map((t) => Math.exp((-4 * Math.LN2 * (t - model.centre) ** 2) / model.fwhm ** 2));
    let gy = 0;
    let gg = 0;
    let used = 0;
    x.forEach((t, i) => {
      if (model.exclude.some(([a, b]) => t >= a && t <= b)) return;
      gy += (g[i] as number) * (y[i] as number);
      gg += (g[i] as number) ** 2;
      used++;
    });
    if (used < MIN_FIT_POINTS || gg === 0)
      return {
        ok: false,
        reason:
          'Too few points lie between the peaks to estimate the hump. Narrow the range or the peak exclusion.',
      };
    const height = Math.max(0, gy / gg);
    hump = g.map((v) => v * height);
  } else {
    const half = model.halfWidth ?? DEFAULT_ANCHOR_HALF_WIDTH;
    const anchors = [...model.positions]
      .filter((p) => p >= lo && p <= hi)
      .sort((a, b) => a - b)
      .flatMap((p) => {
        const near: number[] = [];
        x.forEach((t, i) => {
          if (Math.abs(t - p) <= half) near.push(y[i] as number);
        });
        return near.length > 0 ? [{ p, level: Math.max(0, Math.min(...near)) }] : [];
      });
    if (anchors.length < 2)
      return {
        ok: false,
        reason: 'Give at least two anchor positions inside the range, where the pattern has data.',
      };
    hump = x.map((t) => {
      const first = anchors[0] as (typeof anchors)[number];
      const last = anchors[anchors.length - 1] as (typeof anchors)[number];
      if (t <= first.p) return first.level;
      if (t >= last.p) return last.level;
      const j = anchors.findIndex((a) => a.p >= t);
      const a = anchors[j - 1] as (typeof anchors)[number];
      const b = anchors[j] as (typeof anchors)[number];
      return a.level + ((b.level - a.level) * (t - a.p)) / (b.p - a.p);
    });
  }

  const ceiling = movingMean(x, y, CLIP_HALF_WIDTH_DEG);
  hump = hump.map((h, i) => Math.min(h, Math.max(0, ceiling[i] as number)));
  const totalArea = trapezoid(x, y);
  const amorphousArea = trapezoid(x, hump);
  const crystallineArea = totalArea - amorphousArea;
  if (!(totalArea > 0) || !(crystallineArea > 0))
    return {
      ok: false,
      reason:
        'The amorphous hump is as large as the whole pattern in this range, so no crystalline area is left. Lower the hump or change the range.',
    };
  return {
    ok: true,
    x,
    hump,
    totalArea,
    amorphousArea,
    crystallineArea,
    index: (100 * crystallineArea) / totalArea,
  };
}
