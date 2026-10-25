import { pickPeaks } from '../ftir/peaks';
import { linearFit } from '../math/linearFit';
import { formatNumber } from '../xrd/parsers/numbers';
import { localPolynomial } from './smooth';

/*
 * DSC analysis. Everything here works on an exo-positive heat flow `exo` (exothermic = positive,
 * endothermic = negative), in W/g when the run is normalised by mass and in mW otherwise, against
 * temperature in °C that increases. For a cooling ramp the arrays are reversed (see `cleanDsc`)
 * and `cooling` is true, which only changes which side of a peak is called the onset.
 *
 * Reported enthalpies use the thermodynamic sign: ΔH > 0 means heat was absorbed (endothermic),
 * ΔH < 0 means heat was released (exothermic).
 */

export type BaselineKind = 'linear' | 'sigmoidal' | 'spline';

export const BASELINE_LABELS: Record<BaselineKind, string> = {
  linear: 'Linear',
  sigmoidal: 'Sigmoidal (step)',
  spline: 'Spline (cubic)',
};

/** The temperature limits of one event, and the baseline drawn between them. */
export interface DscEventLimit {
  id: number;
  fromC: number;
  toC: number;
  baseline: BaselineKind;
}

/** A line value and slope at one end of an event, from a straight-line fit to a few points. */
interface Edge {
  value: number;
  slope: number;
}

/** Points used for each end of the baseline: 10 % of the event, at least 3 and at most 10. */
const edgePoints = (count: number) => Math.max(3, Math.min(10, Math.floor(count / 10)));

function edgeOf(T: Float64Array, y: Float64Array, start: number, end: number, at: number): Edge {
  const x: number[] = [];
  const v: number[] = [];
  for (let i = start; i <= end; i++) {
    x.push(T[i] as number);
    v.push(y[i] as number);
  }
  const fit = linearFit(x, v);
  if (!fit) return { value: y[at] as number, slope: 0 };
  return { value: fit.intercept + fit.slope * (T[at] as number), slope: fit.slope };
}

/**
 * Baseline under an event between rows i0 and i1 (inclusive), as values at T[i0..i1].
 * The ends are anchored on straight-line fits to the first and last few points (value and slope at
 * the limits), so a little noise at a limit does not tilt the baseline.
 *  - linear: the straight line between the two end values.
 *  - sigmoidal: P(T)(1 − f(T)) + Q(T) f(T), where P and Q are the lines through the left and right
 *    end with their own slopes, and f(T) is the share of the area (between the curve and the
 *    baseline) that lies at lower temperature than T. f is found by iteration starting from the
 *    linear baseline (6 passes). The baseline therefore changes step-like across the peak, which
 *    is what a change of heat capacity across a transition looks like.
 *  - spline: the cubic through both end values with both end slopes (a Hermite cubic).
 */
export function eventBaseline(
  T: Float64Array,
  y: Float64Array,
  i0: number,
  i1: number,
  kind: BaselineKind,
): Float64Array {
  const count = i1 - i0 + 1;
  const m = edgePoints(count);
  const left = edgeOf(T, y, i0, i0 + m - 1, i0);
  const right = edgeOf(T, y, i1 - m + 1, i1, i1);
  const t0 = T[i0] as number;
  const t1 = T[i1] as number;
  const out = new Float64Array(count);
  const span = t1 - t0;
  const chord = (t: number) => left.value + ((right.value - left.value) * (t - t0)) / span;
  if (kind === 'linear' || !(span > 0)) {
    for (let k = 0; k < count; k++) out[k] = chord(T[i0 + k] as number);
    return out;
  }
  if (kind === 'spline') {
    for (let k = 0; k < count; k++) {
      const t = T[i0 + k] as number;
      const u = (t - t0) / span;
      const u2 = u * u;
      const u3 = u2 * u;
      out[k] =
        (2 * u3 - 3 * u2 + 1) * left.value +
        (u3 - 2 * u2 + u) * span * left.slope +
        (-2 * u3 + 3 * u2) * right.value +
        (u3 - u2) * span * right.slope;
    }
    return out;
  }
  // sigmoidal
  const pre = (t: number) => left.value + left.slope * (t - t0);
  const post = (t: number) => right.value + right.slope * (t - t1);
  for (let k = 0; k < count; k++) out[k] = chord(T[i0 + k] as number);
  for (let pass = 0; pass < 6; pass++) {
    const f = new Float64Array(count);
    let total = 0;
    for (let k = 1; k < count; k++) {
      const dt = (T[i0 + k] as number) - (T[i0 + k - 1] as number);
      const a = (y[i0 + k - 1] as number) - (out[k - 1] as number);
      const b = (y[i0 + k] as number) - (out[k] as number);
      total += (dt * (a + b)) / 2;
      f[k] = total;
    }
    if (!(Math.abs(total) > 0)) break;
    for (let k = 0; k < count; k++) {
      const share = Math.min(1, Math.max(0, (f[k] as number) / total));
      const t = T[i0 + k] as number;
      out[k] = pre(t) * (1 - share) + post(t) * share;
    }
  }
  return out;
}

