import { polynomialBackground } from '../xrd/process/background';

/**
 * Rubber-band baseline: the lower convex hull of the spectrum, as if a rubber band were
 * stretched under it, then straight lines between the hull's vertices. x must increase.
 * Same units as y. Suitable for absorbance spectra with peaks pointing up; it never lies above
 * the data.
 */
export function rubberBandBaseline(x: Float64Array, y: Float64Array): Float64Array {
  const n = x.length;
  const hull: number[] = [];
  for (let i = 0; i < n; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2] as number;
      const b = hull[hull.length - 1] as number;
      // Remove b when it lies on or above the line from a to i (cross product ≤ 0).
      const cross =
        ((x[b] as number) - (x[a] as number)) * ((y[i] as number) - (y[a] as number)) -
        ((y[b] as number) - (y[a] as number)) * ((x[i] as number) - (x[a] as number));
      if (cross <= 0) hull.pop();
      else break;
    }
    hull.push(i);
  }
  const out = new Float64Array(n);
  for (let h = 0; h < hull.length - 1; h++) {
    const a = hull[h] as number;
    const b = hull[h + 1] as number;
    for (let i = a; i <= b; i++) {
      const t = ((x[i] as number) - (x[a] as number)) / ((x[b] as number) - (x[a] as number));
      out[i] = (y[a] as number) * (1 - t) + (y[b] as number) * t;
    }
  }
  return out;
}

/** Iterative polynomial baseline (Lieber and Mahadevan-Jansen); see polynomialBackground. */
export function polynomialBaseline(x: Float64Array, y: Float64Array, degree: number): Float64Array {
  return polynomialBackground(x, y, degree);
}

/**
 * Solves A z = b for a symmetric positive definite matrix with two off-diagonals, stored as
 * d0 (main diagonal), d1 (A[i][i+1]) and d2 (A[i][i+2]), by banded Cholesky factorisation
 * A = L Lᵀ. Cost grows linearly with n.
 */
export function solveBanded(
  d0: Float64Array,
  d1: Float64Array,
  d2: Float64Array,
  b: Float64Array,
): Float64Array {
  const n = b.length;
  const l0 = new Float64Array(n);
  const l1 = new Float64Array(n); // L[i][i-1]
  const l2 = new Float64Array(n); // L[i][i-2]
  for (let i = 0; i < n; i++) {
    if (i >= 2) l2[i] = (d2[i - 2] as number) / (l0[i - 2] as number);
    if (i >= 1) {
      l1[i] =
        ((d1[i - 1] as number) - (l2[i] as number) * (l1[i - 1] as number)) / (l0[i - 1] as number);
    }
    const sum = (d0[i] as number) - (l1[i] as number) ** 2 - (l2[i] as number) ** 2;
    l0[i] = Math.sqrt(sum);
  }
  const forward = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    forward[i] =
      ((b[i] as number) -
        (i >= 1 ? (l1[i] as number) * (forward[i - 1] as number) : 0) -
        (i >= 2 ? (l2[i] as number) * (forward[i - 2] as number) : 0)) /
      (l0[i] as number);
  }
  const z = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    z[i] =
      ((forward[i] as number) -
        (i + 1 < n ? (l1[i + 1] as number) * (z[i + 1] as number) : 0) -
        (i + 2 < n ? (l2[i + 2] as number) * (z[i + 2] as number) : 0)) /
      (l0[i] as number);
  }
  return z;
}

/**
 * Asymmetric least squares baseline (P. H. C. Eilers and H. F. M. Boelens, 2005, "Baseline
 * correction with asymmetric least squares smoothing"; the algorithm is implemented from its
 * description and not checked against the paper). A smooth curve z minimises
 *   Σ wᵢ (yᵢ − zᵢ)² + λ Σ (Δ²zᵢ)²,
 * where Δ² is the second difference, λ the smoothness and the weights are p (small) for points
 * above the curve and 1 − p for points below it, so peaks are largely ignored. The weights are
 * updated for `iterations` rounds. Points are treated as evenly spaced. Same units as y.
 * λ and p are not universal constants: larger λ gives a stiffer baseline and p is usually
 * between 0.001 and 0.1.
 */
export function alsBaseline(
  y: Float64Array,
  lambda: number,
  p: number,
  iterations = 10,
): Float64Array {
  const n = y.length;
  if (n < 3) return y.slice();
  // λ DᵀD, with D the second-difference matrix: each row (1, −2, 1) adds its outer product.
  const s0 = new Float64Array(n);
  const s1 = new Float64Array(n);
  const s2 = new Float64Array(n);
  const pattern = [1, -2, 1];
  for (let r = 0; r < n - 2; r++) {
    for (let a = 0; a < 3; a++) {
      for (let b = a; b < 3; b++) {
        const value = (pattern[a] as number) * (pattern[b] as number) * lambda;
        if (b === a) s0[r + a] = (s0[r + a] as number) + value;
        else if (b - a === 1) s1[r + a] = (s1[r + a] as number) + value;
        else s2[r + a] = (s2[r + a] as number) + value;
      }
    }
  }
  const w = new Float64Array(n).fill(1);
  let z: Float64Array = y.slice();
  for (let it = 0; it < iterations; it++) {
    const d0 = s0.map((v, i) => v + (w[i] as number));
    const rhs = y.map((v, i) => v * (w[i] as number));
    z = solveBanded(d0, s1, s2, rhs);
    for (let i = 0; i < n; i++) w[i] = (y[i] as number) > (z[i] as number) ? p : 1 - p;
  }
  return z;
}
