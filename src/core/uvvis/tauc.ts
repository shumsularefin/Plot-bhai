import { linearFit } from '../math/linearFit';
import { linearFitMargin, WindowSums, type WindowLine } from '../math/windowSums';
import { energyFromWavelength } from './conversions';
import { toQuantity } from './process';
import { alphaWithReflection } from './optics';
import type { SpectrumKind, ValueScale } from './types';

/*
 * Optical band gap from the absorption edge (Tauc method), Urbach energy and the derivative
 * method. Energies are photon energies E = hc/λ in eV. See conversions.ts for the constants.
 *
 * Tauc relation (J. Tauc, R. Grigorovici and A. Vancu, Phys. Status Solidi 15 (1966) 627):
 *   (α·hν)^(1/n) = k · (hν − Eg)    near the edge,
 * so a plot of (α·hν)^(1/n) against hν is a straight line above the edge that meets the energy
 * axis at the band gap Eg. n = 1/2 direct allowed, 2 indirect allowed, 3/2 direct forbidden,
 * 3 indirect forbidden. Which n applies to a material must come from the literature.
 */

export type TransitionId =
  'direct-allowed' | 'indirect-allowed' | 'direct-forbidden' | 'indirect-forbidden';

export interface Transition {
  label: string;
  /** The exponent n of the transition. */
  n: number;
  /** The power 1/n applied to α·hν. */
  exponent: number;
  /** n as written, for axis labels and text. */
  nText: string;
}

export const TRANSITIONS: Record<TransitionId, Transition> = {
  'direct-allowed': { label: 'Direct allowed', n: 1 / 2, exponent: 2, nText: '1/2' },
  'indirect-allowed': { label: 'Indirect allowed', n: 2, exponent: 1 / 2, nText: '2' },
  'direct-forbidden': { label: 'Direct forbidden', n: 3 / 2, exponent: 2 / 3, nText: '3/2' },
  'indirect-forbidden': { label: 'Indirect forbidden', n: 3, exponent: 1 / 3, nText: '3' },
};

export type SignalUnit = 'alpha' | 'proportional' | 'kubelka-munk';

export interface AbsorptionSignal {
  /** Photon energy, eV, increasing. */
  energyEv: Float64Array;
  /** α in cm⁻¹ ('alpha'), A (absorbance, 'proportional') or F(R) ('kubelka-munk'). NaN where undefined. */
  signal: Float64Array;
  unit: SignalUnit;
}

/**
 * The quantity that stands in for the absorption coefficient α, from a (cleaned) spectrum.
 * Absorbance or transmittance: α = ln(10) · A / t when the film thickness t is given
 * (t in nm is converted to cm, so α is in cm⁻¹); without t the absorbance A itself is used and the
 * Tauc axis is only proportional to the true quantity, which does not move Eg. Reflectance: the
 * Kubelka–Munk function F(R) replaces α. The result is returned with increasing energy.
 * `thicknessNm` is the optical path: a film thickness, or a cuvette path length converted to nm.
 * With `reflectance` (the film's reflectance as a fraction on the same wavelengths) and a
 * thickness, α is corrected for reflection (`alphaWithReflection`, T = 10^(−A)); NaN where R is NaN.
 */
export function absorptionSignal(
  wavelengthNm: Float64Array,
  values: Float64Array,
  meaning: { kind: SpectrumKind; scale: ValueScale },
  thicknessNm: number | null,
  reflectance: Float64Array | null = null,
): AbsorptionSignal {
  const n = wavelengthNm.length;
  const quantity = meaning.kind === 'reflectance' ? 'kubelka-munk' : 'absorbance';
  const base = toQuantity(values, meaning, quantity) ?? new Float64Array(n).fill(NaN);
  const useThickness = quantity === 'absorbance' && thicknessNm !== null && thicknessNm > 0;
  const factor = useThickness ? Math.LN10 / ((thicknessNm as number) * 1e-7) : 1;
  const corrected = useThickness && reflectance !== null;
  const energyEv = new Float64Array(n);
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Reverse so that energy increases.
    const j = n - 1 - i;
    energyEv[i] = energyFromWavelength(wavelengthNm[j] as number);
    signal[i] = corrected
      ? alphaWithReflection(
          10 ** -(base[j] as number),
          reflectance[j] as number,
          (thicknessNm as number) * 1e-7,
        )
      : (base[j] as number) * factor;
  }
  return {
    energyEv,
    signal,
    unit: useThickness ? 'alpha' : quantity === 'absorbance' ? 'proportional' : 'kubelka-munk',
  };
}

/** (signal · E)^(1/n) for the Tauc plot, in the unit of the signal times eV, to the power 1/n. NaN where signal · E < 0. */
export function taucValues(
  energyEv: Float64Array,
  signal: Float64Array,
  exponent: number,
): Float64Array {
  return energyEv.map((e, i) => {
    const product = (signal[i] as number) * e;
    return product >= 0 ? product ** exponent : NaN;
  });
}

export interface BandGapFit {
  /** Band gap Eg = −intercept / slope, eV. */
  egEv: number;
  /** Standard uncertainty of Eg from the fit covariance (NaN with three or fewer points), eV. */
  egSigma: number;
  slope: number;
  intercept: number;
  rSquared: number;
  /** Points in the fit. */
  n: number;
  /** Energies of the first and last point used, eV. */
  fromEv: number;
  toEv: number;
}

/** Points of (x, y) with both finite and from ≤ x ≤ to. */
function inWindow(x: Float64Array, y: Float64Array, from: number, to: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    if (xi >= from && xi <= to && Number.isFinite(xi) && Number.isFinite(yi)) {
      xs.push(xi);
      ys.push(yi);
    }
  }
  return { xs, ys };
}

/**
 * Straight-line fit of the Tauc quantity y = a + b·E between two energies, and the band gap
 * Eg = −a / b where the line meets y = 0. Standard uncertainty by error propagation with the
 * fit covariance: σ²(Eg) = σa²/b² + a²σb²/b⁴ − 2a·cov(a,b)/b³, with cov(a,b) = −Ē · σb² for
 * ordinary least squares (Ē the mean energy of the points). Returns null with fewer than 4
 * points, a slope that is not positive, or a gap that is not above zero.
 */
export function fitBandGap(
  energyEv: Float64Array,
  y: Float64Array,
  fromEv: number,
  toEv: number,
): BandGapFit | null {
  const { xs, ys } = inWindow(energyEv, y, fromEv, toEv);
  if (xs.length < 4) return null;
  const fit = linearFit(xs, ys);
  if (!fit || !(fit.slope > 0)) return null;
  const { slope: b, intercept: a } = fit;
  const eg = -a / b;
  if (!(eg > 0)) return null;
  const mean = xs.reduce((sum, v) => sum + v, 0) / xs.length;
  const cov = -mean * fit.slopeSigma ** 2;
  const variance =
    (fit.interceptSigma / b) ** 2 + ((a * fit.slopeSigma) / (b * b)) ** 2 - (2 * a * cov) / b ** 3;
  return {
    egEv: eg,
    egSigma: Math.sqrt(Math.max(variance, 0)),
    slope: b,
    intercept: a,
    rSquared: fit.rSquared,
    n: xs.length,
    fromEv: xs[0] as number,
    toEv: xs[xs.length - 1] as number,
  };
}

/** Window spans tried by the automatic suggestion, eV, from narrowest to widest. */
const SPANS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.6];
const STRAIGHT = 0.995;
const MINIMUM_STRAIGHT = 0.98;

/**
 * How the edge region is suggested. 'steepest' (stage 22, the default) anchors the window on the
 * steepest point of the edge; 'widest' is the rule of earlier versions, kept only so that sessions
 * saved before stage 22 open with the same suggestion and band gap.
 */
export type RegionRule = 'steepest' | 'widest';

/*
 * Speed (2026-11-15): the region search fits a line to every window, about 300,000 windows of up
 * to 7,000 points on a 50,000-point spectrum, which took about 20 s per search with `linearFit`.
 * Each window's line now comes from double-double prefix sums in constant time (`WindowSums`).
 * Those numbers differ from `linearFit` in the last digits, and on a noise-free curve many
 * windows tie at R² ≈ 1 to the last digit, so the old rounding decides which one wins. To keep the
 * suggestion exactly as before, every comparison below that is closer than `linearFitMargin` of
 * the scale of the numbers involved (more than the rounding of `linearFit`) is decided again
 * with `linearFit` on those windows (`decide`); the windows chosen, and so the regions and band
 * gaps, are then bit-identical to the earlier code (tests/uvvis-tauc-speed.test.ts).
 */

/** Σ(y − ȳ)² / Σy² at or below which a window is checked with `linearFit` (own choice). */
const FLAT_WINDOW = 1e-8;

/** A sliding window of the region search with its straight-line fit. */
class Candidate {
  readonly from: number;
  readonly to: number;
  slope: number;
  intercept: number;
  r2: number;
  /** True once slope, intercept and r2 are those of `linearFit` on the window. */
  private exact = false;
  /** Relative margin of the values while not exact, and scales for slope and axis intercept. */
  private readonly margin: number;
  private readonly slopeScale: number;
  private readonly xMean: number;