/** What is needed to turn an event's area into an enthalpy. */
export interface EventContext {
  /** Scan rate in K/min, or null when unknown (then there is no enthalpy). */
  rateKPerMin: number | null;
  /** True when the heat flow is in W/g. */
  specific: boolean;
  /** True for a cooling ramp. */
  cooling: boolean;
  /** Molar mass in g/mol for J/mol, or null. */
  molarMassGPerMol: number | null;
}

export interface DscEvent {
  id: number;
  baseline: BaselineKind;
  fromC: number;
  toC: number;
  /** "endo" when the largest excursion from the baseline is endothermic. */
  direction: 'endo' | 'exo';
  /** Temperature of the largest excursion from the baseline, °C. */
  peakC: number;
  /** Extrapolated onset (first flank reached in the scan) and endset, °C; NaN when no steep flank exists. */
  onsetC: number;
  endsetC: number;
  /** Height of the peak above the baseline, magnitude, in W/g or mW. */
  height: number;
  /** ΔH of the event, endothermic positive. J/g when specific, else mJ. Null without a scan rate. */
  enthalpy: number | null;
  enthalpyUnit: 'J/g' | 'mJ';
  /** ΔH in kJ/mol when a molar mass was entered and the enthalpy is in J/g. */
  enthalpyKJPerMol: number | null;
  /** Baseline values at the data points of the event, for drawing. */
  curve: { temperatureC: Float64Array; baseline: Float64Array };
}

/**
 * Numbers for one event between its limits.
 * With d(T) = heat flow − baseline (exo-positive) and β the scan rate in K/s:
 *   area = ∫ d dT (trapezoid rule),  ΔH = −area / β  (J/g when the heat flow is in W/g),
 * because heat flow × time = energy and dt = dT / β. ΔH is positive for an endotherm.
 * The peak is where |d| is largest. Onset and endset are extrapolated tangents: with z = ±d so
 * the peak is positive, the steepest slope s of z on the flank before the peak (at T_s, value
 * z_s) gives T_onset = T_s − z_s / s (the tangent meets the baseline); the steepest falling flank
 * after the peak gives the endset in the same way. On a cooling ramp the flank at the higher
 * temperature is passed first, so it is the onset.
 */
