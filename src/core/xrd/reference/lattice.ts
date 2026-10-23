/*
 * Lattice parameters from indexed peak positions, by weighted linear least squares on 1/d².
 */

import { invert } from '../../math/linear.ts';

const DEG = Math.PI / 180;

export type LatticeSystem = 'cubic' | 'tetragonal' | 'hexagonal' | 'orthorhombic';

/** Names of the refined cell edges, in the order of the parameters. */
const EDGES: Record<LatticeSystem, readonly ('a' | 'b' | 'c')[]> = {
  cubic: ['a'],
  tetragonal: ['a', 'c'],
  hexagonal: ['a', 'c'],
  orthorhombic: ['a', 'b', 'c'],
};

/**
 * The lattice system a library cell can be refined in, or null when it is not supported.
 * Trigonal cells in the library use hexagonal axes (γ = 120°), which the hexagonal formula
 * covers; rhombohedral axes, monoclinic and triclinic cells are not supported.
 */
export function latticeSystemOf(
  crystalSystem: string,
  cell: { alpha: number; beta: number; gamma: number },
): LatticeSystem | null {
  const right = (v: number) => Math.abs(v - 90) < 1e-6;
  const hexAxes = right(cell.alpha) && right(cell.beta) && Math.abs(cell.gamma - 120) < 1e-6;
  if (crystalSystem === 'cubic') return 'cubic';
  if (crystalSystem === 'tetragonal') return 'tetragonal';
  if (crystalSystem === 'orthorhombic') return 'orthorhombic';
  if ((crystalSystem === 'hexagonal' || crystalSystem === 'trigonal') && hexAxes)
    return 'hexagonal';
  return null;
}

/**
 * The coefficients g_j of 1/d² = Σ_j g_j p_j for one reflection (h k l), where p are the
 * reciprocal-metric terms the least squares solves for:
 *
 *   cubic         1/d² = (h² + k² + l²) · p₁,                       p₁ = 1/a²
 *   tetragonal    1/d² = (h² + k²) · p₁ + l² · p₂,                  p₁ = 1/a², p₂ = 1/c²
 *   hexagonal     1/d² = 4/3 (h² + hk + k²) · p₁ + l² · p₂,        p₁ = 1/a², p₂ = 1/c²
 *   orthorhombic  1/d² = h² · p₁ + k² · p₂ + l² · p₃,               p = 1/a², 1/b², 1/c²
 */
export function reciprocalTerms(
  system: LatticeSystem,
  [h, k, l]: readonly [number, number, number],
): number[] {
  switch (system) {
    case 'cubic':
      return [h * h + k * k + l * l];
    case 'tetragonal':
      return [h * h + k * k, l * l];
    case 'hexagonal':
      return [(4 / 3) * (h * h + h * k + k * k), l * l];
    case 'orthorhombic':
      return [h * h, k * k, l * l];
  }
}

/** Cell volume V = f · Π_j edge_j^e_j, with exponents e_j and factor f. */
const VOLUME: Record<LatticeSystem, { exponents: number[]; factor: number }> = {
  cubic: { exponents: [3], factor: 1 },
  tetragonal: { exponents: [2, 1], factor: 1 },
  hexagonal: { exponents: [2, 1], factor: Math.sqrt(3) / 2 },
  orthorhombic: { exponents: [1, 1, 1], factor: 1 },
};

/** Cell volume in Å³ from the cell edges in Å (a, b, c in the order of the system's parameters). */
export function cellVolume(system: LatticeSystem, edges: readonly number[]): number {
  const { exponents, factor } = VOLUME[system];
  return exponents.reduce((v, e, j) => v * (edges[j] as number) ** e, factor);
}

export interface LatticePeak {
  /** Observed peak position, degrees 2θ. */
  twoTheta: number;
  /** Standard uncertainty of the position, degrees 2θ; omit when unknown. */
  sigma?: number;
  hkl: readonly [number, number, number];
}

export interface Estimate {
  value: number;
  /** Standard uncertainty; NaN when it cannot be estimated (no degrees of freedom). */
  sigma: number;
}

