import { lowerBoundIndex } from '../xrd/peaks/search';

/**
 * Width, area and overlap of one band, measured above a local baseline.
 *
 * Local baseline: the straight line b(ν̃) through the lowest data point on each side of the band,
 * searched between the band and its neighbouring band (or the end of the searched range). This is
 * the "valley-to-valley" baseline of band integration in IR practice.
 *
 *   h    = A(ν̃ₚ) − b(ν̃ₚ)               height above the local baseline (absorbance, unitless),
 *                                      ν̃ₚ the highest data point of the band
 *   FWHM = ν̃₊ − ν̃₋                    full width at half height, cm⁻¹, where ν̃₋ and ν̃₊ are the
 *                                      first points either side where A − b falls to h / 2
 *                                      (linear interpolation between data points)
 *   area = ∫ (A − b) dν̃ from ν̃_L to ν̃_R  integrated absorbance above the line, absorbance·cm⁻¹,
 *                                      trapezoid rule on the data points
 *
 * The baseline cuts off the wings of a band beyond its limits, so for a Lorentzian band (whose
 * wings fall slowly) the area is smaller than the full analytic area; tests/ftir-peak-shape.test.ts
 * gives the exact expected value for a truncated band.
 */
export interface PeakShape {
  /** Limits of the local baseline, cm⁻¹ (increasing). */
  fromCm: number;
  toCm: number;
  /** Height above the local baseline, same unit as the spectrum. */
  heightAbove: number;
  /** Full width at half height above the local baseline, cm⁻¹; null when the height is not positive. */
  fwhm: number | null;
  /** Integrated absorbance above the local baseline, absorbance·cm⁻¹; null when the height is not positive. */
  area: number | null;
  /**
   * The band shares a limit with a neighbour and the valley between them is more than half the
   * band's height above the lower of its two limits, so the two bands are not resolved at half
   * height and width and area depend on how the overlap is split (fit the bands instead).
   * This criterion is my own choice, after the usual "resolved at half height" reading.
   */
  overlap: boolean;
}

/**
 * Shapes of bands at the given positions (cm⁻¹, increasing; the positions must be maxima of y).
 * x increasing. `fromCm`/`toCm` bound the outermost limits (the peak search range).
 */
export function peakShapes(
  x: Float64Array,
  y: Float64Array,
  positions: readonly number[],
  fromCm = -Infinity,
  toCm = Infinity,
): PeakShape[] {
  const n = x.length;
  if (n < 3) return positions.map(() => emptyShape());
  const start = Math.min(n - 1, lowerBoundIndex(x, fromCm));
  const end = Math.max(start, Math.min(n, lowerBoundIndex(x, toCm + 1e-9)) - 1);
  const centres = positions.map((p) => highestNear(x, y, p));
  const lowest = (a: number, b: number) => {
    let k = a;
    for (let i = a; i <= b; i++) if ((y[i] as number) < (y[k] as number)) k = i;
    return k;
  };
  return centres.map((c, k) => {
    const prev = centres[k - 1];
    const next = centres[k + 1];
    const L = lowest(prev ?? Math.min(start, c), c);
    const R = lowest(c, next ?? Math.max(end, c));
    const xL = x[L] as number;
    const xR = x[R] as number;
    const yL = y[L] as number;
    const yR = y[R] as number;
    const base = (xi: number) => (xR > xL ? yL + ((yR - yL) * (xi - xL)) / (xR - xL) : yL);
    const net = (i: number) => (y[i] as number) - base(x[i] as number);
    const h = net(c);
    const floor = Math.min(yL, yR);
    const above = (y[c] as number) - floor;
    const overlap =
      (prev !== undefined && yL - floor > above / 2) ||
      (next !== undefined && yR - floor > above / 2);
    if (!(h > 0) || L === R)
      return { fromCm: xL, toCm: xR, heightAbove: h, fwhm: null, area: null, overlap };
    const half = h / 2;
    let i = c;
    while (i > L && net(i) > half) i--;
    const left = crossing(x[i] as number, net(i), x[i + 1] as number, net(i + 1), half);
    let j = c;
    while (j < R && net(j) > half) j++;
    const right = crossing(x[j - 1] as number, net(j - 1), x[j] as number, net(j), half);
    let area = 0;
    for (let m = L; m < R; m++)
      area += (((x[m + 1] as number) - (x[m] as number)) * (net(m) + net(m + 1))) / 2;
    return { fromCm: xL, toCm: xR, heightAbove: h, fwhm: right - left, area, overlap };
  });
}

function emptyShape(): PeakShape {
  return { fromCm: NaN, toCm: NaN, heightAbove: NaN, fwhm: null, area: null, overlap: false };
}

/** x where the line through (x0, v0) and (x1, v1) reaches level. */
function crossing(x0: number, v0: number, x1: number, v1: number, level: number): number {
  return v1 === v0 ? x0 : x0 + ((level - v0) * (x1 - x0)) / (v1 - v0);
}

/** Index of the highest of the (up to) two data points around position p. */
function highestNear(x: Float64Array, y: Float64Array, p: number): number {
  const i = Math.min(x.length - 1, Math.max(1, lowerBoundIndex(x, p)));
  return (y[i - 1] as number) > (y[i] as number) ? i - 1 : i;
}

/** Intensity class of a band, from its height above the local baseline and its width. */
export interface IntensityClass {
  strength: 'strong' | 'medium' | 'weak';
  broad: boolean;
}

/**
 * Thresholds of my own choice: IR tables use s, m, w and br without numeric limits (no citable
 * convention was found), so they are stated on screen. Relative height = h / h_max · 100 %, h the
 * height above the local baseline and h_max the largest h among the spectrum's bands.
 */
export const STRONG_PERCENT = 60;
export const MEDIUM_PERCENT = 25;
/** A band at least this wide at half height (cm⁻¹) is called broad, such as an O–H stretch. */
export const BROAD_CM = 100;

export function intensityClass(relativePercent: number, fwhm: number | null): IntensityClass {
  return {
    strength:
      relativePercent >= STRONG_PERCENT
        ? 'strong'
        : relativePercent >= MEDIUM_PERCENT
          ? 'medium'
          : 'weak',
    broad: fwhm !== null && fwhm >= BROAD_CM,
  };
}

export const intensityText = (c: IntensityClass): string =>
  `${c.strength}${c.broad ? ', broad' : ''}`;