export function analyseEvent(
  T: Float64Array,
  exo: Float64Array,
  limit: DscEventLimit,
  context: EventContext,
): DscEvent | null {
  const lo = Math.min(limit.fromC, limit.toC);
  const hi = Math.max(limit.fromC, limit.toC);
  let i0 = T.findIndex((t) => t >= lo);
  let i1 = -1;
  for (let i = T.length - 1; i >= 0; i--) {
    if ((T[i] as number) <= hi) {
      i1 = i;
      break;
    }
  }
  if (i0 === -1) i0 = T.length;
  if (i1 - i0 < 6) return null;
  const count = i1 - i0 + 1;
  const base = eventBaseline(T, exo, i0, i1, limit.baseline);
  const Tw = T.subarray(i0, i1 + 1);
  const d = Float64Array.from(base, (b, k) => (exo[i0 + k] as number) - b);

  let p = 0;
  for (let k = 1; k < count; k++) if (Math.abs(d[k] as number) > Math.abs(d[p] as number)) p = k;
  const exothermic = (d[p] as number) >= 0;
  const z = exothermic ? d : d.map((v) => -v);
  const half = Math.max(2, Math.floor(count / 40));
  const slope = localPolynomial(Tw, z, half, 3).slope;
  let rise = 0;
  for (let k = 0; k <= p; k++) if ((slope[k] as number) > (slope[rise] as number)) rise = k;
  let fall = p;
  for (let k = p; k < count; k++) if ((slope[k] as number) < (slope[fall] as number)) fall = k;
  const tangent = (k: number) => (Tw[k] as number) - (z[k] as number) / (slope[k] as number);
  const lowSide = (slope[rise] as number) > 0 ? tangent(rise) : NaN;
  const highSide = (slope[fall] as number) < 0 ? tangent(fall) : NaN;

  let area = 0;
  for (let k = 1; k < count; k++) {
    area +=
      (((Tw[k] as number) - (Tw[k - 1] as number)) * ((d[k] as number) + (d[k - 1] as number))) / 2;
  }
  const rate = context.rateKPerMin;
  const enthalpy = rate !== null && rate > 0 ? (-area * 60) / rate : null;
  return {
    id: limit.id,
    baseline: limit.baseline,
    fromC: lo,
    toC: hi,
    direction: exothermic ? 'exo' : 'endo',
    peakC: Tw[p] as number,
    onsetC: context.cooling ? highSide : lowSide,
    endsetC: context.cooling ? lowSide : highSide,
    height: Math.abs(d[p] as number),
    enthalpy,
    enthalpyUnit: context.specific ? 'J/g' : 'mJ',
    enthalpyKJPerMol:
      enthalpy !== null && context.specific && context.molarMassGPerMol
        ? (enthalpy * context.molarMassGPerMol) / 1000
        : null,
    curve: { temperatureC: Float64Array.from(Tw), baseline: base },
  };
}

export interface DetectDscOptions {
  /** Smallest peak prominence, in % of the heat flow range of the curve. */
  prominencePercent: number;
  /** Of two peaks closer than this (°C) only the more prominent is kept. */
  minSeparationC: number;
}

export const DEFAULT_DETECT_DSC: DetectDscOptions = { prominencePercent: 15, minSeparationC: 15 };

function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** An event limit is where the slope of the curve has fallen to this share of the steepest slope of the flank. */
const SLOPE_FRACTION = 0.02;
/** …and never below this many times the noise of the slope (robust, from the median absolute deviation). */
const NOISE_FACTOR = 3;

/**
 * Finds endothermic and exothermic peaks as local extrema of the heat flow whose prominence is at
 * least `prominencePercent` of the range of the curve. Each peak gets limits on both sides at
 * the point where the slope of the curve (local quadratic fit) has fallen to 2 % of the steepest
 * slope on that flank, or to 3 times the noise of the slope if that is larger, so a peak ends where the curve flattens out, also when a step in the
 * baseline lies beyond it. The search never goes beyond the middle between two peaks or the ends
 * of the data. Limits and baselines are only a first guess: they are adjustable. Events are
 * numbered by temperature.
 */