export interface LatticeFit {
  system: LatticeSystem;
  /** Refined cell edges, Å, for example a and c for a tetragonal cell. */
  edges: { name: 'a' | 'b' | 'c'; a: Estimate }[];
  /** Cell volume, Å³. */
  volume: Estimate;
  /** Zero shift (observed − true position), degrees 2θ, when it was refined. */
  zeroShift: Estimate | null;
  /** Peaks used and degrees of freedom (peaks − refined parameters). */
  n: number;
  dof: number;
  /** Root-mean-square 2θ residual, degrees. */
  rms: number;
  /** Observed − calculated 2θ per peak, degrees, in the order of the input. */
  residuals: number[];
}

export type LatticeOutcome = { ok: true; fit: LatticeFit } | { ok: false; reason: string };

/** Weighted solution of the normal equations; null when the columns are linearly dependent. */
function normalEquations(
  rows: readonly number[][],
  y: readonly number[],
  weights: readonly number[],
): { solution: number[]; covariance: number[][] } | null {
  const m = (rows[0] as number[]).length;
  const a: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b = new Array<number>(m).fill(0);
  rows.forEach((row, i) => {
    const w = weights[i] as number;
    for (let j = 0; j < m; j++) {
      b[j] = (b[j] as number) + w * (row[j] as number) * (y[i] as number);
      for (let k = 0; k < m; k++)
        (a[j] as number[])[k] =
          ((a[j] as number[])[k] as number) + w * (row[j] as number) * (row[k] as number);
    }
  });
  const inverse = invert(a);
  if (!inverse) return null;
  const solution = inverse.map((row) => row.reduce((s, v, k) => s + v * (b[k] as number), 0));
  return { solution, covariance: inverse };
}

/**
 * Refines the cell of a cubic, tetragonal, hexagonal or orthorhombic crystal from indexed peaks.
 *
 * With q = 1/d² = 4 sin²θ / λ² (Bragg's law, d = λ / 2 sin θ), every observation is linear in
 * the reciprocal-metric terms p: q_i = Σ_j g_ij p_j (see reciprocalTerms). A zero shift z
 * (observed 2θ = true 2θ + z, degrees) changes q by ∂q/∂(2θ) · z with
 * ∂q/∂(2θ) = 2 sin(2θ) / λ² per radian, so it enters as one more linear column; q is evaluated
 * at the shifted position and the solution is iterated until z no longer changes.
 *
 * Observations are weighted by 1/σ_q², σ_q = (∂q/∂2θ) σ_2θ, with σ_2θ equal to 1 for every peak
 * when any sigma is missing. The covariance (JᵀWJ)⁻¹ is multiplied by χ²/dof, so the quoted
 * uncertainties reflect the scatter actually seen, but never by less than 1 when the input
 * sigmas are given. Cell edges follow from a = 1/√p and their uncertainties, and that of the
 * volume, from propagating the full covariance matrix.
 *
 * peaks: observed positions, degrees 2θ. wavelength λ in Å. refineZeroShift adds z as a parameter.
 * Refuses, with a reason, when there are fewer peaks than parameters or the indices do not
 * determine every parameter.
 */
