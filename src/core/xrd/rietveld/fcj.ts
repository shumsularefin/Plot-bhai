/*
 * Axial-divergence asymmetry of Finger, Cox and Jephcoat (L. W. Finger, D. E. Cox and
 * A. P. Jephcoat, J. Appl. Cryst. 27 (1994) 892–900), in the form GSAS-II uses for laboratory
 * data: the Fortran routine PSVFCJO (sources/powsubs/psvfcjo.for, B. H. Toby) called with
 * S/L = H/L = SH/L / 2 (PYPSVFCJO in sources/pypowder.for), so one parameter SH/L = (S + H)/L
 * describes it and an .instprm file transfers exactly.
 *
 * The profile at 2θ_k (degrees, the peak position) is a weighted mean of pseudo-Voigts of unit
 * area centred at angles Δ between 2φ_min and 2θ_k:
 *   Ω_FCJ(x) = Σ_j w_j G(Δ_j) Ω(x − Δ_j) / Σ_j w_j G(Δ_j)
 *   cos 2φ_min = √(1 + (SH/L)²) cos 2θ_k             (FCJ eq. 4; 0° or 180° if beyond ±1)
 *   Δ_j = 2φ_min + (2θ_k − 2φ_min) x_j,   x_j, w_j the positive half of the N-point
 *          Gauss–Legendre rule on [−1, 1]
 *   F = |cos 2θ_k| / √(sin²2θ_k − sin²Δ)              (√(cos²Δ − cos²2θ_k) above 2θ = 45°; F = 1
 *                                                      where the root is not real)
 *   G = (SH/L · F − 1) / cos Δ                         (FCJ eq. 7 with S = H)
 * N is the first of 2, 4, …, 30, 40, …, 120, 140, …, 300, 400 that is at least
 * K = int(300 |2θ_k − 2φ_min| / γ), γ the Lorentzian width in centidegrees (K = int(200 |…|) when
 * γ ≤ 0), as in PSVFCJO, so the steps of the integral stay small against the Lorentzian width.
 * The low-angle tail reaches 2φ_min ≈ 2θ_k − (SH/L)² cot 2θ_k / 2 (radians); above 90° it is on
 * the high-angle side. SH/L = 0 is the symmetric pseudo-Voigt.
 */

const RAD = Math.PI / 180;
const TERMS = [
  2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
  140, 160, 180, 200, 220, 240, 260, 280, 300, 400,
];
const rules = new Map<number, { x: Float64Array; w: Float64Array }>();

/**
 * The positive half of the n-point Gauss–Legendre rule on [−1, 1] (n even): abscissas and weights
 * from Newton's method on the Legendre polynomial, as Numerical Recipes' GAULEG (which PSVFCJO
 * calls), here in double precision.
 */
export function gaussLegendreHalf(n: number): { x: Float64Array; w: Float64Array } {
  const cached = rules.get(n);
  if (cached) return cached;
  const m = n / 2;
  const x = new Float64Array(m);
  const w = new Float64Array(m);
  for (let i = 1; i <= m; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let iteration = 0; iteration < 100; iteration++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const previous = z;
      z = previous - p1 / pp;
      if (Math.abs(z - previous) < 1e-15) break;
    }
    // GAULEG's x(n+1−i) = +z: the positive nodes, largest first.
    x[i - 1] = z;
    w[i - 1] = 2 / ((1 - z * z) * pp * pp);
  }
  const rule = { x, w };
  rules.set(n, rule);
  return rule;
}

/** Centres Δ_j (degrees 2θ) and weights (summing to 1) of the FCJ profile. */
export interface FcjNodes {
  centres: Float64Array;
  weights: Float64Array;
}

/**
 * FCJ nodes of a peak at twoTheta (degrees) for axial divergence shl = SH/L and Lorentzian FWHM
 * gamma (degrees). Returns null when shl ≤ 0 (no asymmetry).
 */
export function fcjNodes(twoTheta: number, shl: number, gamma: number): FcjNodes | null {
  if (!(shl > 0)) return null;
  const c = Math.cos(twoTheta * RAD);
  const s = Math.sin(twoTheta * RAD);
  const cos2 = c * c;
  const sin2 = s * s;
  const t = Math.sqrt(1 + shl * shl) * c;
  const eMin = Math.abs(t) <= 1 ? Math.acos(t) / RAD : t > 0 ? 0 : 180;
  const span = Math.abs(twoTheta - eMin);
  const gammaCenti = 100 * gamma;
  const k = Math.trunc(gammaCenti <= 0 ? span * 200 : (300 * span) / gammaCenti);
  const n = TERMS.find((terms) => terms >= k) ?? (TERMS[TERMS.length - 1] as number);
  const rule = gaussLegendreHalf(n);
  const m = rule.x.length;
  const centres = new Float64Array(m);
  const weights = new Float64Array(m);
  let total = 0;
  for (let j = 0; j < m; j++) {
    const delta = eMin + (twoTheta - eMin) * (rule.x[j] as number);
    const sd = Math.sin(delta * RAD);
    const cd = Math.cos(delta * RAD);
    const root = twoTheta > 45 ? cd * cd - cos2 : sin2 - sd * sd;
    const f = root > 0 ? Math.abs(c) / Math.sqrt(root) : 1;
    const g = (shl * f - 1) / cd;
    centres[j] = delta;
    weights[j] = (rule.w[j] as number) * g;
    total += weights[j] as number;
  }
  if (!(Math.abs(total) > 0) || !Number.isFinite(total)) return null;
  for (let j = 0; j < m; j++) weights[j] = (weights[j] as number) / total;
  return { centres, weights };
}