export function detectEvents(
  T: Float64Array,
  exo: Float64Array,
  options: DetectDscOptions,
  baseline: BaselineKind,
): DscEventLimit[] {
  const n = T.length;
  if (n < 10) return [];
  let top = -Infinity;
  let bottom = Infinity;
  for (const v of exo) {
    top = Math.max(top, v);
    bottom = Math.min(bottom, v);
  }
  const minProminence = (options.prominencePercent / 100) * (top - bottom);
  if (!(minProminence > 0)) return [];
  const nearest = (t: number) => {
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs((T[i] as number) - t) < Math.abs((T[best] as number) - t)) best = i;
    }
    return best;
  };
  // The ridge between two neighbouring peaks of the opposite sign is not an event of its own:
  // a peak has to rise at least half the minimum prominence beyond the typical level of the curve.
  const level = median(exo);
  const found = [
    ...pickPeaks(T, exo, { minProminence }).map((p) => ({ ...p, sign: 1 })),
    ...pickPeaks(
      T,
      exo.map((v) => -v),
      { minProminence },
    ).map((p) => ({ ...p, sign: -1 })),
  ]
    .filter((p) => p.height - p.sign * level >= 0.5 * minProminence)
    .sort((a, b) => b.prominence - a.prominence);
  const kept: typeof found = [];
  for (const peak of found) {
    if (kept.every((k) => Math.abs(k.wavenumber - peak.wavenumber) >= options.minSeparationC)) {
      kept.push(peak);
    }
  }
  kept.sort((a, b) => a.wavenumber - b.wavenumber);
  const centres = kept.map((p) => nearest(p.wavenumber));
  const rawSlope = localPolynomial(T, exo, Math.max(2, Math.floor(n / 100)), 2).slope;
  const middle = median(rawSlope);
  // Slope relative to the typical (baseline) slope, and the noise of the slope.
  const slope = rawSlope.map((v) => v - middle);
  const slopeNoise = 1.4826 * median(slope.map(Math.abs));

  /** Row where the peak at `c` ends when walking in direction `step` (−1 left, +1 right) up to `bound`. */
  const walk = (c: number, sign: number, step: -1 | 1, bound: number) => {
    const z = (i: number) => sign * (exo[i] as number);
    let lowest = z(c);
    for (let i = c; i !== bound + step; i += step) lowest = Math.min(lowest, z(i));
    const halfLevel = lowest + 0.5 * (z(c) - lowest);
    let steepest = 0;
    let i = c;
    while (i !== bound && z(i) > halfLevel) {
      i += step;
      steepest = Math.max(steepest, Math.abs(slope[i] as number));
    }
    // The flank is steepest somewhere before the half-height point; look a little beyond it too.
    for (let j = c; j !== i + step && j >= 0 && j < n; j += step) {
      steepest = Math.max(steepest, Math.abs(slope[j] as number));
    }
    const floor = Math.max(SLOPE_FRACTION * steepest, NOISE_FACTOR * slopeNoise);
    while (i !== bound && Math.abs(slope[i] as number) > floor) i += step;
    return i;
  };
  return centres.map((c, k) => {
    const sign = (kept[k] as (typeof kept)[number]).sign;
    const leftBound = k > 0 ? Math.round((c + (centres[k - 1] as number)) / 2) : 0;
    const rightBound =
      k < centres.length - 1 ? Math.round((c + (centres[k + 1] as number)) / 2) : n - 1;
    return {
      id: k + 1,
      fromC: T[walk(c, sign, -1, leftBound)] as number,
      toC: T[walk(c, sign, 1, rightBound)] as number,
      baseline,
    };
  });
}

/** Temperature windows (°C) where the straight lines before and after a glass transition are fitted. */
export interface GlassWindows {
  preFromC: number;
  preToC: number;
  postFromC: number;
  postToC: number;
}

export interface GlassTransition {
  /** Half-height (midpoint) Tg: where the curve is halfway between the two lines, °C. */
  midpointC: number;
  /** Extrapolated onset and endset: the tangent at the steepest point meets the pre and post lines. */
  onsetC: number;
  endsetC: number;
  /** Temperature of the steepest point (inflection), °C. */
  inflectionC: number;
  /** Step height at the midpoint: post line minus pre line, in endothermic-positive heat flow (W/g or mW). */
  stepHeight: number;
  /** Heat capacity change in J/(g·K), or null when the heat flow is not in W/g or the rate is unknown. */
  deltaCp: number | null;
  pre: { intercept: number; slope: number };
  post: { intercept: number; slope: number };
  windows: GlassWindows;
  notes: string[];
}

export type GlassResult = { ok: true; glass: GlassTransition } | { ok: false; error: string };

/**
 * Glass transition by the half-height method.
 * The heat flow into the sample is e = −exo (endothermic positive). Straight lines are fitted to
 * e in the pre- and post-transition windows (ordinary least squares) and extrapolated.
 *  - Tg (midpoint): where e(T) = (pre(T) + post(T)) / 2, the first crossing between the windows.
 *  - Step height: Δe = post(Tg) − pre(Tg).
 *  - Heat capacity change: during a scan e = C_p · β, so ΔC_p = Δe / β with β the scan rate in
 *    K/s (negative on cooling). Units: Δe in W/g gives J/(g·K).
 *  - Onset and endset: the tangent at the steepest point of e between the windows meets the pre
 *    line (onset) and the post line (endset); on a cooling ramp the two are swapped.
 */