  constructor(
    private readonly xs: Float64Array,
    private readonly ys: Float64Array,
    private readonly start: number,
    private readonly end: number,
    readonly target: number,
    /** Highest y in the window. */
    readonly top: number,
    line: WindowLine,
  ) {
    this.from = xs[start] as number;
    this.to = xs[end] as number;
    this.slope = line.slope;
    this.intercept = line.intercept;
    this.r2 = line.rSquared;
    this.margin = linearFitMargin(line);
    this.slopeScale = Math.sqrt(line.syy / line.sxx);
    this.xMean = line.xMean;
  }

  /** Replaces the fit by that of `linearFit`; false when `linearFit` gives no rising line. */
  refine(): boolean {
    if (!this.exact) {
      const fit = linearFit(
        this.xs.subarray(this.start, this.end + 1),
        this.ys.subarray(this.start, this.end + 1),
      );
      this.exact = true;
      this.slope = fit?.slope ?? NaN;
      this.intercept = fit?.intercept ?? NaN;
      this.r2 = fit?.rSquared ?? NaN;
    }
    return this.slope > 0 && Number.isFinite(this.r2);
  }

  /** The line meets y = 0 here, eV. */
  get gap(): number {
    return -this.intercept / this.slope;
  }

  /** Rise relative to the highest value in the window. */
  get steepness(): number {
    return this.slope / this.top;
  }

  get slopeTolerance(): number {
    return this.exact ? 0 : this.margin * this.slopeScale;
  }

  get r2Tolerance(): number {
    return this.exact ? 0 : this.margin;
  }

  /** gap = x̄ − ȳ/b: the rounding of ȳ, x̄ and of b (relative to the slope scale) carries into it. */
  get gapTolerance(): number {
    if (this.exact) return 0;
    const x = Math.abs(this.xMean);
    const g = this.gap;
    return (
      this.margin *
      (x + Math.abs(x - g) + ((x + Math.abs(g)) * this.slopeScale) / Math.abs(this.slope))
    );
  }
}

/**
 * The sign of value() (positive, zero or negative, or NaN), with the candidates' fits from
 * `linearFit` when |value()| is within the tolerance. After refinement the expression is
 * evaluated exactly as the earlier code compared it: a − b ≥ 0 exactly when a ≥ b for doubles.
 */
function decide(candidates: Candidate[], value: () => number, tolerance: () => number): number {
  const v = value();
  if (Math.abs(v) > tolerance()) return v;
  for (const c of candidates) c.refine();
  return value();
}

/** Sliding windows of 0.1 to 0.6 eV (at least 6 points) with a rising straight-line fit. */
function windows(xList: number[], yList: number[], top: number): Candidate[] {
  const xs = Float64Array.from(xList);
  const ys = Float64Array.from(yList);
  const sums = new WindowSums(xs, ys);
  const candidates: Candidate[] = [];
  for (const span of SPANS) {
    let end = 0;
    // Indices of the window whose y decrease from the front: the front is the window's maximum.
    const queue = new Int32Array(xs.length);
    let head = 0;
    let tail = 0;
    const enter = (i: number) => {
      while (tail > head && (ys[queue[tail - 1] as number] as number) <= (ys[i] as number)) tail--;
      queue[tail++] = i;
    };
    enter(0);
    for (let start = 0; start < xs.length; start++) {
      while (end < xs.length - 1 && (xs[end] as number) - (xs[start] as number) < span)
        enter(++end);
      if ((xs[end] as number) - (xs[start] as number) < span) break;
      while ((queue[head] as number) < start) head++;
      if (end - start + 1 < 6) continue;
      let highest = ys[queue[head] as number] as number;
      // Math.max, as before, gives +0 for a window holding both zeros.
      if (highest === 0) highest = Math.max(...ys.subarray(start, end + 1));
      if (highest < 0.05 * top) continue;
      // Never null here: the window spans at least 0.1 eV, so its energies are not all equal.
      const line = sums.line(start, end);
      if (!line) continue;
      const c = new Candidate(xs, ys, start, end, span, highest, line);
      if (
        !(
          decide(
            [c],
            () => c.slope,
            () => c.slopeTolerance,
          ) > 0
        )
      )
        continue;
      // R² is NaN when every y is equal, which double-double sums may round to a tiny spread:
      // a nearly flat window is checked with `linearFit`.
      if (line.syy <= FLAT_WINDOW * line.sumYY) c.refine();
      if (c.slope > 0 && Number.isFinite(c.r2)) candidates.push(c);
    }
  }
  return candidates;
}

/** The derivative stops counting as the main rise below this fraction of its maximum so far (own choice). */
const MAIN_RISE_FRACTION = 0.5;
/** Standard uncertainties subtracted from each local slope before the maximum is taken (own choice). */
const SLOPE_SIGMAS = 3;
/** Energy span of the local line that smooths the derivative, eV: the narrowest window of SPANS. */
const SLOPE_SPAN_EV = 0.1;

/**
 * Smoothed first derivative of y(x): at each point the slope of a least-squares line through the
 * points within ±0.05 eV of it, and at least its 4 neighbours on each side (as in
 * `derivativeMaximum`), with the standard uncertainty of that slope from the fit. A span in energy
 * keeps the smoothing about the same on a wavelength grid, where the points are far denser at low
 * energy; the 4 neighbours keep enough points where the grid is coarse. NaN where the span runs
 * past either end of the data or holds a value that is not finite. x must increase.
 */
export function slopesOverSpan(
  x: Float64Array,
  y: Float64Array,
  span: number = SLOPE_SPAN_EV,
): { slope: Float64Array; sigma: Float64Array } {
  const n = x.length;
  const slope = new Float64Array(n).fill(NaN);
  const sigma = new Float64Array(n).fill(NaN);
  const half = span / 2;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const c = x[i] as number;
    while ((x[lo] as number) < c - half) lo++;
    while (hi < n - 1 && (x[hi + 1] as number) <= c + half) hi++;
    const from = Math.min(lo, i - DERIVATIVE_HALF_WINDOW);
    const to = Math.max(hi, i + DERIVATIVE_HALF_WINDOW);
    if (from < 0 || to > n - 1 || c - half < (x[0] as number) || c + half > (x[n - 1] as number))
      continue;
    // The least squares of `linearFit`, in the same order of operations, without copying.
    const count = to - from + 1;
    let sx = 0;
    let sy = 0;
    let finite = true;
    for (let k = from; k <= to; k++) {
      const v = y[k] as number;
      if (!Number.isFinite(v)) {
        finite = false;
        break;
      }
      sx += x[k] as number;
      sy += v;
    }
    if (!finite) continue;
    const xBar = sx / count;
    const yBar = sy / count;
    let sxx = 0;
    let sxy = 0;
    for (let k = from; k <= to; k++) {
      const dx = (x[k] as number) - xBar;
      sxx += dx * dx;
      sxy += dx * ((y[k] as number) - yBar);
    }
    if (!(sxx > 0)) continue;
    const b = sxy / sxx;
    const a = yBar - b * xBar;
    let ssr = 0;
    for (let k = from; k <= to; k++) ssr += ((y[k] as number) - a - b * (x[k] as number)) ** 2;
    slope[i] = b;
    sigma[i] = Math.sqrt((count > 2 ? ssr / (count - 2) : NaN) / sxx);
  }
  return { slope, sigma };
}

/**
 * The steepest point of the main rise of the Tauc curve, and the slope there. The derivative is
 * smoothed over 0.1 eV (`slopesOverSpan`), and the steepest point is where its lower bound,
 * slope − 3σ, is largest, so a slope made steep by noise (at the foot of an indirect edge, or at
 * the noisy top of a direct one) does not win over one the data determine well; on data with
 * little noise it is the maximum of the derivative. Only points above 5 % of the highest value
 * count. Going up in energy, the main rise starts at the first point whose bound reaches half of
 * the highest bound (so a sloping sub-gap level is passed over) and ends where the bound falls below
 * half of its largest value since then (own choice of the span and both fractions), so a second,
 * slower rise above the edge (F(R) saturating at low reflectance, which can be steeper in absolute
 * terms at high energy) is not taken for the edge. Bounds equal to 10⁻⁹ (a straight noise-free
 * Tauc curve, where every point is equally steep) go to the lower energy. Null when the curve does
 * not rise. `atEnd` is true when the slope is still rising within 0.1 eV of the last point where
 * it is defined, so the curve has no steepest part inside the data (a background that curves up,
 * such as scattering, under a straight-line correction). Energies must increase, with NaN where
 * the curve is undefined.
 */
