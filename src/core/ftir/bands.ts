import { savitzkyGolayDerivative } from '../xrd/process/savitzkyGolay';
import { fitRegion, type RegionFit } from '../xrd/peaks/fit';
import type { ProfileKind } from '../xrd/peaks/profiles';
import { lowerBoundIndex } from '../xrd/peaks/search';
import { pickPeaks } from './peaks';
import { stepSpread } from './process';

/*
 * Band analysis of an FTIR absorbance spectrum: second derivative, band fitting over a region,
 * integrated band areas and ratios, and spectrum subtraction. Wavenumbers in cm⁻¹ (increasing),
 * absorbance in the spectrum's own unit (dimensionless for absorbance proper).
 */

/** Steps may differ by at most this fraction of the median step for a derivative. */
const EVEN_SPACING = 0.01;

/**
 * Second derivative d²A/dν̃² by the Savitzky–Golay method (window points, polynomial order),
 * in absorbance per (cm⁻¹)². Bands, and shoulders hidden under them, show as minima. Null when
 * the points are not evenly spaced (within 1 % of the median step) or the window does not fit.
 */
export function secondDerivative(
  x: Float64Array,
  a: Float64Array,
  window: number,
  order: number,
): Float64Array | null {
  if (x.length < window || stepSpread(x) > EVEN_SPACING) return null;
  const step = ((x[x.length - 1] as number) - (x[0] as number)) / (x.length - 1);
  return savitzkyGolayDerivative(a, window, order, 2, step);
}

/** A band found in the second derivative. */
export interface DerivativeBand {
  /** Position of the minimum (parabola vertex), cm⁻¹. */
  wavenumber: number;
  /** d²A/dν̃² at the minimum (negative), absorbance per (cm⁻¹)². */
  value: number;
}

/**
 * Minima of the second derivative that lie below zero and are at least minDepthPercent of the
 * deepest minimum deep (as prominence of −d²A/dν̃²). Optional range in cm⁻¹. Increasing wavenumber.
 */
export function derivativeBands(
  x: Float64Array,
  d2: Float64Array,
  minDepthPercent: number,
  fromCm?: number,
  toCm?: number,
): DerivativeBand[] {
  const flipped = d2.map((v) => -v);
  let deepest = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    if ((fromCm === undefined || xi >= fromCm) && (toCm === undefined || xi <= toCm))
      deepest = Math.max(deepest, flipped[i] as number);
  }
  if (!(deepest > 0)) return [];
  return pickPeaks(x, flipped, {
    minProminence: (deepest * minDepthPercent) / 100,
    ...(fromCm !== undefined && { fromCm }),
    ...(toCm !== undefined && { toCm }),
  })
    .filter((p) => p.height > 0)
    .map((p) => ({ wavenumber: p.wavenumber, value: -p.height }));
}

/** Linear interpolation of y at xi on increasing x; NaN outside the data. */
export function interpolate(x: Float64Array, y: Float64Array, xi: number): number {
  const n = x.length;
  if (n === 0 || xi < (x[0] as number) || xi > (x[n - 1] as number)) return NaN;
  const j = Math.min(n - 1, Math.max(1, lowerBoundIndex(x, xi)));
  const x0 = x[j - 1] as number;
  const x1 = x[j] as number;
  if (xi === x1) return y[j] as number;
  return (y[j - 1] as number) + (((y[j] as number) - (y[j - 1] as number)) * (xi - x0)) / (x1 - x0);
}

/** An integrated band area. */
export interface BandArea {
  fromCm: number;
  toCm: number;
  /**
   * ∫ (A − b) dν̃ by the trapezoid rule, with b the straight line joining the spectrum at the
   * two range ends (a local baseline), in absorbance × cm⁻¹. The range ends are interpolated.
   */
  area: number;
  /** Wavenumber of the highest point above that line, cm⁻¹. */
  peakCm: number;
  /** Height of that point above the line. */
  height: number;
}

/** Band area over [fromCm, toCm] (either order) above the straight line between its ends; null outside the data. */
export function bandArea(
  x: Float64Array,
  a: Float64Array,
  fromCm: number,
  toCm: number,
): BandArea | null {
  const lo = Math.min(fromCm, toCm);
  const hi = Math.max(fromCm, toCm);
  const yLo = interpolate(x, a, lo);
  const yHi = interpolate(x, a, hi);
  if (!(hi > lo) || !Number.isFinite(yLo) || !Number.isFinite(yHi)) return null;
  const line = (v: number) => yLo + ((yHi - yLo) * (v - lo)) / (hi - lo);
  const xs = [lo];
  const ys = [0];
  for (let i = lowerBoundIndex(x, lo); i < x.length && (x[i] as number) < hi; i++) {
    const xi = x[i] as number;
    if (xi <= lo) continue;
    xs.push(xi);
    ys.push((a[i] as number) - line(xi));
  }
  xs.push(hi);
  ys.push(0);
  let area = 0;
  let peakCm = lo;
  let height = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (i > 0)
      area +=
        (((xs[i] as number) - (xs[i - 1] as number)) *
          ((ys[i] as number) + (ys[i - 1] as number))) /
        2;
    if ((ys[i] as number) > height) {
      height = ys[i] as number;
      peakCm = xs[i] as number;
    }
  }
  return { fromCm: lo, toCm: hi, area, peakCm, height };
}

