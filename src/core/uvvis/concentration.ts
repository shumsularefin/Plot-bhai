import { linearFit, originFit, type LinearFit } from '../math/linearFit';

/**
 * Absorbance of a spectrum at one wavelength (nm): the mean of the points within ± halfWidthNm,
 * or, with a half width of 0 or no point inside it, linear interpolation between the two
 * neighbouring points. Null outside the measured range or where no finite value exists.
 */
export function absorbanceAt(
  wavelengthNm: Float64Array,
  absorbance: Float64Array,
  atNm: number,
  halfWidthNm = 0,
): number | null {
  const n = wavelengthNm.length;
  if (n === 0 || atNm < (wavelengthNm[0] as number) || atNm > (wavelengthNm[n - 1] as number))
    return null;
  if (halfWidthNm > 0) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const w = wavelengthNm[i] as number;
      const a = absorbance[i] as number;
      if (Math.abs(w - atNm) <= halfWidthNm && Number.isFinite(a)) {
        sum += a;
        count++;
      }
    }
    if (count > 0) return sum / count;
  }
  for (let i = 1; i < n; i++) {
    const w1 = wavelengthNm[i] as number;
    if (w1 >= atNm) {
      const w0 = wavelengthNm[i - 1] as number;
      const a0 = absorbance[i - 1] as number;
      const a1 = absorbance[i] as number;
      const value = w1 === w0 ? a1 : a0 + ((atNm - w0) / (w1 - w0)) * (a1 - a0);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

/** A Beer–Lambert calibration line from standards of known concentration. */
export interface Calibration {
  /** A = intercept + slope · c, c in the user's concentration unit. */
  fit: LinearFit;
  /** Absorptivity ε = slope / b, in (concentration unit)⁻¹ cm⁻¹; with mol/L it is the molar absorption coefficient. */
  absorptivity: number;
  absorptivitySigma: number;
  /** Lowest and highest standard concentration: the range the line was measured over. */
  range: [number, number];
}

/**
 * Beer–Lambert law A = ε b c (A absorbance, ε absorptivity, b path length in cm, c concentration):
 * a least-squares line of A against c for the standards. With `throughOrigin` the intercept is
 * fixed at 0 (a blank-corrected measurement); otherwise it is fitted, which absorbs a constant
 * offset such as an imperfect blank. ε = slope / b, σ(ε) = σ(slope) / b. Null with fewer than two
 * standards, all at the same concentration, or a path length that is not positive.
 */
export function calibrate(
  concentrations: readonly number[],
  absorbances: readonly number[],
  pathCm: number,
  throughOrigin: boolean,
): Calibration | null {
  if (!(pathCm > 0)) return null;
  const fit = throughOrigin
    ? originFit(concentrations, absorbances)
    : linearFit(concentrations, absorbances);
  if (!fit || fit.slope === 0) return null;
  return {
    fit,
    absorptivity: fit.slope / pathCm,
    absorptivitySigma: fit.slopeSigma / pathCm,
    range: [Math.min(...concentrations), Math.max(...concentrations)],
  };
}

/** Concentration from an absorbance with a calibration line: c = (A − intercept) / slope. */
export function concentrationFrom(absorbance: number, calibration: Calibration): number {
  return (absorbance - calibration.fit.intercept) / calibration.fit.slope;
}

/** One time point of a photocatalysis (or other decay) experiment. */
export interface KineticPoint {
  /** Time, min. Negative times (for example a dark adsorption period) are listed but not fitted. */
  timeMin: number;
  absorbance: number;
  /** C / C₀ = A / A₀ (Beer–Lambert, same cell and wavelength). */
  ratio: number;
  /** Removal (1 − C / C₀) · 100, %. */
  removalPct: number;
  /** ln(C₀ / C); null when A ≤ 0. */
  lnRatio: number | null;
}

export interface FirstOrderResult {
  points: KineticPoint[];
  /** Time of the reference point C₀ (the point at t = 0, else the earliest), min. */
  referenceTimeMin: number;
  /** ln(C₀ / C) = k t through the origin, over the points with t ≥ the reference time. */
  fit: LinearFit;
  /** Apparent pseudo-first-order rate constant k, min⁻¹, with its standard error. */
  kPerMin: number;
  kSigma: number;
  /** Half-life ln 2 / k, min (null when k ≤ 0). */
  halfLifeMin: number | null;
}

/**
 * Pseudo-first-order kinetics, the usual model for dye degradation at low concentration:
 *   ln(C₀ / C) = k t,
 * with C / C₀ = A / A₀ from the Beer–Lambert law (absorbance at one wavelength, same cell; it
 * holds only where A is proportional to c). C₀ is the point at t = 0 (after any dark period);
 * without one, the earliest point. Points before it are kept in the table but not fitted.
 * k (min⁻¹) is the slope of a least-squares line through the origin, σ(k) its standard error,
 * and the half-life is t½ = ln 2 / k. Null with fewer than two usable points or A₀ ≤ 0.
 */
export function firstOrderKinetics(
  timesMin: readonly number[],
  absorbances: readonly number[],
): FirstOrderResult | null {
  if (timesMin.length !== absorbances.length || timesMin.length < 2) return null;
  const zero = timesMin.indexOf(0);
  const reference = zero >= 0 ? zero : timesMin.indexOf(Math.min(...timesMin));
  const t0 = timesMin[reference] as number;
  const a0 = absorbances[reference] as number;
  if (!(a0 > 0)) return null;
  const points = timesMin.map((t, i): KineticPoint => {
    const a = absorbances[i] as number;
    const ratio = a / a0;
    return {
      timeMin: t,
      absorbance: a,
      ratio,
      removalPct: (1 - ratio) * 100,
      lnRatio: a > 0 ? Math.log(a0 / a) : null,
    };
  });
  const used = points.filter((p) => p.timeMin >= t0 && p.lnRatio !== null);
  const fit = originFit(
    used.map((p) => p.timeMin - t0),
    used.map((p) => p.lnRatio as number),
  );
  if (!fit || used.length < 2) return null;
  return {
    points,
    referenceTimeMin: t0,
    fit,
    kPerMin: fit.slope,
    kSigma: fit.slopeSigma,
    halfLifeMin: fit.slope > 0 ? Math.LN2 / fit.slope : null,
  };
}