export function steepestRise(
  energyEv: Float64Array,
  y: Float64Array,
): { energyEv: number; slope: number; atEnd: boolean } | null {
  let top = 0;
  for (const v of y) if (v > top) top = v;
  const { slope, sigma } = slopesOverSpan(energyEv, y);
  const bound = slope.map((d, i) => d - SLOPE_SIGMAS * (sigma[i] as number));
  const counts = (i: number) => Number.isFinite(bound[i]) && (y[i] as number) >= 0.05 * top;
  let highest = 0;
  for (let i = 0; i < y.length; i++) if (counts(i)) highest = Math.max(highest, bound[i] as number);
  let best = -1;
  let last = -1;
  let ended = false;
  for (let i = 0; i < y.length; i++) {
    if (!counts(i)) continue;
    const d = bound[i] as number;
    if (best < 0 && d < MAIN_RISE_FRACTION * highest) continue;
    if (best >= 0 && d < MAIN_RISE_FRACTION * (bound[best] as number)) {
      ended = true;
      break;
    }
    last = i;
    if (best < 0 || d > (bound[best] as number) * (1 + 1e-9)) best = i;
  }
  if (!(best >= 0 && (bound[best] as number) > 0)) return null;
  const atEnd = !ended && (energyEv[last] as number) - (energyEv[best] as number) < SLOPE_SPAN_EV;
  return { energyEv: energyEv[best] as number, slope: slope[best] as number, atEnd };
}

/**
 * Suggests the fitting region of the Tauc line (own choice of rule, stage 22; no paper that states
 * the rule was opened). The line is anchored on the steepest point of the edge (`steepestRise`):
 * windows of 0.1 to 0.6 eV (at least 6 points) slid along the curve compete only when they
 * contain or touch that point and their line rises at least half as fast as the curve there (own
 * choice, so that a window on the foot of the edge that touches the point does not compete). Among them, those of the widest size with R² ≥ 0.995 compete and
 * the one with the highest R² wins (wide windows average out noise); if none is that straight,
 * the threshold falls to 0.98, and then to the best R². A window is rejected when its line meets
 * y = 0 at or below zero energy, inside or above the window itself, or above the steepest point:
 * such a line does not describe the edge. Windows lying on the flat baseline (top of the window
 * below 5 % of the highest value) are ignored. When no anchored window remains, the same choice is
 * made among all windows that pass the rejection (own choice). Because the straightest window is
 * chosen, the uncertainty of its fit is somewhat too small. A suggestion only: the user can change
 * the limits.
 *
 * The anchor also covers the spectra that flatten above the edge (a real TiO₂ diffuse reflectance
 * file, tests/fixtures-real/uvvis/, 2026-11-14), where the slow rise above the edge is straighter
 * and wider than the edge itself, so the separate guard of that date is not needed in this rule.
 * When the curve is still steepest at the end of the data (`atEnd`), there is no steepest part of
 * the edge to anchor on, and the earlier rule is used (own choice): without it a background that
 * curves up (scattering, c·E^m, under a straight-line correction) pulled the anchor to the top of
 * the data, 3.69 eV for a 3.20 eV edge (tests/uvvis-tauc-baseline.test.ts).
 * `rule` 'widest' gives the suggestion of earlier versions (`suggestRegionBefore22`).
 * Returns [fromEv, toEv], or null when no window has a rising line.
 */
export function suggestRegion(
  energyEv: Float64Array,
  y: Float64Array,
  rule: RegionRule = 'steepest',
): [number, number] | null {
  if (rule === 'widest') return suggestRegionBefore22(energyEv, y);
  const { xs, ys } = inWindow(energyEv, y, -Infinity, Infinity);
  const top = ys.reduce((m, v) => Math.max(m, v), 0);
  const steep = steepestRise(energyEv, y);
  if (steep?.atEnd) return suggestRegionBefore22(energyEv, y);
  const gapBelow = (c: Candidate, limit: number) =>
    decide(
      [c],
      () => limit - c.gap,
      () => c.gapTolerance,
    );
  const describesEdge = (c: Candidate) =>
    gapBelow(c, 0) < 0 &&
    gapBelow(c, c.from) > 0 &&
    (steep === null || gapBelow(c, steep.energyEv) >= 0);
  const valid = windows(xs, ys, top).filter(describesEdge);
  if (valid.length === 0) return null;
  const anchored = valid.filter(
    (c) =>
      steep !== null &&
      c.from <= steep.energyEv &&
      c.to >= steep.energyEv &&
      decide(
        [c],
        () => c.slope - MAIN_RISE_FRACTION * steep.slope,
        () => c.slopeTolerance,
      ) >= 0,
  );
  const chosen = straightestWidest(anchored.length > 0 ? anchored : valid);
  return [chosen.from, chosen.to];
}

/**
 * The suggestion of versions before stage 22, used only for sessions saved then, so that their
 * band gap does not change when they are opened. The widest straight stretch: among windows with
 * R² ≥ 0.995, those of the widest size compete and the one with the highest R² wins (else 0.98,
 * else the best R²). Guard for spectra that flatten above the edge (2026-11-14): the steepest part
 * of the edge is the narrowest window with the largest relative rise, slope / (highest value in
 * the window); when the chosen line meets y = 0 above it, or at or below zero, the choice is made
 * again among the windows that overlap it.
 */
function suggestRegionBefore22(energyEv: Float64Array, y: Float64Array): [number, number] | null {
  const { xs, ys } = inWindow(energyEv, y, -Infinity, Infinity);
  const top = ys.reduce((m, v) => Math.max(m, v), 0);
  const candidates = windows(xs, ys, top);
  if (candidates.length === 0) return null;
  const chosen = straightestWidest(candidates);
  const narrowest = candidates.filter(
    (c) => c.target === candidates[0]?.target && atLeast(c, MINIMUM_STRAIGHT),
  );
  if (narrowest.length === 0) return [chosen.from, chosen.to];
  const steepest = narrowest.reduce((a, b) =>
    decide(
      [a, b],
      () => b.steepness - a.steepness,
      () => a.slopeTolerance / a.top + b.slopeTolerance / b.top,
    ) > 0
      ? b
      : a,
  );
  const gapAbove = (limit: number) =>
    decide(
      [chosen],
      () => chosen.gap - limit,
      () => chosen.gapTolerance,
    );
  if (gapAbove(0) > 0 && gapAbove(steepest.to) <= 0) return [chosen.from, chosen.to];
  const best = straightestWidest(
    candidates.filter((c) => c.from <= steepest.to && c.to >= steepest.from),
  );
  return [best.from, best.to];
}

/** R² ≥ threshold. */
function atLeast(c: Candidate, threshold: number): boolean {
  return (
    decide(
      [c],
      () => c.r2 - threshold,
      () => c.r2Tolerance,
    ) >= 0
  );
}

/** The candidate of higher R², the first when they are equal. */
function straighter(a: Candidate, b: Candidate): Candidate {
  return decide(
    [a, b],
    () => b.r2 - a.r2,
    () => a.r2Tolerance + b.r2Tolerance,
  ) > 0
    ? b
    : a;
}

/** The widest window with R² ≥ 0.995 (else 0.98), the straightest among those; else the straightest. */
function straightestWidest(candidates: Candidate[]): Candidate {
  for (const threshold of [STRAIGHT, MINIMUM_STRAIGHT]) {
    const good = candidates.filter((c) => atLeast(c, threshold));
    if (good.length > 0) {
      const widest = good.reduce((m, c) => Math.max(m, c.target), -Infinity);
      return good.filter((c) => c.target === widest).reduce(straighter);
    }
  }
  return candidates.reduce(straighter);
}

/*
 * Band gap when the spectrum does not fall to zero below the edge (audit of 2026-11-14).
 *
 * Scattering, a second phase, defects, a dye or an imperfect blank add a sub-gap absorption to
 * the absorption quantity S (α, A or F(R)). The Tauc line extended to y = 0 then meets the axis
 * below the gap: for S = 1.2·√(E − 3.2)/E + c, the axis intercept is 3.116, 2.926 and 2.690 eV
 * for c = 0.05, 0.2 and 0.5 (tests/uvvis-tauc-baseline.test.ts).
 *
 * Source: P. Makuła, M. Pacia and W. Macyk, "How To Correctly Determine the Band Gap Energy of
 * Modified Semiconductor Photocatalysts Based on UV–Vis Spectra", J. Phys. Chem. Lett. 9 (2018)
 * 6814–6817, doi:10.1021/acs.jpclett.8b02892 (paper read in full, 2026-11-14). By the
 * Beer–Lambert law the spectrum of a mixture is a linear combination, α = a·α_s + b·α_m (their
 * eq 4), so the Tauc transform must be applied to the semiconductor part alone. They give, in
 * order of accuracy:
 *
 * 1. 'subtract-component' (their Table 1, column 2): the measured spectrum of the second
 *    component, scaled by a factor c, is subtracted, α_s = α − c·α_m, and the Tauc analysis is
 *    done on α_s. They set c from the component's concentration; here c is that typed value, or a
 *    least-squares fit of S ≈ c·S_m over the sub-gap region, where α_s ≈ 0 (my own choice, so
 *    that c does not need the concentration).
 * 2. 'baseline-crossing' (their column 3, "simplified procedure", Figure 4): a second straight line
 *    is fitted to the Tauc curve in the slope below the fundamental absorption, and Eg is where
 *    the edge line and this line cross. In their data it lies within 0.08 eV of column 2. With an
 *    added level the Tauc curve (S·E)^(1/n) is bent above the gap, so on the synthetic spectra
 *    above the crossing gives 3.18, 3.15 and 3.14 eV.
 * 3. 'subtract-baseline' (my own model choice, default when a sub-gap level is found): column 2
 *    with a straight line S_b(E) = a_b + b_b·E fitted below the edge in place of a measured
 *    component spectrum. It is exact when the background adds to S and varies linearly with E
 *    across the edge, whatever the transition type, and approximate otherwise.
 *
 * The paper calls the plain axis intercept appropriate only for bare semiconductors.
 */

