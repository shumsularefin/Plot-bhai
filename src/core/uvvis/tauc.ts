import { linearFit } from '../math/linearFit';
import { energyFromWavelength } from './conversions';
import { toQuantity } from './process';
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
 */
export function absorptionSignal(
  wavelengthNm: Float64Array,
  values: Float64Array,
  meaning: { kind: SpectrumKind; scale: ValueScale },
  thicknessNm: number | null,
): AbsorptionSignal {
  const n = wavelengthNm.length;
  const quantity = meaning.kind === 'reflectance' ? 'kubelka-munk' : 'absorbance';
  const base = toQuantity(values, meaning, quantity) ?? new Float64Array(n).fill(NaN);
  const useThickness = quantity === 'absorbance' && thicknessNm !== null && thicknessNm > 0;
  const factor = useThickness ? Math.LN10 / ((thicknessNm as number) * 1e-7) : 1;
  const energyEv = new Float64Array(n);
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Reverse so that energy increases.
    const j = n - 1 - i;
    energyEv[i] = energyFromWavelength(wavelengthNm[j] as number);
    signal[i] = (base[j] as number) * factor;
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
 * Suggests the fitting region: the widest straight stretch of the Tauc curve. Windows of 0.1 to
 * 0.6 eV (at least 6 points) are slid along the curve. Among windows with R² ≥ 0.995, those of
 * the widest size compete and the one with the highest R² wins. Wide windows average out noise;
 * picking the steepest window instead was found to follow noise. Because the straightest window
 * is chosen, the uncertainty of its fit is somewhat too small. If no window is that straight,
 * the threshold falls to 0.98, and then to the best R². Windows lying on the flat baseline (top
 * of the window below 5 % of the highest value) are ignored. A suggestion only: the user can change the limits.
 * Returns [fromEv, toEv], or null when no window has a rising line.
 */
export function suggestRegion(energyEv: Float64Array, y: Float64Array): [number, number] | null {
  const { xs, ys } = inWindow(energyEv, y, -Infinity, Infinity);
  const top = ys.reduce((m, v) => Math.max(m, v), 0);
  const candidates: { from: number; to: number; target: number; slope: number; r2: number }[] = [];
  for (const span of SPANS) {
    let end = 0;
    for (let start = 0; start < xs.length; start++) {
      while (end < xs.length - 1 && (xs[end] as number) - (xs[start] as number) < span) end++;
      if ((xs[end] as number) - (xs[start] as number) < span) break;
      if (end - start + 1 < 6) continue;
      const wy = ys.slice(start, end + 1);
      if (Math.max(...wy) < 0.05 * top) continue;
      const fit = linearFit(xs.slice(start, end + 1), wy);
      if (!fit || !(fit.slope > 0) || !Number.isFinite(fit.rSquared)) continue;
      candidates.push({
        from: xs[start] as number,
        to: xs[end] as number,
        target: span,
        slope: fit.slope,
        r2: fit.rSquared,
      });
    }
  }
  if (candidates.length === 0) return null;
  for (const threshold of [STRAIGHT, MINIMUM_STRAIGHT]) {
    const good = candidates.filter((c) => c.r2 >= threshold);
    if (good.length > 0) {
      const widest = Math.max(...good.map((c) => c.target));
      const best = good.filter((c) => c.target === widest).reduce((a, b) => (b.r2 > a.r2 ? b : a));
      return [best.from, best.to];
    }
  }
  const best = candidates.reduce((a, b) => (b.r2 > a.r2 ? b : a));
  return [best.from, best.to];
}

export interface TransitionComparison {
  id: TransitionId;
  region: [number, number] | null;
  fit: BandGapFit | null;
}

/**
 * Fits all four transition types, each over its own suggested region unless a region is given
 * for it. For a guide only: several types can fit about equally well, and the right one must
 * come from the literature for the material.
 */
export function compareTransitions(
  energyEv: Float64Array,
  signal: Float64Array,
  regions: Partial<Record<TransitionId, [number, number] | null>>,
): TransitionComparison[] {
  return (Object.keys(TRANSITIONS) as TransitionId[]).map((id) => {
    const y = taucValues(energyEv, signal, TRANSITIONS[id].exponent);
    const region = regions[id] ?? suggestRegion(energyEv, y);
    return { id, region, fit: region ? fitBandGap(energyEv, y, region[0], region[1]) : null };
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
