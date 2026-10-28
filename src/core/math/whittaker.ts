/*
 * Whittaker-smoother baselines: a smooth curve z that minimises
 *   Σ wᵢ (yᵢ − zᵢ)² + λ Σ (Δ²zᵢ)²,
 * where Δ² is the second difference and the weights wᵢ decide which points the curve follows.
 * Points are treated as evenly spaced; λ is in units of (points)⁴, so the same λ is stiffer on
 * coarsely sampled data. Shared by the FTIR and XRD tools.
 */

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
  const [s0, s1, s2] = penalty(n, lambda);
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

/** λ DᵀD for the second-difference matrix D of n points, as three diagonals. */
function penalty(n: number, lambda: number): [Float64Array, Float64Array, Float64Array] {
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
  return [s0, s1, s2];
}

/**
 * Asymmetrically reweighted penalised least squares baseline, arPLS (S.-J. Baek, A. Park,
 * Y.-J. Ahn and J. Choo, Analyst 140 (2015) 250–257, implemented from the algorithm as widely
 * reproduced; the paper itself has not been read, but the result agrees with the arpls function
 * of pybaselines 1.2.1, which cites it, to 0.001 on a noisy synthetic pattern
 * (tests/baseline-validation.test.ts). Start with all
 * weights 1; solve the Whittaker problem; with d = y − z, take the mean m and standard deviation
 * s of the negative residuals (the points below the curve, which are noise around the baseline)
 * and set
 *   wᵢ = 1 / (1 + exp(2 (dᵢ − (2s − m)) / s)),
 * so points well above the noise band (peaks) get weights near 0 and points within it near 1;
 * repeat until the weights change by less than `ratio` (relative norm) or `maxIterations`.
 * Unlike AsLS there is no asymmetry parameter to choose: the noise level sets the weights.
 */
export function arplsBaseline(
  y: Float64Array,
  lambda: number,
  ratio = 1e-6,
  maxIterations = 100,
): Float64Array {
  const n = y.length;
  if (n < 3) return y.slice();
  const [s0, s1, s2] = penalty(n, lambda);
  let w = new Float64Array(n).fill(1);
  let z: Float64Array = y.slice();
  for (let it = 0; it < maxIterations; it++) {
    const d0 = s0.map((v, i) => v + (w[i] as number));
    z = solveBanded(
      d0,
      s1,
      s2,
      y.map((v, i) => v * (w[i] as number)),
    );
    let count = 0;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const d = (y[i] as number) - (z[i] as number);
      if (d < 0) {
        count++;
        sum += d;
        sum2 += d * d;
      }
    }
    if (count < 2) break;
    const m = sum / count;
    const sd = Math.sqrt(Math.max(sum2 / count - m * m, 0));
    if (!(sd > 0)) break;
    const next = new Float64Array(n);
    let change = 0;
    let size = 0;
    for (let i = 0; i < n; i++) {
      const d = (y[i] as number) - (z[i] as number);
      const t = (2 * (d - (2 * sd - m))) / sd;
      next[i] = t > 700 ? 0 : 1 / (1 + Math.exp(t));
      change += ((next[i] as number) - (w[i] as number)) ** 2;
      size += (w[i] as number) ** 2;
    }
    w = next;
    if (Math.sqrt(change) <= ratio * Math.sqrt(size)) break;
  }
  return z;
}