export type GapMethod = 'axis' | 'baseline-crossing' | 'subtract-baseline' | 'subtract-component';

export const GAP_METHODS: Record<GapMethod, { label: string; short: string }> = {
  axis: { label: 'Line meets the energy axis', short: 'axis intercept' },
  'baseline-crossing': {
    label: 'Line crosses a baseline on the Tauc plot',
    short: 'crossing with a Tauc-plot baseline',
  },
  'subtract-baseline': {
    label: 'Sub-gap baseline subtracted first',
    short: 'sub-gap baseline subtracted before the Tauc plot',
  },
  'subtract-component': {
    label: 'Spectrum of a second component subtracted first',
    short: 'spectrum of a second component subtracted before the Tauc plot',
  },
};

/** Ordinary least-squares line y = intercept + slope·E over a region, with its covariance. */
export interface StraightLine {
  slope: number;
  intercept: number;
  slopeSigma: number;
  interceptSigma: number;
  /** cov(intercept, slope) = −Ē·σ²(slope) for ordinary least squares. */
  covariance: number;
  rSquared: number;
  n: number;
  fromEv: number;
  toEv: number;
}

/** Straight line through the finite points between two energies; null with fewer than 4 points. */
export function fitLine(
  energyEv: Float64Array,
  y: Float64Array,
  fromEv: number,
  toEv: number,
): StraightLine | null {
  const { xs, ys } = inWindow(energyEv, y, fromEv, toEv);
  if (xs.length < 4) return null;
  const fit = linearFit(xs, ys);
  if (!fit) return null;
  const mean = xs.reduce((sum, v) => sum + v, 0) / xs.length;
  return {
    slope: fit.slope,
    intercept: fit.intercept,
    slopeSigma: fit.slopeSigma,
    interceptSigma: fit.interceptSigma,
    covariance: -mean * fit.slopeSigma ** 2,
    rSquared: fit.rSquared,
    n: xs.length,
    fromEv: xs[0] as number,
    toEv: xs[xs.length - 1] as number,
  };
}

/** Variance of the value a + b·E of a fitted line at E: σa² + E²σb² + 2E·cov(a, b). */
function predictionVariance(line: StraightLine, e: number): number {
  return line.interceptSigma ** 2 + (e * line.slopeSigma) ** 2 + 2 * e * line.covariance;
}

/**
 * Energy where two fitted lines cross, E× = (a_base − a_edge) / (b_edge − b_base), with its
 * standard uncertainty. The two fits use separate points, so they are independent, and
 * propagation of errors gives σ²(E×) = [Var ŷ_edge(E×) + Var ŷ_base(E×)] / (b_edge − b_base)²,
 * where Var ŷ is the variance of a line's value at E× (σa² + E²σb² + 2E·cov). With a baseline
 * of exactly y = 0 this reduces to the axis-intercept formula of fitBandGap. Null when the edge
 * does not rise faster than the baseline.
 */
export function lineCrossing(
  edge: StraightLine,
  base: StraightLine,
): { egEv: number; egSigma: number } | null {
  const d = edge.slope - base.slope;
  if (!(d > 0)) return null;
  const e = (base.intercept - edge.intercept) / d;
  if (!(e > 0)) return null;
  const variance = (predictionVariance(edge, e) + predictionVariance(base, e)) / (d * d);
  return { egEv: e, egSigma: Math.sqrt(Math.max(variance, 0)) };
}

/** S − (a + b·E) at every point. */
export function subtractLine(
  energyEv: Float64Array,
  signal: Float64Array,
  line: Pick<StraightLine, 'slope' | 'intercept'>,
): Float64Array {
  return signal.map((v, i) => v - (line.intercept + line.slope * (energyEv[i] as number)));
}

/**
 * Band gap after subtracting a sub-gap baseline from the absorption quantity: Tauc fit of
 * (S − S_b)·E over the edge region. The uncertainty adds, to that of the edge fit, the part due
 * to the baseline line: Eg depends on the baseline intercept and slope through the Tauc
 * transform, so the derivatives ∂Eg/∂a_b and ∂Eg/∂b_b are taken by central differences (steps of
 * a tenth of each standard uncertainty) and combined with the baseline covariance,
 * σ²_b = J·C·Jᵀ. The baseline and edge use separate points, so the two parts add.
 */
export function subtractedGap(
  energyEv: Float64Array,
  signal: Float64Array,
  exponent: number,
  base: StraightLine,
  edge: [number, number],
): BandGapFit | null {
  const gapWith = (line: Pick<StraightLine, 'slope' | 'intercept'>) =>
    fitBandGap(
      energyEv,
      taucValues(energyEv, subtractLine(energyEv, signal, line), exponent),
      edge[0],
      edge[1],
    );
  const fit = gapWith(base);
  if (!fit) return null;
  const derivative = (which: 'intercept' | 'slope', sigma: number): number => {
    if (!(sigma > 0)) return 0;
    const h = sigma / 10;
    const up = gapWith({ ...base, [which]: base[which] + h });
    const down = gapWith({ ...base, [which]: base[which] - h });
    return up && down ? (up.egEv - down.egEv) / (2 * h) : NaN;
  };
  const ja = derivative('intercept', base.interceptSigma);
  const jb = derivative('slope', base.slopeSigma);
  const baseVariance =
    ja * ja * base.interceptSigma ** 2 +
    jb * jb * base.slopeSigma ** 2 +
    2 * ja * jb * (base.slopeSigma > 0 && base.interceptSigma > 0 ? base.covariance : 0);
  return {
    ...fit,
    egSigma: Math.sqrt(fit.egSigma ** 2 + Math.max(baseVariance, 0)),
  };
}

/**
 * Power-law (scattering) baseline of the absorption quantity, S_b(E) = a + c·E^m, E in eV, S_b in
 * the unit of the signal. Non-resonant scattering follows σ(λ) ∝ λ^−m (Kubetschek, Backes and
 * Goldie, Adv. Mater. Interfaces 2024, 2400311, eq 8, p. 8 of arXiv:2402.08517, CC BY 4.0), so
 * ∝ E^m since λ = hc/E; m = 4 is Rayleigh scattering and m = 2 the van de Hulst approximation of
 * Mie scattering for larger particles. The same paper says the power law holds only away from the
 * optical transitions, so it is fitted below the edge and extrapolated across it. The constant a
 * (an offset of the blank or a flat absorber) and the range 0 ≤ m ≤ 4 are my own choice.
 */
export interface PowerBaseline {
  a: number;
  c: number;
  m: number;
  /** True when m was given by the user, not fitted. */
  mFixed: boolean;
  /** Covariance of (a, c, m); the m row and column are zero when m is fixed. */
  covariance: number[][];
  /** Residual sum of squares and number of points of the fit. */
  rss: number;
  n: number;
  fromEv: number;
  toEv: number;
  /** True when a fitted m lies on 0 or 4. */
  onBound: boolean;
}

const POWER_M_MAX = 4;

/** Least-squares a, c of y = a + c·E^m for one m, and the residual sum of squares. */
function linearInPower(logX: Float64Array, y: Float64Array, m: number) {
  const n = logX.length;
  const u = logX.map((l) => Math.exp(m * l));
  let uSum = 0;
  let ySum = 0;
  for (let i = 0; i < n; i++) {
    uSum += u[i] as number;
    ySum += y[i] as number;
  }
  const uMean = uSum / n;
  const yMean = ySum / n;
  let suu = 0;
  let suy = 0;
  for (let i = 0; i < n; i++) {
    const du = (u[i] as number) - uMean;
    suu += du * du;
    suy += du * ((y[i] as number) - yMean);
  }
  const c = suu > 0 ? suy / suu : 0;
  const a = yMean - c * uMean;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += ((y[i] as number) - a - c * (u[i] as number)) ** 2;
  return { a, c, rss };
}