/**
 * Difference spectrum A_diff(ν̃) = A_sample(ν̃) − k · A_reference(ν̃) on the sample's wavenumbers,
 * with the reference interpolated linearly. Only the wavenumbers both spectra cover are kept.
 */
export function subtractSpectrum(
  sampleX: Float64Array,
  sampleA: Float64Array,
  referenceX: Float64Array,
  referenceA: Float64Array,
  factor: number,
): { wavenumber: Float64Array; absorbance: Float64Array } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < sampleX.length; i++) {
    const r = interpolate(referenceX, referenceA, sampleX[i] as number);
    const s = sampleA[i] as number;
    if (!Number.isFinite(r) || !Number.isFinite(s)) continue;
    xs.push(sampleX[i] as number);
    ys.push(s - factor * r);
  }
  return { wavenumber: Float64Array.from(xs), absorbance: Float64Array.from(ys) };
}

/**
 * Scale factor k that removes the reference best over [fromCm, toCm]: the least-squares
 * solution of min Σ (A_sample − k · A_reference)², k = Σ A_s·A_r / Σ A_r². Choose a range where
 * only the reference absorbs (for example a band of the solvent, matrix or water vapour), so
 * the difference there should be zero. Null when the range holds no reference absorbance.
 */
export function subtractionFactor(
  sampleX: Float64Array,
  sampleA: Float64Array,
  referenceX: Float64Array,
  referenceA: Float64Array,
  fromCm: number,
  toCm: number,
): number | null {
  const lo = Math.min(fromCm, toCm);
  const hi = Math.max(fromCm, toCm);
  let sr = 0;
  let rr = 0;
  for (let i = 0; i < sampleX.length; i++) {
    const xi = sampleX[i] as number;
    if (xi < lo || xi > hi) continue;
    const r = interpolate(referenceX, referenceA, xi);
    const s = sampleA[i] as number;
    if (!Number.isFinite(r) || !Number.isFinite(s)) continue;
    sr += s * r;
    rr += r * r;
  }
  return rr > 0 ? sr / rr : null;
}

/**
 * Rough FWHM of the band at `centre` inside [fromCm, toCm]: the distance between the two points
 * where the spectrum falls to halfway between the band's value and the lowest value of the
 * range, kept between two data steps and half the range. Used only as a starting value.
 */
export function estimateFwhm(
  x: Float64Array,
  a: Float64Array,
  centre: number,
  fromCm: number,
  toCm: number,
): number {
  const i0 = lowerBoundIndex(x, fromCm);
  const i1 = Math.min(x.length, lowerBoundIndex(x, toCm + 1e-12));
  const span = toCm - fromCm;
  const step = i1 - i0 > 1 ? span / (i1 - i0 - 1) : span;
  let base = Infinity;
  for (let i = i0; i < i1; i++) base = Math.min(base, a[i] as number);
  const c = Math.min(i1 - 1, Math.max(i0, lowerBoundIndex(x, centre)));
  const level = ((a[c] as number) + base) / 2;
  let l = c;
  while (l > i0 && (a[l] as number) > level) l--;
  let r = c;
  while (r < i1 - 1 && (a[r] as number) > level) r++;
  const width = (x[r] as number) - (x[l] as number);
  return Math.min(Math.max(width, 2 * step), span / 2);
}

export interface BandFitOptions {
  fromCm: number;
  toCm: number;
  /** Starting band positions, cm⁻¹. */
  centres: readonly number[];
  profile: ProfileKind;
}

/**
 * Fits the bands of one region: the sum of the chosen profiles (Gaussian, Lorentzian or
 * pseudo-Voigt, see xrd/peaks/profiles.ts; same equations with x in cm⁻¹) plus a straight
 * background, by bounded Levenberg–Marquardt (fitRegion). Starting widths from estimateFwhm, at
 * most the distance to the nearest other band.
 * Areas are in absorbance × cm⁻¹.
 */
export function fitBands(x: Float64Array, a: Float64Array, options: BandFitOptions): RegionFit {
  return fitBandRegion(
    x,
    a,
    options.fromCm,
    options.toCm,
    options.centres,
    options.profile,
    ' cm⁻¹',
  );
}

/**
 * The region fit behind fitBands for any increasing x axis (unit is used in the messages):
 * bands at the given starting centres between from and to, each starting no wider than the
 * distance to its nearest neighbour, because overlapping bands merge into one broad half-height
 * width.
 */
export function fitBandRegion(
  x: Float64Array,
  y: Float64Array,
  from: number,
  to: number,
  starts: readonly number[],
  profile: ProfileKind,
  unit: string,
): RegionFit {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const centres = starts.filter((c) => c >= lo && c <= hi);
  const peaks = centres.map((center) => {
    const gap = Math.min(
      ...centres.filter((c) => c !== center).map((c) => Math.abs(c - center)),
      Infinity,
    );
    return { center, width: Math.min(estimateFwhm(x, y, center, lo, hi), gap) };
  });
  return fitRegion(x, y, { start: lo, end: hi, peaks }, { profile, fixedEta: null, unit });
}
