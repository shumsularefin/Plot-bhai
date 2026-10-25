/*
 * A calculated (theoretical) powder profile from a reference phase's lines, for drawing over a
 * measured pattern. It is a display aid for comparing positions and relative intensities, not a
 * refinement: every line gets the same pseudo-Voigt shape and width, and only one overall scale
 * is fitted.
 */

import { kAlpha2Position } from '../process/kAlpha2.ts';
import type { PatternPeak } from './powder.ts';

export interface SimulationSettings {
  /** Full width at half maximum of every line, degrees 2θ. */
  fwhmDeg: number;
  /** Lorentzian fraction of the pseudo-Voigt, 0 (Gaussian) to 1 (Lorentzian). */
  eta: number;
  /** Shift added to every line, degrees 2θ (the zero shift found in the comparison). */
  shiftDeg: number;
  /** Add a Kα2 copy of every line at this intensity ratio and wavelength pair (Å). */
  kAlpha2: { lambda1: number; lambda2: number; ratio: number } | null;
}

/**
 * Pseudo-Voigt of unit height: η L + (1 − η) G with the same FWHM w,
 *   G = exp(−4 ln2 (x − x0)² / w²),  L = 1 / (1 + 4 (x − x0)² / w²).
 */
function pseudoVoigt(x: number, x0: number, w: number, eta: number): number {
  const t = ((x - x0) / w) ** 2;
  return eta / (1 + 4 * t) + (1 - eta) * Math.exp(-4 * Math.LN2 * t);
}

/**
 * Profile on the angles x (degrees 2θ, increasing): the sum over lines of I_rel × pV(2θ_line +
 * shift), with I_rel the line's relative intensity (strongest = 100), plus a Kα2 copy at the
 * position from Bragg's law and ratio × the intensity when asked. Lines further than 20 FWHM
 * from a point are skipped (they contribute < 0.1 % of their height there).
 */
export function simulateProfile(
  lines: readonly PatternPeak[],
  x: Float64Array,
  settings: SimulationSettings,
): Float64Array {
  const out = new Float64Array(x.length);
  const w = Math.max(settings.fwhmDeg, 1e-6);
  const reach = 20 * w;
  const add = (centre: number, height: number) => {
    let lo = 0;
    let hi = x.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((x[mid] as number) < centre - reach) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < x.length && (x[i] as number) <= centre + reach; i++)
      out[i] = (out[i] as number) + height * pseudoVoigt(x[i] as number, centre, w, settings.eta);
  };
  for (const line of lines) {
    const centre = line.twoTheta + settings.shiftDeg;
    add(centre, line.intensity);
    const k2 = settings.kAlpha2;
    if (k2 && k2.ratio > 0) {
      const second = kAlpha2Position(line.twoTheta, k2.lambda1, k2.lambda2);
      if (Number.isFinite(second)) add(second + settings.shiftDeg, line.intensity * k2.ratio);
    }
  }
  return out;
}

/**
 * The scale s ≥ 0 that brings the profile p closest to the data y by least squares,
 * s = Σ y p / Σ p², over points where both are finite. 0 when the profile is zero everywhere.
 */
export function leastSquaresScale(y: Float64Array, p: Float64Array): number {
  let yp = 0;
  let pp = 0;
  for (let i = 0; i < y.length; i++) {
    const a = y[i] as number;
    const b = p[i] as number;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    yp += a * b;
    pp += b * b;
  }
  return pp > 0 ? Math.max(0, yp / pp) : 0;
}