/** Inverse of a small symmetric positive-definite matrix (Gauss–Jordan); null when singular. */
function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const m = matrix.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(m[i]?.[k] as number) > Math.abs(m[p]?.[k] as number)) p = i;
    [m[k], m[p]] = [m[p] as number[], m[k] as number[]];
    const pivot = m[k]?.[k] as number;
    if (!(Math.abs(pivot) > 1e-300)) return null;
    const rowK = (m[k] as number[]).map((v) => v / pivot);
    m[k] = rowK;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const f = m[i]?.[k] as number;
      m[i] = (m[i] as number[]).map((v, j) => v - f * (rowK[j] as number));
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * JᵀJ and Jᵀr of y = a + c·E^m at (a, c, m), J = [1, E^m, c·E^m·ln E] (the first p columns),
 * and the residual sum of squares.
 */
function normalEquations(
  logX: Float64Array,
  y: Float64Array,
  a: number,
  c: number,
  m: number,
  p: number,
) {
  const jtj = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const jtr = new Array<number>(p).fill(0);
  const row = [1, 0, 0];
  let rss = 0;
  for (let i = 0; i < logX.length; i++) {
    const l = logX[i] as number;
    const u = Math.exp(m * l);
    row[1] = u;
    row[2] = c * u * l;
    const r = (y[i] as number) - a - c * u;
    rss += r * r;
    for (let j = 0; j < p; j++) {
      jtr[j] = (jtr[j] as number) + (row[j] as number) * r;
      const jr = jtj[j] as number[];
      for (let k = 0; k < p; k++)
        jr[k] = (jr[k] as number) + (row[j] as number) * (row[k] as number);
    }
  }
  return { jtj, jtr, rss };
}

/**
 * Fits S_b = a + c·E^m to the finite points between two energies (at least 6) by least squares.
 * With m fixed the problem is linear in a and c. Otherwise m is found in [0, 4] by minimising the
 * residual over a and c (a grid of steps of 0.1, then golden-section search to 10⁻⁶ between the
 * neighbours of the best grid point), and the three parameters are polished by Gauss–Newton
 * steps, kept only when they lower the residual and leave m inside [0, 4]. The covariance is
 * s²·(JᵀJ)⁻¹ with J = [1, E^m, c·E^m·ln E] (without the last column when m is fixed) and
 * s² = RSS/(n − p), as scipy.optimize.curve_fit reports it (scripts/validation/spectra/uvvis.py).
 * The result does not depend on the order of the points. Energies must be positive.
 */
export function fitPowerBaseline(
  energyEv: Float64Array,
  signal: Float64Array,
  fromEv: number,
  toEv: number,
  fixedM: number | null,
): PowerBaseline | null {
  const { xs, ys } = inWindow(energyEv, signal, fromEv, toEv);
  if (xs.length < 6 || !xs.every((v) => v > 0)) return null;
  const order = xs.map((_, i) => i).sort((i, j) => (xs[i] as number) - (xs[j] as number));
  const x = Float64Array.from(order, (i) => xs[i] as number);
  const y = Float64Array.from(order, (i) => ys[i] as number);
  const n = x.length;
  const logX = x.map(Math.log);
  let m: number;
  if (fixedM !== null) m = fixedM;
  else {
    const rssAt = (v: number) => linearInPower(logX, y, v).rss;
    let best = 0;
    let bestRss = Infinity;
    const steps = Math.round(POWER_M_MAX / 0.1);
    for (let k = 0; k <= steps; k++) {
      const r = rssAt((k * POWER_M_MAX) / steps);
      if (r < bestRss) [best, bestRss] = [k, r];
    }
    let lo = (Math.max(best - 1, 0) * POWER_M_MAX) / steps;
    let hi = (Math.min(best + 1, steps) * POWER_M_MAX) / steps;
    const g = (Math.sqrt(5) - 1) / 2;
    let p = hi - g * (hi - lo);
    let q = lo + g * (hi - lo);
    let rp = rssAt(p);
    let rq = rssAt(q);
    for (let k = 0; k < 200 && hi - lo > 1e-6; k++) {
      if (rp <= rq) {
        hi = q;
        q = p;
        rq = rp;
        p = hi - g * (hi - lo);
        rp = rssAt(p);
      } else {
        lo = p;
        p = q;
        rp = rq;
        q = lo + g * (hi - lo);
        rq = rssAt(q);
      }
    }
    m = rp <= rq ? p : q;
  }
  let { a, c, rss } = linearInPower(logX, y, m);
  const p = fixedM === null ? 3 : 2;
  if (fixedM === null) {
    for (let k = 0; k < 10; k++) {
      const { jtj, jtr } = normalEquations(logX, y, a, c, m, 3);
      const inverse = invert(jtj);
      if (!inverse) break;
      const step = inverse.map((row) => row.reduce((t, v, j) => t + v * (jtr[j] as number), 0));
      const next = {
        a: a + (step[0] as number),
        c: c + (step[1] as number),
        m: m + (step[2] as number),
      };
      if (!(next.m >= 0 && next.m <= POWER_M_MAX)) break;
      const nextRss = normalEquations(logX, y, next.a, next.c, next.m, 1).rss;
      if (!(nextRss <= rss)) break;
      const done = rss - nextRss <= 1e-15 * rss;
      ({ a, c, m } = next);
      rss = nextRss;
      if (done) break;
    }
  }
  const inverse = invert(normalEquations(logX, y, a, c, m, p).jtj);
  const s2 = rss / (n - p);
  const covariance = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => (inverse && i < p && j < p ? s2 * (inverse[i]?.[j] as number) : 0)),
  );
  return {
    a,
    c,
    m,
    mFixed: fixedM !== null,
    covariance,
    rss,
    n,
    fromEv: x[0] as number,
    toEv: x[n - 1] as number,
    onBound: fixedM === null && (m <= 1e-6 || m >= POWER_M_MAX - 1e-6),
  };
}

/** S − (a + c·E^m) at every point. */
export function subtractPower(
  energyEv: Float64Array,
  signal: Float64Array,
  base: Pick<PowerBaseline, 'a' | 'c' | 'm'>,
): Float64Array {
  return signal.map((v, i) => v - (base.a + base.c * (energyEv[i] as number) ** base.m));
}

/**
 * Band gap after subtracting a power-law baseline: Tauc fit of (S − S_b)·E over the edge region.
 * As in `subtractedGap`, the part of the uncertainty due to the baseline is J·C·Jᵀ, with the
 * derivatives of Eg with respect to a, c and m taken by central differences (steps of a tenth of
 * each standard uncertainty) and C the full covariance of (a, c, m); it adds to that of the edge
 * fit, since the two use separate points.
 */
export function powerSubtractedGap(
  energyEv: Float64Array,
  signal: Float64Array,
  exponent: number,
  base: PowerBaseline,
  edge: [number, number],
): BandGapFit | null {
  const gapWith = (b: Pick<PowerBaseline, 'a' | 'c' | 'm'>) =>
    fitBandGap(
      energyEv,
      taucValues(energyEv, subtractPower(energyEv, signal, b), exponent),
      edge[0],
      edge[1],
    );
  const fit = gapWith(base);
  if (!fit) return null;
  const keys = ['a', 'c', 'm'] as const;
  const jacobian = keys.map((key, i) => {
    const sigma = Math.sqrt(Math.max(base.covariance[i]?.[i] as number, 0));
    if (!(sigma > 0)) return 0;
    const h = sigma / 10;
    const up = gapWith({ ...base, [key]: base[key] + h });
    const down = gapWith({ ...base, [key]: base[key] - h });
    return up && down ? (up.egEv - down.egEv) / (2 * h) : NaN;
  });
  let variance = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      variance +=
        (jacobian[i] as number) * (jacobian[j] as number) * (base.covariance[i]?.[j] as number);
  return { ...fit, egSigma: Math.sqrt(fit.egSigma ** 2 + Math.max(variance, 0)) };
}

/** Width of the suggested baseline region and its distance below the edge, eV (my own choice). */
const BASELINE_WIDTH_EV = 0.5;
const BASELINE_GAP_EV = 0.1;

/**
 * A sub-gap level is reported when subtracting the baseline moves the band gap by more than this,
 * eV: my own choice, the size of the tolerance asked for in the audit. In the synthetic cases a
 * level of 0.05 in absorbance moves the axis intercept by 0.084 eV, and the noisy zero-level
 * spectra of tests/uvvis-tauc.test.ts move by less than 0.005 eV.
 */
export const SUB_GAP_SHIFT_EV = 0.01;

/**
 * Linear interpolation of y(x) at the points xTo; x must increase. NaN outside the range of x,
 * so a component spectrum is never extrapolated.
 */
export function interpolateOnto(x: Float64Array, y: Float64Array, xTo: Float64Array): Float64Array {
  const out = new Float64Array(xTo.length).fill(NaN);
  let j = 0;
  for (let i = 0; i < xTo.length; i++) {
    const t = xTo[i] as number;
    if (!(t >= (x[0] as number) && t <= (x[x.length - 1] as number))) continue;
    while (j < x.length - 2 && (x[j + 1] as number) < t) j++;
    const x0 = x[j] as number;
    const x1 = x[j + 1] as number;
    const y0 = y[j] as number;
    const y1 = y[j + 1] as number;
    out[i] = x1 === x0 ? y0 : y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
  }
  return out;
}

