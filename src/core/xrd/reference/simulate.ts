/*
 * A calculated (theoretical) powder profile from a reference phase's lines, for drawing over a
 * measured pattern. It is a display aid for comparing positions and relative intensities, not a
 * refinement: every line gets the same pseudo-Voigt shape and width, and only one overall scale
 * is fitted.
 */

import { solve } from '../../math/linear.ts';
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
 * Non-negative scales s_k that bring the sum Σ s_k p_k of several profiles closest to the data
 * y by least squares: the normal equations (PᵀP) s = Pᵀy are solved, and any profile whose scale
 * comes out negative is dropped (scale 0) and the rest solved again, until all are ≥ 0. Points
 * where y or a profile is not finite are left out. The scales are not phase fractions: those
 * would need each phase's scattering power (for example a reference intensity ratio).
 */
export function fitScales(y: Float64Array, profiles: readonly Float64Array[]): number[] {
  const k = profiles.length;
  const scales = new Array<number>(k).fill(0);
  let active = profiles.map((_, i) => i);
  const usable = (i: number) =>
    Number.isFinite(y[i] as number) && profiles.every((p) => Number.isFinite(p[i] as number));
  for (let round = 0; round < k && active.length > 0; round++) {
    const m = active.length;
    const a = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    const b = new Array<number>(m).fill(0);
    for (let i = 0; i < y.length; i++) {
      if (!usable(i)) continue;
      for (let r = 0; r < m; r++) {
        const pr = (profiles[active[r] as number] as Float64Array)[i] as number;
        b[r] = (b[r] as number) + pr * (y[i] as number);
        const row = a[r] as number[];
        for (let c = 0; c < m; c++)
          row[c] =
            (row[c] as number) +
            pr * ((profiles[active[c] as number] as Float64Array)[i] as number);
      }
    }
    const solution = solve(a, b);
    if (!solution) break;
    const negative = active.filter((_, r) => !((solution[r] as number) > 0));
    if (negative.length === 0) {
      active.forEach((index, r) => (scales[index] = solution[r] as number));
      return scales;
    }
    active = active.filter((index) => !negative.includes(index));
  }
  return scales;
}