export function refineLattice(
  system: LatticeSystem,
  peaks: readonly LatticePeak[],
  wavelength: number,
  refineZeroShift: boolean,
): LatticeOutcome {
  const edgeNames = EDGES[system];
  const nCell = edgeNames.length;
  const nParams = nCell + (refineZeroShift ? 1 : 0);
  const names = `${edgeNames.join(', ')}${refineZeroShift ? ' and the zero shift' : ''}`;
  if (peaks.length < nParams)
    return {
      ok: false,
      reason: `${nParams} indexed peaks are needed to find ${names}, but only ${peaks.length} ${peaks.length === 1 ? 'is' : 'are'} usable.`,
    };

  const sigmasKnown = peaks.every((p) => p.sigma !== undefined && p.sigma > 0);
  const terms = peaks.map((p) => reciprocalTerms(system, p.hkl));
  const lambda2 = wavelength * wavelength;
  const qOf = (twoThetaDeg: number) => (4 * Math.sin((twoThetaDeg * DEG) / 2) ** 2) / lambda2;
  /** ∂q/∂(2θ) per degree. */
  const slope = (twoThetaDeg: number) => (2 * Math.sin(twoThetaDeg * DEG) * DEG) / lambda2;
  const weights = peaks.map((p) => {
    const sigmaQ = slope(p.twoTheta) * (sigmasKnown ? (p.sigma as number) : 1);
    return 1 / (sigmaQ * sigmaQ);
  });

  let z = 0;
  let solved: { solution: number[]; covariance: number[][] } | null = null;
  for (let iteration = 0; iteration < 20; iteration++) {
    // Linearise q(2θ − z) about the current z: q(obs − z_new) ≈ q(obs − z) − slope · (z_new − z).
    const y = peaks.map(
      (p) => qOf(p.twoTheta - z) + (refineZeroShift ? slope(p.twoTheta - z) * z : 0),
    );
    const rows = terms.map((g, i) =>
      refineZeroShift ? [...g, slope((peaks[i] as LatticePeak).twoTheta - z)] : g,
    );
    const next = normalEquations(rows, y, weights);
    if (!next) {
      return {
        ok: false,
        reason: `The indexed peaks do not fix every parameter (${names}). For example, a tetragonal or hexagonal c needs a peak with l ≠ 0, and an a needs one with h or k ≠ 0. Use more, differently indexed peaks.`,
      };
    }
    solved = next;
    const zNew = refineZeroShift ? (next.solution[nCell] as number) : 0;
    const done = Math.abs(zNew - z) < 1e-10;
    z = zNew;
    if (done || !refineZeroShift) break;
  }
  if (!solved) throw new Error('unreachable');
  const p = solved.solution.slice(0, nCell);
  if (p.some((v) => !(v > 0)))
    return {
      ok: false,
      reason:
        'The least squares gave an impossible (non-positive) reciprocal cell. Check that the hkl assignments are right.',
    };

  const calculated = terms.map((g) => {
    const q = g.reduce((s, v, j) => s + v * (p[j] as number), 0);
    return (2 * Math.asin(Math.min(1, (wavelength * Math.sqrt(q)) / 2)) * 180) / Math.PI + z;
  });
  const residuals = peaks.map((peak, i) => peak.twoTheta - (calculated[i] as number));
  const dof = peaks.length - nParams;
  const chi2 = peaks.reduce((s, peak, i) => {
    const sigma = sigmasKnown ? (peak.sigma as number) : 1;
    return s + ((residuals[i] as number) / sigma) ** 2;
  }, 0);
  // The weights were built from σ_q, whose slope factor cancels against the 2θ residuals above.
  const scale =
    dof > 0 ? (sigmasKnown ? Math.max(1, chi2 / dof) : chi2 / dof) : sigmasKnown ? 1 : NaN;

  const covariance = solved.covariance;
  const cov = (j: number, k: number) => ((covariance[j] as number[])[k] as number) * scale;
  const sigmaP = p.map((_, j) => Math.sqrt(cov(j, j)));
  const edges = edgeNames.map((name, j) => {
    const pj = p[j] as number;
    return {
      name,
      a: { value: 1 / Math.sqrt(pj), sigma: (sigmaP[j] as number) / (2 * pj ** 1.5) },
    };
  });

  const { exponents, factor } = VOLUME[system];
  // V = f · Π_j p_j^(−e_j / 2), because each edge is p_j^(−1/2).
  const volume = exponents.reduce((v, e, j) => v * (p[j] as number) ** (-e / 2), factor);
  // d ln V / d p_j = −e_j / (2 p_j), so σ_V² = V² Σ_jk (…)_j (…)_k cov_jk.
  let relativeVariance = 0;
  for (let j = 0; j < nCell; j++)
    for (let k = 0; k < nCell; k++)
      relativeVariance +=
        ((exponents[j] as number) / (2 * (p[j] as number))) *
        ((exponents[k] as number) / (2 * (p[k] as number))) *
        cov(j, k);

  return {
    ok: true,
    fit: {
      system,
      edges,
      volume: { value: volume, sigma: volume * Math.sqrt(relativeVariance) },
      zeroShift: refineZeroShift ? { value: z, sigma: Math.sqrt(cov(nCell, nCell)) } : null,
      n: peaks.length,
      dof,
      rms: Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length),
      residuals,
    },
  };
}