export interface ComponentFactor {
  /** Scale factor c in S_s = S − c·S_m (dimensionless when S and S_m have the same unit). */
  value: number;
  /** Standard uncertainty of c; 0 when c was typed by the user. */
  sigma: number;
  /** Points used for the fit; 0 when c was typed. */
  n: number;
}

/**
 * Least-squares factor c of S ≈ c·S_m over a region where the semiconductor does not absorb
 * (Makuła, Pacia and Macyk 2018, eq 4 with α_s ≈ 0 below the gap): a line through the origin,
 * c = Σ S·S_m / Σ S_m², σ²(c) = s² / Σ S_m² with s² = Σ (S − c·S_m)² / (n − 1).
 * Returns null with fewer than 4 points or a component that is zero there.
 */
export function componentFactor(
  energyEv: Float64Array,
  signal: Float64Array,
  component: Float64Array,
  region: [number, number],
): ComponentFactor | null {
  let sxy = 0;
  let sxx = 0;
  let n = 0;
  const pairs: [number, number][] = [];
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    const s = signal[i] as number;
    const m = component[i] as number;
    if (e < region[0] || e > region[1] || !Number.isFinite(s) || !Number.isFinite(m)) continue;
    sxy += s * m;
    sxx += m * m;
    n++;
    pairs.push([s, m]);
  }
  if (n < 4 || !(sxx > 0)) return null;
  const c = sxy / sxx;
  const rss = pairs.reduce((sum, [s, m]) => sum + (s - c * m) ** 2, 0);
  return { value: c, sigma: Math.sqrt(rss / (n - 1) / sxx), n };
}

/** S − c·S_m at every point (NaN where the component is not measured). */
export function subtractComponent(
  signal: Float64Array,
  component: Float64Array,
  factor: number,
): Float64Array {
  return signal.map((v, i) => v - factor * (component[i] as number));
}

/**
 * Band gap after subtracting a scaled component spectrum: Tauc fit of (S − c·S_m)·E over the edge
 * region. The uncertainty adds, to that of the edge fit, (∂Eg/∂c · σ_c)², the derivative taken by
 * central differences with a step of a tenth of σ_c (the factor and the edge use separate points).
 */
export function componentGap(
  energyEv: Float64Array,
  signal: Float64Array,
  exponent: number,
  component: Float64Array,
  factor: ComponentFactor,
  edge: [number, number],
): BandGapFit | null {
  const gapWith = (c: number) =>
    fitBandGap(
      energyEv,
      taucValues(energyEv, subtractComponent(signal, component, c), exponent),
      edge[0],
      edge[1],
    );
  const fit = gapWith(factor.value);
  if (!fit) return null;
  if (!(factor.sigma > 0)) return fit;
  const h = factor.sigma / 10;
  const up = gapWith(factor.value + h);
  const down = gapWith(factor.value - h);
  const slope = up && down ? (up.egEv - down.egEv) / (2 * h) : NaN;
  return { ...fit, egSigma: Math.sqrt(fit.egSigma ** 2 + (slope * factor.sigma) ** 2) };
}

/** Fraction of the rise of the signal that marks the onset of the edge (my own choice). */
const ONSET_FRACTION = 0.02;

/**
 * A rough onset of the edge, for placing the first baseline window: going down in energy from
 * the highest signal, the first energy where S is within 2 % of the rise above the low-energy
 * level (the median of the lowest tenth of the energies). Null when the signal does not rise.
 */
function edgeOnset(energyEv: Float64Array, signal: Float64Array): number | null {
  const finite: number[] = [];
  for (let i = 0; i < signal.length; i++) if (Number.isFinite(signal[i])) finite.push(i);
  if (finite.length < 10) return null;
  const low = finite
    .slice(0, Math.max(3, Math.floor(finite.length / 10)))
    .map((i) => signal[i] as number)
    .sort((a, b) => a - b);
  const level = low[Math.floor(low.length / 2)] as number;
  let top = finite[0] as number;
  for (const i of finite) if ((signal[i] as number) > (signal[top] as number)) top = i;
  const threshold = level + ONSET_FRACTION * ((signal[top] as number) - level);
  if (!((signal[top] as number) > level)) return null;
  for (let i = top; i >= 0; i--) {
    if ((signal[i] as number) <= threshold) return energyEv[i] as number;
  }
  return null;
}

/** Highest Tauc value between a baseline window and the gap, as a fraction of the edge (own choice). */
const FLAT_FRACTION = 0.1;

/**
 * Checks a gap found after a correction: between the top of the baseline window and the gap the
 * corrected Tauc curve must stay below 10 % of its highest value in the edge region, as it does
 * when the gap is right. When the window has crept into a curved background or the edge, the
 * subtraction pushes the gap up past absorbing points, and this check fails. With `aboveRegion`
 * (the 'steepest' rule of stage 22) the highest value is taken from the start of the region up:
 * that rule places the region lower on the edge than the earlier rule did, and the threshold
 * should not depend on where on the edge the region lies.
 */
function flatBelowGap(
  energyEv: Float64Array,
  y: Float64Array | null,
  window: [number, number],
  region: [number, number] | null,
  egEv: number | null,
  aboveRegion: boolean,
): boolean {
  if (!y || !region || egEv === null) return false;
  let top = 0;
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    if (e >= region[0] && (aboveRegion || e <= region[1]) && (y[i] as number) > top)
      top = y[i] as number;
  }
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    if (e > window[1] && e < egEv - 0.02 && (y[i] as number) > FLAT_FRACTION * top) return false;
  }
  return true;
}

/** The region [Eg − 0.1 − 0.5, Eg − 0.1] eV below an estimate of the gap, clipped to the data. */
function baselineWindow(energyEv: Float64Array, egEv: number): [number, number] | null {
  const to = egEv - BASELINE_GAP_EV;
  const from = Math.max(to - BASELINE_WIDTH_EV, energyEv[0] as number);
  let count = 0;
  for (const e of energyEv) if (e >= from && e <= to) count++;
  return count >= 6 ? [from, to] : null;
}

export type BaselineShape = 'line' | 'power';

export interface TaucGapOptions {
  /** The method, or null for the automatic choice (`automaticGapMethod`). */
  method: GapMethod | null;
  /** Edge fit region set by the user, or null for the suggestion. */
  edgeRegion: [number, number] | null;
  /** Baseline region set by the user, or null for the suggestion. */
  baselineRegion: [number, number] | null;
  /**
   * True for sessions saved before the baseline methods existed: the edge region is then
   * suggested on the uncorrected curve, as it was, so the saved number does not change.
   */
  legacySuggestion?: boolean;
  /**
   * How edge regions are suggested: 'widest' for sessions saved before stage 22 (and always with
   * `legacySuggestion`); default 'steepest'.
   */
  regionRule?: RegionRule;
  /**
   * Shape of the sub-gap baseline of 'subtract-baseline': 'line' (default) or 'power',
   * a + c·E^m (`fitPowerBaseline`), fitted over the whole sub-gap range of the data when the
   * baseline region is suggested. Used only when `method` is 'subtract-baseline'.
   */
  baselineShape?: BaselineShape;
  /** For 'power': m given by the user (4 for Rayleigh scattering), or null to fit it in [0, 4]. */
  baselineExponent?: number | null;
  /**
   * For 'subtract-component': the second component's absorption quantity on the same energy grid
   * and in the same unit as the signal (`interpolateOnto`), and the factor c, or null to fit it
   * over the baseline region.
   */
  component?: { signal: Float64Array; factor: number | null } | null;
}

export interface TaucGap {
  /** The method used (the automatic choice resolved). */
  method: GapMethod;
  /** The Tauc curve of the uncorrected signal. */
  tauc: Float64Array;
  /** The Tauc curve after the sub-gap baseline is subtracted, when a baseline could be fitted. */
  taucCorrected: Float64Array | null;
  /** Edge region in use, and whether it is the suggestion. */
  region: [number, number] | null;
  suggested: boolean;
  /** Baseline region in use, and whether it is the suggestion. */
  baselineRegion: [number, number] | null;
  baselineSuggested: boolean;
  /** Baseline line in the signal (S against E), used by 'subtract-baseline'. */
  signalBaseline: StraightLine | null;
  /** Power-law baseline in the signal, used by 'subtract-baseline' with the 'power' shape. */
  powerBaseline: PowerBaseline | null;
  /**
   * With the 'power' shape: true when the background shape is not well determined by the data
   * below the edge (σ(Eg) > 0.05 eV, a fitted m on a bound, or a sub-gap range shorter than
   * 0.5 eV), so the band gap is uncertain (own thresholds).
   */
  baselineUncertain: boolean;
  /**
   * With the straight line in use for 'subtract-baseline': the power-law result over the whole
   * sub-gap range, offered as a suggestion when it fits that range clearly better
   * (`POWER_SUGGESTION_RATIO`) and passes `flatBelowGap`; null otherwise.
   */
  powerSuggestion: { egEv: number; m: number; rmsLine: number; rmsPower: number } | null;
  /** Baseline line on the Tauc curve, used by 'baseline-crossing'. */
  taucBaseline: StraightLine | null;
  /** The band gap of the chosen method: for a crossing, slope and intercept are the edge line. */
  fit: BandGapFit | null;
  /**
   * For warnings: the gap by the axis intercept on the uncorrected curve with its own suggested
   * region (what the analysis gave before the baseline methods), and by subtraction over the
   * region suggested on the corrected curve.
   */
  axisEgEv: number | null;
  subtractedEgEv: number | null;
  /** True when subtraction moves the gap by more than SUB_GAP_SHIFT_EV from `axisEgEv`. */
  subGapLevel: boolean;
  /** For 'subtract-component': the factor c used, and the Tauc curve of S − c·S_m. */
  componentFactor: ComponentFactor | null;
  taucComponent: Float64Array | null;
}

