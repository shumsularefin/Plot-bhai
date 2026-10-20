const DEG = Math.PI / 180;

/**
 * 2θ (degrees) at which Kα2 diffracts from the same lattice planes that diffract Kα1 at
 * `twoTheta1` (degrees). From Bragg's law λ = 2d·sin θ with d fixed:
 *   sin θ2 = (λ2 / λ1) · sin θ1.
 * Returns NaN when no such angle exists (sin θ2 > 1). λ1 and λ2 in the same unit (Å).
 */
export function kAlpha2Position(twoTheta1: number, lambda1: number, lambda2: number): number {
  const s = (lambda2 / lambda1) * Math.sin((twoTheta1 / 2) * DEG);
  return s > 1 ? NaN : (2 * Math.asin(s)) / DEG;
}

/**
 * Kα2 stripping by the Rachinger method (W. A. Rachinger, J. Sci. Instrum. 25 (1948) 254).
 *
 * Assumes every Kα2 line has the same shape as its Kα1 line, with intensity R = I(Kα2)/I(Kα1),
 * at the angle given by Bragg's law. The measured intensity is then
 *   I(2θ) = I1(2θ) + R · I1(2θ′),   with sin θ′ = (λ1 / λ2) · sin θ  (so 2θ′ < 2θ),
 * and the Kα1 intensity is recovered point by point from low to high angle:
 *   I1(2θ) = I(2θ) − R · I1(2θ′),
 * with I1(2θ′) interpolated linearly between already corrected points. Where 2θ′ falls before
 * the first point, nothing is subtracted. When 2θ′ lies between the previous point and this
 * one, the interpolation includes the unknown I1(2θ) and the equation is solved for it.
 *
 * x: 2θ in degrees, increasing. y: intensity with the background already removed (otherwise
 * the background is reduced by the factor 1/(1 + R) as well). Returns the Kα1-only intensity.
 * Noise is not reduced, and small errors in R or λ leave small residual bumps.
 */
export function stripKAlpha2(
  x: Float64Array,
  y: Float64Array,
  lambda1: number,
  lambda2: number,
  ratio: number,
): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const factor = lambda1 / lambda2;
  let j = 0; // x[j] ≤ 2θ′ < x[j + 1], moving forward only
  for (let i = 0; i < n; i++) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    const source = (2 * Math.asin(factor * Math.sin((xi / 2) * DEG))) / DEG;
    if (i === 0 || source < (x[0] as number)) {
      out[i] = yi;
      continue;
    }
    while (j + 1 < i && (x[j + 1] as number) <= source) j++;
    const x0 = x[j] as number;
    const x1 = x[j + 1] as number;
    const f = (source - x0) / (x1 - x0);
    if (j + 1 === i) {
      // I1(2θ′) = (1 − f)·I1[j] + f·I1[i], and I1[i] is the unknown.
      out[i] = (yi - ratio * (1 - f) * (out[j] as number)) / (1 + ratio * f);
    } else {
      out[i] = yi - ratio * ((1 - f) * (out[j] as number) + f * (out[j + 1] as number));
    }
  }
  return out;
}