export function analyseGlassTransition(
  T: Float64Array,
  exo: Float64Array,
  windows: GlassWindows,
  context: Pick<EventContext, 'rateKPerMin' | 'specific' | 'cooling'>,
): GlassResult {
  const n = T.length;
  const e = exo.map((v) => -v);
  const inRange = (from: number, to: number) => {
    const x: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = T[i] as number;
      if (t >= Math.min(from, to) && t <= Math.max(from, to)) {
        x.push(t);
        v.push(e[i] as number);
      }
    }
    return { x, v };
  };
  const preData = inRange(windows.preFromC, windows.preToC);
  const postData = inRange(windows.postFromC, windows.postToC);
  const pre = linearFit(preData.x, preData.v);
  const post = linearFit(postData.x, postData.v);
  if (preData.x.length < 3 || postData.x.length < 3 || !pre || !post) {
    return {
      ok: false,
      error: 'Each line needs at least 3 data points in its window. Widen the windows.',
    };
  }
  const start = Math.max(windows.preToC, windows.preFromC);
  const end = Math.min(windows.postFromC, windows.postToC);
  const region: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = T[i] as number;
    if (t >= start && t <= end) region.push(i);
  }
  if (region.length < 5) {
    return {
      ok: false,
      error: 'The transition lies between the two windows and needs at least 5 points there.',
    };
  }
  const line = (f: { intercept: number; slope: number }, t: number) => f.intercept + f.slope * t;
  const gap = (i: number) =>
    (e[i] as number) - (line(pre, T[i] as number) + line(post, T[i] as number)) / 2;
  let midpoint = NaN;
  for (let k = 1; k < region.length; k++) {
    const a = gap(region[k - 1] as number);
    const b = gap(region[k] as number);
    if (a === 0) {
      midpoint = T[region[k - 1] as number] as number;
      break;
    }
    if (a * b < 0) {
      const ta = T[region[k - 1] as number] as number;
      const tb = T[region[k] as number] as number;
      midpoint = ta + (a / (a - b)) * (tb - ta);
      break;
    }
  }
  if (!Number.isFinite(midpoint)) {
    return {
      ok: false,
      error:
        'The curve never crosses halfway between the two lines, so there is no step here. Move the windows to either side of the step.',
    };
  }
  const Tr = Float64Array.from(region, (i) => T[i] as number);
  const er = Float64Array.from(region, (i) => e[i] as number);
  const slope = localPolynomial(Tr, er, Math.max(3, Math.floor(region.length / 40)), 3).slope;
  let steep = 0;
  for (let k = 1; k < region.length; k++) {
    if (Math.abs(slope[k] as number) > Math.abs(slope[steep] as number)) steep = k;
  }
  const ti = Tr[steep] as number;
  const ei = er[steep] as number;
  const m = slope[steep] as number;
  const meet = (f: { intercept: number; slope: number }) =>
    (f.intercept - ei + m * ti) / (m - f.slope);
  const onset = meet(pre);
  const endset = meet(post);
  const stepHeight = line(post, midpoint) - line(pre, midpoint);
  const rate = context.rateKPerMin;
  const deltaCp =
    context.specific && rate !== null && rate > 0
      ? (stepHeight * 60) / (context.cooling ? -rate : rate)
      : null;
  const notes: string[] = [];
  if (deltaCp !== null && deltaCp < 0) {
    notes.push(
      `The heat capacity change is negative (${formatNumber(deltaCp, 3)} J/(g·K)). A glass transition normally raises the heat capacity when heating, so check the exo up / exo down choice and the windows.`,
    );
  }
  return {
    ok: true,
    glass: {
      midpointC: midpoint,
      onsetC: context.cooling ? endset : onset,
      endsetC: context.cooling ? onset : endset,
      inflectionC: ti,
      stepHeight,
      deltaCp,
      pre: { intercept: pre.intercept, slope: pre.slope },
      post: { intercept: post.intercept, slope: post.slope },
      windows,
      notes,
    },
  };
}

/**
 * First guess for the pre and post windows. Looks for the steepest slope of e (outside the
 * `exclude` ranges, for example detected melting peaks, and inside the optional search range),
 * takes the stretch around it where the slope stays above 20 % of that maximum as the
 * transition, and puts a window of 10 % of the curve's temperature range on each side, clipped
 * to the data and to the excluded ranges. Returns null if no step-like region is found.
 */