/** σ(Eg) above which a power-law background is reported as not well determined, eV (own choice). */
const UNCERTAIN_SIGMA_EV = 0.05;
/**
 * The power law is suggested when its root-mean-square residual over the whole sub-gap range is
 * below this fraction of that of the straight line (fitted on its own 0.5 eV window and evaluated
 * over the same range): own choice. On a straight background with noise the ratio is close to 1.
 */
const POWER_SUGGESTION_RATIO = 0.5;

/** The power-law alternative to a straight-line baseline, or null when it is not clearly better. */
function suggestPower(
  energyEv: Float64Array,
  signal: Float64Array,
  exponent: number,
  line: StraightLine,
  range: [number, number],
  rule: RegionRule,
): TaucGap['powerSuggestion'] {
  const p = fitPowerBaseline(energyEv, signal, range[0], range[1], null);
  if (!p) return null;
  let lineRss = 0;
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    const v = signal[i] as number;
    if (e >= range[0] && e <= range[1] && Number.isFinite(v))
      lineRss += (v - line.intercept - line.slope * e) ** 2;
  }
  const rmsLine = Math.sqrt(lineRss / p.n);
  const rmsPower = Math.sqrt(p.rss / p.n);
  if (!(rmsPower < POWER_SUGGESTION_RATIO * rmsLine)) return null;
  const y = taucValues(energyEv, subtractPower(energyEv, signal, p), exponent);
  const region = suggestRegion(energyEv, y, rule);
  const fit = region ? fitBandGap(energyEv, y, region[0], region[1]) : null;
  if (!fit || !flatBelowGap(energyEv, y, range, region, fit.egEv, rule === 'steepest')) return null;
  return { egEv: fit.egEv, m: p.m, rmsLine, rmsPower };
}

/**
 * The Tauc band gap of one signal by the chosen method. The baseline region, when not set, is
 * suggested as 0.5 eV ending 0.1 eV below the axis-intercept gap, then placed again below the gap
 * found after subtraction (one more pass), so it lies under the edge even when the level pulled
 * the first estimate down. When a sub-gap level is found, the edge region is suggested on the
 * corrected curve, which keeps the suggestion on the edge (the uncorrected curve is not straight
 * there); without one, the suggestion is the same as before.
 */
export function analyseTaucGap(
  energyEv: Float64Array,
  signal: Float64Array,
  exponent: number,
  options: TaucGapOptions,
): TaucGap {
  const rule = options.regionRule ?? (options.legacySuggestion ? 'widest' : 'steepest');
  const tauc = taucValues(energyEv, signal, exponent);
  const rawRegion = suggestRegion(energyEv, tauc, rule);
  const rawFit = rawRegion ? fitBandGap(energyEv, tauc, rawRegion[0], rawRegion[1]) : null;

  let baselineRegion = options.baselineRegion;
  const power = options.baselineShape === 'power' && options.method === 'subtract-baseline';
  const lowest = energyEv.find((_, i) => Number.isFinite(signal[i])) ?? (energyEv[0] as number);
  let powerBase: PowerBaseline | null = null;
  let signalBaseline: StraightLine | null = null;
  let taucCorrected: Float64Array | null = null;
  let correctedRegion: [number, number] | null = null;
  const correct = (region: [number, number]): number | null => {
    if (power) {
      // The whole sub-gap range in the data, unless the user set the region.
      const from = options.baselineRegion ? region[0] : lowest;
      powerBase = fitPowerBaseline(
        energyEv,
        signal,
        from,
        region[1],
        options.baselineExponent ?? null,
      );
      taucCorrected = powerBase
        ? taucValues(energyEv, subtractPower(energyEv, signal, powerBase), exponent)
        : null;
    } else {
      signalBaseline = fitLine(energyEv, signal, region[0], region[1]);
      taucCorrected = signalBaseline
        ? taucValues(energyEv, subtractLine(energyEv, signal, signalBaseline), exponent)
        : null;
    }
    correctedRegion = taucCorrected ? suggestRegion(energyEv, taucCorrected, rule) : null;
    const fit =
      correctedRegion && taucCorrected
        ? fitBandGap(energyEv, taucCorrected, correctedRegion[0], correctedRegion[1])
        : null;
    return fit?.egEv ?? null;
  };
  if (baselineRegion) {
    correct(baselineRegion);
  } else {
    // Start below the lower of the axis intercept and the onset, then move the window below the
    // gap found after subtraction until it stays put (at most 5 passes). A move that fails
    // `flatBelowGap` is undone and ends the search.
    const onset = edgeOnset(energyEv, signal);
    // The lower estimate first; an axis intercept far below the data (a sloping background taken
    // for the edge) leaves no room for a window, and then the onset is used.
    let estimate: number | null =
      [rawFit?.egEv ?? null, onset]
        .filter((e): e is number => e !== null && baselineWindow(energyEv, e) !== null)
        .sort((a, b) => a - b)[0] ?? null;
    for (let pass = 0; pass < 5 && estimate !== null; pass++) {
      const window = baselineWindow(energyEv, estimate);
      if (!window) break;
      if (baselineRegion && Math.abs(window[1] - baselineRegion[1]) < 0.005) break;
      const previous: [number, number] | null = baselineRegion;
      const next = correct(window);
      if (
        previous &&
        !flatBelowGap(energyEv, taucCorrected, window, correctedRegion, next, rule === 'steepest')
      ) {
        correct(previous);
        break;
      }
      baselineRegion = window;
      estimate = next;
    }
    if (baselineRegion && !signalBaseline && !powerBase) baselineRegion = null;
  }
  const base = signalBaseline as StraightLine | null;
  const powerUsed = powerBase as PowerBaseline | null;
  const corrected = taucCorrected as Float64Array | null;
  const suggestedOnEdge = correctedRegion as [number, number] | null;

  const subtractedOnEdge = !suggestedOnEdge
    ? null
    : powerUsed
      ? powerSubtractedGap(energyEv, signal, exponent, powerUsed, suggestedOnEdge)
      : base
        ? subtractedGap(energyEv, signal, exponent, base, suggestedOnEdge)
        : null;
  // Compared with what the uncorrected analysis gives (its own suggestion), or a level so large
  // that the uncorrected curve has no usable straight edge at all.
  const subGapLevel =
    subtractedOnEdge !== null &&
    (rawFit === null || Math.abs(rawFit.egEv - subtractedOnEdge.egEv) > SUB_GAP_SHIFT_EV);

  const method = options.method ?? automaticGapMethod(subGapLevel);

  let factor: ComponentFactor | null = null;
  let taucComponent: Float64Array | null = null;
  const component = options.component?.signal ?? null;
  if (method === 'subtract-component' && component) {
    const typed = options.component?.factor ?? null;
    const corrected = (f: ComponentFactor | null) =>
      f ? taucValues(energyEv, subtractComponent(signal, component, f.value), exponent) : null;
    if (typed !== null) {
      factor = { value: typed, sigma: 0, n: 0 };
    } else if (options.baselineRegion) {
      factor = componentFactor(energyEv, signal, component, options.baselineRegion);
    } else {
      // Own placement: start below the lowest estimate, fit c, find the gap of S − c·S_m, and
      // place the window again below that gap until it stays put (at most 5 passes).
      let estimate: number | null =
        [rawFit?.egEv ?? null, edgeOnset(energyEv, signal)]
          .filter((e): e is number => e !== null && baselineWindow(energyEv, e) !== null)
          .sort((a, b) => a - b)[0] ?? null;
      let window: [number, number] | null = null;
      for (let pass = 0; pass < 5 && estimate !== null; pass++) {
        const next = baselineWindow(energyEv, estimate);
        if (!next || (window && Math.abs(next[1] - window[1]) < 0.005)) break;
        const f = componentFactor(energyEv, signal, component, next);
        const y = corrected(f);
        const r = y ? suggestRegion(energyEv, y, rule) : null;
        const gap = y && r ? (fitBandGap(energyEv, y, r[0], r[1])?.egEv ?? null) : null;
        if (window && !flatBelowGap(energyEv, y, next, r, gap, rule === 'steepest')) break;
        window = next;
        factor = f;
        estimate = gap;
      }
      baselineRegion = factor ? window : baselineRegion;
    }
    taucComponent = corrected(factor);
  }

  const suggestion =
    method === 'subtract-component'
      ? taucComponent && !options.legacySuggestion
        ? suggestRegion(energyEv, taucComponent, rule)
        : null
      : options.legacySuggestion || !(subGapLevel || method !== 'axis')
        ? rawRegion
        : (suggestedOnEdge ?? rawRegion);
  const region = options.edgeRegion ?? suggestion;

  let fit: BandGapFit | null = null;
  let taucBaseline: StraightLine | null = null;
  if (region) {
    if (method === 'axis') {
      fit = fitBandGap(energyEv, tauc, region[0], region[1]);
    } else if (method === 'subtract-baseline') {
      fit = powerUsed
        ? powerSubtractedGap(energyEv, signal, exponent, powerUsed, region)
        : base
          ? subtractedGap(energyEv, signal, exponent, base, region)
          : null;
    } else if (method === 'subtract-component') {
      fit =
        component && factor
          ? componentGap(energyEv, signal, exponent, component, factor, region)
          : null;
    } else if (baselineRegion) {
      taucBaseline = fitLine(energyEv, tauc, baselineRegion[0], baselineRegion[1]);
      const edge = fitLine(energyEv, tauc, region[0], region[1]);
      const crossing =
        edge && taucBaseline && edge.slope > 0 ? lineCrossing(edge, taucBaseline) : null;
      if (edge && crossing) {
        fit = {
          egEv: crossing.egEv,
          egSigma: crossing.egSigma,
          slope: edge.slope,
          intercept: edge.intercept,
          rSquared: edge.rSquared,
          n: edge.n,
          fromEv: edge.fromEv,
          toEv: edge.toEv,
        };
      }
    }
  }
  const powerSuggestion =
    method === 'subtract-baseline' && !power && base && baselineRegion
      ? suggestPower(energyEv, signal, exponent, base, [lowest, baselineRegion[1]], rule)
      : null;
  return {
    method,
    tauc,
    taucCorrected: corrected,
    region,
    suggested: options.edgeRegion === null,
    baselineRegion:
      powerUsed && baselineRegion && !options.baselineRegion
        ? [powerUsed.fromEv, baselineRegion[1]]
        : baselineRegion,
    baselineSuggested: options.baselineRegion === null,
    signalBaseline: base,
    powerBaseline: powerUsed,
    baselineUncertain:
      powerUsed !== null &&
      (powerUsed.onBound ||
        powerUsed.toEv - powerUsed.fromEv < BASELINE_WIDTH_EV ||
        (fit !== null && fit.egSigma > UNCERTAIN_SIGMA_EV)),
    powerSuggestion,
    taucBaseline,
    fit,
    axisEgEv: rawFit?.egEv ?? null,
    subtractedEgEv: subtractedOnEdge?.egEv ?? null,
    subGapLevel,
    componentFactor: factor,
    taucComponent,
  };
}

/** The method used when the user has not chosen one: subtraction when a sub-gap level is found. */
export function automaticGapMethod(subGapLevel: boolean): GapMethod {
  return subGapLevel ? 'subtract-baseline' : 'axis';
}

export interface TransitionComparison {
  id: TransitionId;
  /** How Eg was read for this transition (the automatic choice can differ between them). */
  method: GapMethod;
  region: [number, number] | null;
  fit: BandGapFit | null;
}

/**
 * The band gap of every transition type, each over its own edge region (the user's, or the
 * suggestion) and read by the same method settings as the chosen transition, so the table
 * compares like with like.
 */
export function compareTransitions(
  energyEv: Float64Array,
  signal: Float64Array,
  regions: Partial<Record<TransitionId, [number, number] | null>>,
  options: Omit<TaucGapOptions, 'edgeRegion'>,
): TransitionComparison[] {
  return (Object.keys(TRANSITIONS) as TransitionId[]).map((id) => {
    const gap = analyseTaucGap(energyEv, signal, TRANSITIONS[id].exponent, {
      ...options,
      edgeRegion: regions[id] ?? null,
    });
    return { id, method: gap.method, region: gap.region, fit: gap.fit };
  });
}

export interface UrbachFit {
  /** Urbach energy Eu = 1/slope of ln α against E, eV. */
  euEv: number;
  euSigma: number;
  rSquared: number;
  n: number;
}

/**
 * Urbach energy from the exponential tail below the edge: α = α0 · exp(E / Eu), so
 * ln α = ln α0 + E/Eu is a straight line of slope 1/Eu. Uses the points with a positive signal
 * between the two energies; σ(Eu) = σ(slope) / slope². Returns null with fewer than 4 points or a
 * slope that is not positive. Works with α, A or F(R), since only the slope matters.
 */
export function urbachFit(
  energyEv: Float64Array,
  signal: Float64Array,
  fromEv: number,
  toEv: number,
): UrbachFit | null {
  const logSignal = signal.map((v) => (v > 0 ? Math.log(v) : NaN));
  const { xs, ys } = inWindow(energyEv, logSignal, fromEv, toEv);
  if (xs.length < 4) return null;
  const fit = linearFit(xs, ys);
  if (!fit || !(fit.slope > 0)) return null;
  return {
    euEv: 1 / fit.slope,
    euSigma: fit.slopeSigma / fit.slope ** 2,
    rSquared: fit.rSquared,
    n: xs.length,
  };
}

/**
 * Suggests the Urbach region: between 0.6 eV below the gap and the gap itself, the 0.15 eV
 * window (at least 6 points with a positive signal) whose ln α is straightest (highest R², rising
 * line). Returns null when no such window exists.
 */
export function suggestUrbachRegion(
  energyEv: Float64Array,
  signal: Float64Array,
  egEv: number,
): [number, number] | null {
  const logSignal = signal.map((v) => (v > 0 ? Math.log(v) : NaN));
  const { xs, ys } = inWindow(energyEv, logSignal, egEv - 0.6, egEv);
  let best: { from: number; to: number; r2: number } | null = null;
  let end = 0;
  for (let start = 0; start < xs.length; start++) {
    while (end < xs.length - 1 && (xs[end] as number) - (xs[start] as number) < 0.15) end++;
    if ((xs[end] as number) - (xs[start] as number) < 0.15) break;
    if (end - start + 1 < 6) continue;
    const fit = linearFit(xs.slice(start, end + 1), ys.slice(start, end + 1));
    if (!fit || !(fit.slope > 0) || !Number.isFinite(fit.rSquared)) continue;
    if (best === null || fit.rSquared > best.r2) {
      best = { from: xs[start] as number, to: xs[end] as number, r2: fit.rSquared };
    }
  }
  return best ? [best.from, best.to] : null;
}

export interface DerivativePeak {
  /** Energy of the steepest rise, eV. */
  egEv: number;
  /** The derivative there: dS/dE, or d ln S/dE in 1/eV. */
  value: number;
  /**
   * True when the maximum is at the first or last energy searched: the derivative is still
   * rising there, so the steepest part of the edge was not found in the range.
   */
  atEdge: boolean;
}

/** Half-width, in points, of the local straight-line fit that gives the derivative. */
const DERIVATIVE_HALF_WINDOW = 4;

/**
 * Derivative method: the band gap estimate is the energy where the signal S rises fastest, the
 * maximum of dS/dE ('linear') or of d ln S/dE ('log'), searched between two energies. The
 * derivative at each point is the slope of a straight line through it and its 4 neighbours on
 * each side (works for uneven energy spacing and smooths noise a little). An estimate only: it
 * marks the steepest part of the edge, which lies above Eg for real spectra. Returns null when
 * nothing is in range; atEdge flags a maximum on the boundary of the searched range.
 */
export function derivativeMaximum(
  energyEv: Float64Array,
  signal: Float64Array,
  mode: 'linear' | 'log',
  fromEv: number,
  toEv: number,
): DerivativePeak | null {
  const values = mode === 'log' ? signal.map((v) => (v > 0 ? Math.log(v) : NaN)) : signal;
  let best: Omit<DerivativePeak, 'atEdge'> | null = null;
  let first = -1;
  let last = -1;
  let bestIndex = -1;
  const n = energyEv.length;
  for (let i = DERIVATIVE_HALF_WINDOW; i < n - DERIVATIVE_HALF_WINDOW; i++) {
    const e = energyEv[i] as number;
    if (e < fromEv || e > toEv) continue;
    const from = i - DERIVATIVE_HALF_WINDOW;
    const to = i + DERIVATIVE_HALF_WINDOW + 1;
    const xs = Array.from(energyEv.slice(from, to));
    const ys = Array.from(values.slice(from, to));
    if (ys.some((v) => !Number.isFinite(v))) continue;
    const fit = linearFit(xs, ys);
    if (!fit) continue;
    if (first < 0) first = i;
    last = i;
    if (best === null || fit.slope > best.value) {
      best = { egEv: e, value: fit.slope };
      bestIndex = i;
    }
  }
  return best && { ...best, atEdge: bestIndex === first || bestIndex === last };
}