export function defaultGlassWindows(
  T: Float64Array,
  exo: Float64Array,
  exclude: readonly (readonly [number, number])[],
  search: readonly [number | null, number | null] = [null, null],
): GlassWindows | null {
  const n = T.length;
  if (n < 30) return null;
  const e = exo.map((v) => -v);
  const slope = localPolynomial(T, e, Math.max(2, Math.floor(n / 100)), 2).slope;
  const margin = Math.floor(n * 0.03);
  const allowed = (i: number) => {
    const t = T[i] as number;
    if (i < margin || i >= n - margin) return false;
    if (search[0] !== null && t < search[0]) return false;
    if (search[1] !== null && t > search[1]) return false;
    return !exclude.some(([a, b]) => t >= a && t <= b);
  };
  let top = -1;
  for (let i = 0; i < n; i++) {
    if (allowed(i) && (top === -1 || Math.abs(slope[i] as number) > Math.abs(slope[top] as number)))
      top = i;
  }
  if (top === -1 || !(Math.abs(slope[top] as number) > 0)) return null;
  const threshold = 0.2 * Math.abs(slope[top] as number);
  let lo = top;
  while (lo > 0 && allowed(lo - 1) && Math.abs(slope[lo - 1] as number) >= threshold) lo--;
  let hi = top;
  while (hi < n - 1 && allowed(hi + 1) && Math.abs(slope[hi + 1] as number) >= threshold) hi++;
  const first = T[0] as number;
  const last = T[n - 1] as number;
  const width = 0.1 * (last - first);
  const spacing = (last - first) / (n - 1);
  const gapC = 2 * spacing;
  let preFromC = Math.max(first, (T[lo] as number) - width);
  const preToC = (T[lo] as number) - gapC;
  const postFromC = (T[hi] as number) + gapC;
  let postToC = Math.min(last, (T[hi] as number) + width);
  for (const [a, b] of exclude) {
    if (b < (T[lo] as number)) preFromC = Math.max(preFromC, b);
    if (a > (T[hi] as number)) postToC = Math.min(postToC, a);
  }
  const count = (from: number, to: number) =>
    T.reduce((c, t) => (t >= from && t <= to ? c + 1 : c), 0);
  if (count(preFromC, preToC) < 4 || count(postFromC, postToC) < 4) return null;
  return { preFromC, preToC, postFromC, postToC };
}

export interface CrystallinityInput {
  /** Melting enthalpy ΔHm, J/g of sample. */
  meltingJPerG: number;
  /** Cold crystallisation enthalpy ΔHcc as a positive number, J/g of sample (0 if none). */
  coldJPerG: number;
  /** Mass fraction w of the polymer in the sample (1 for a pure polymer). */
  weightFraction: number;
  /** ΔH0, melting enthalpy of the 100 % crystalline polymer, J/g. Entered by the user. */
  fullyCrystallineJPerG: number;
}

export type CrystallinityResult =
  { ok: true; percent: number; notes: string[] } | { ok: false; error: string };

/**
 * Degree of crystallinity of a polymer:
 *   Xc = (ΔHm − ΔHcc) / (w · ΔH0) · 100   [%]
 * with ΔHm the melting enthalpy, ΔHcc the cold crystallisation enthalpy (both J/g of sample, as
 * positive numbers), w the polymer mass fraction, and ΔH0 the melting enthalpy of the fully
 * crystalline polymer (J/g). The site holds no ΔH0 values; the user enters one from a source.
 */
export function crystallinity(input: CrystallinityInput): CrystallinityResult {
  const { meltingJPerG, coldJPerG, weightFraction, fullyCrystallineJPerG } = input;
  if (!(fullyCrystallineJPerG > 0)) {
    return {
      ok: false,
      error:
        'Enter ΔH0, the melting enthalpy of the fully crystalline polymer (J/g), from a source you can cite.',
    };
  }
  if (!(weightFraction > 0 && weightFraction <= 1)) {
    return { ok: false, error: 'The polymer weight fraction must be above 0 and at most 1.' };
  }
  const percent = ((meltingJPerG - coldJPerG) / (weightFraction * fullyCrystallineJPerG)) * 100;
  const notes: string[] = [];
  if (percent < 0) {
    notes.push(
      'The result is negative: the cold crystallisation enthalpy is larger than the melting enthalpy. Check which events are selected.',
    );
  } else if (percent > 100) {
    notes.push(
      'The result is above 100 %. Check the events selected, the weight fraction and ΔH0.',
    );
  }
  return { ok: true, percent, notes };
}
