/*
 * Anisotropic sample broadening, as defined in GSAS-II (github.com/AdvancedPhotonSource/GSAS-II,
 * GSASIIstrMath.GetSampleSigGam, GSASIIspc.MustrainNames and MustrainCoeff, GSASIIlattice.CosSinAngle),
 * so that refined values can be entered in GSAS-II unchanged. Each model gives, for one reflection
 * (h k l), an effective inverse crystallite size and an effective microstrain that replace the
 * isotropic ones in sample.ts:sampleWidths.
 *
 * Uniaxial (size or microstrain): one value across the axis (equatorial, i) and one along it
 * (axial, a). φ is the angle between the reflection's normal H = (h k l) and the axis P, also given
 * as a plane normal, in the reciprocal metric G*:
 *   cos φ = H·G*·P / (|H| |P|)
 *   size:   1/D_hkl = √[(sin φ / D_i)² + (cos φ / D_a)²]
 *   strain: μ_hkl   = μ_i μ_a / √[(μ_i cos φ)² + (μ_a sin φ)²]
 * so a reflection along the axis has D_a and μ_a, one across it D_i and μ_i.
 *
 * Generalized microstrain (P. W. Stephens, J. Appl. Cryst. 32 (1999) 281–289): the variance of
 * 1/d² is a quartic form in h, k, l with the terms the Laue class allows,
 *   μ_hkl = d² √(Σ_i S_i T_i(h, k, l))     (d in Å, S_i in GSAS-II's units, μ in 10⁻⁶)
 * T_i and the names S_hkl are those of GSAS-II's MustrainCoeff and MustrainNames, in the same
 * order. A negative sum (not a physical strain) is taken as 0 and reported.
 */

import type { CellKind } from './cell';
import type { Hkl } from './reflections';

export type LaueClass =
  'm3m' | '6/mmm' | '31m' | '3R' | '4/mmm' | 'mmm' | '2/m-a' | '2/m-b' | '2/m-c' | '-1';

/**
 * Trigonal space groups of Laue class −31m (International Tables for Crystallography Vol. A:
 * P312, P3₁12, P3₂12, P31m, P31c, P−31m, P−31c). GSAS-II gives them one extra Stephens term.
 */
const LAUE_31M = new Set([149, 151, 153, 157, 159, 162, 163]);

/**
 * Laue class for the Stephens terms, from the crystal system of the cell and, where it matters
 * (−31m against −3m1 and 6/mmm on hexagonal axes), the space-group number. Classes that GSAS-II
 * gives the same terms share one entry: m3 and m3m; 6/m, 6/mmm, −3m1 and −3; 4/m and 4/mmm;
 * −3 and −3m on rhombohedral axes.
 */
export function laueClass(kind: CellKind, spaceGroupNumber?: number): LaueClass {
  switch (kind) {
    case 'cubic':
      return 'm3m';
    case 'hexagonal':
      return spaceGroupNumber !== undefined && LAUE_31M.has(spaceGroupNumber) ? '31m' : '6/mmm';
    case 'rhombohedral':
      return '3R';
    case 'tetragonal':
      return '4/mmm';
    case 'orthorhombic':
      return 'mmm';
    case 'monoclinic-alpha':
      return '2/m-a';
    case 'monoclinic-beta':
      return '2/m-b';
    case 'monoclinic-gamma':
      return '2/m-c';
    default:
      return '-1';
  }
}

const ORTHO = ['S400', 'S040', 'S004', 'S220', 'S202', 'S022'];

/** Names of the Stephens coefficients S_hkl of a Laue class (GSAS-II's MustrainNames). */
export function stephensNames(laue: LaueClass): string[] {
  switch (laue) {
    case 'm3m':
      return ['S400', 'S220'];
    case '6/mmm':
      return ['S400', 'S004', 'S202'];
    case '31m':
      return ['S400', 'S004', 'S202', 'S301'];
    case '3R':
      return ['S400', 'S220', 'S310', 'S211'];
    case '4/mmm':
      return ['S400', 'S004', 'S220', 'S022'];
    case 'mmm':
      return ORTHO;
    case '2/m-a':
      return [...ORTHO, 'S013', 'S031', 'S211'];
    case '2/m-b':
      return [...ORTHO, 'S301', 'S103', 'S121'];
    case '2/m-c':
      return [...ORTHO, 'S130', 'S310', 'S112'];
    default:
      return [
        ...ORTHO,
        ...['S310', 'S103', 'S031', 'S130', 'S301', 'S013'],
        ...['S211', 'S121', 'S112'],
      ];
  }
}

/**
 * The terms T_i(h, k, l) of the Stephens quartic form, in the order of stephensNames, exactly as in
 * GSAS-II's MustrainCoeff. (For rhombohedral axes GSAS-II's third term is
 * 2(hl³ + lk³ + kh³) + 2(lh³ + kl³ + lk³), with lk³ twice and hk³ not at all; it is kept as written so
 * that values move between the two programs unchanged.)
 */
export function stephensTerms(laue: LaueClass, [h, k, l]: Hkl): number[] {
  const h2 = h * h;
  const k2 = k * k;
  const l2 = l * l;
  const ortho = [h2 * h2, k2 * k2, l2 * l2, 3 * h2 * k2, 3 * h2 * l2, 3 * k2 * l2];
  const hexagonal = [
    h2 * h2 + k2 * k2 + 2 * k * h2 * h + 2 * h * k2 * k + 3 * h2 * k2,
    l2 * l2,
    3 * (h2 * l2 + k2 * l2 + h * k * l2),
  ];
  switch (laue) {
    case 'm3m':
      return [h2 * h2 + k2 * k2 + l2 * l2, 3 * (h2 * k2 + h2 * l2 + k2 * l2)];
    case '6/mmm':
      return hexagonal;
    case '31m':
      return [...hexagonal, 4 * l * h2 * h];
    case '3R':
      return [
        h2 * h2 + k2 * k2 + l2 * l2,
        3 * (h2 * k2 + h2 * l2 + k2 * l2),
        2 * (h * l2 * l + l * k2 * k + k * h2 * h) + 2 * (l * h2 * h + k * l2 * l + l * k2 * k),
        4 * (k * l * h2 + h * l * k2 + h * k * l2),
      ];
    case '4/mmm':
      return [h2 * h2 + k2 * k2, l2 * l2, 3 * h2 * k2, 3 * (h2 * l2 + k2 * l2)];
    case 'mmm':
      return ortho;
    case '2/m-a':
      return [...ortho, 2 * k * l2 * l, 2 * l * k2 * k, 4 * k * l * h2];
    case '2/m-b':
      return [...ortho, 2 * l * h2 * h, 2 * h * l2 * l, 4 * h * l * k2];
    case '2/m-c':
      return [...ortho, 2 * h * k2 * k, 2 * k * h2 * h, 4 * h * k * l2];
    default:
      return [
        ...ortho,
        2 * k * h2 * h,
        2 * h * l2 * l,
        2 * l * k2 * k,
        2 * h * k2 * k,
        2 * l * h2 * h,
        2 * k * l2 * l,
        4 * k * l * h2,
        4 * h * l * k2,
        4 * k * h * l2,
      ];
  }
}

/** Σ S_i T_i(h k l), the variance of 1/d² in GSAS-II's units (may be negative for bad S). */
export function stephensSum(laue: LaueClass, s: readonly number[], hkl: Hkl): number {
  const t = stephensTerms(laue, hkl);
  let sum = 0;
  for (let i = 0; i < t.length; i++) sum += (s[i] as number) * (t[i] as number);
  return sum;
}

/** Microstrain μ_hkl (10⁻⁶) of a reflection of spacing d (Å) under the Stephens model. */
export function stephensStrain(laue: LaueClass, s: readonly number[], hkl: Hkl, d: number): number {
  return d * d * Math.sqrt(Math.max(0, stephensSum(laue, s, hkl)));
}

/** cos φ of the angle between plane normals u and v in the reciprocal metric G* (row-major 3×3). */
export function cosAngle(gStar: readonly number[], u: Hkl, v: Hkl): number {
  const dot = (p: Hkl, q: Hkl) => {
    let s = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        s += (p[i] as number) * (gStar[i * 3 + j] as number) * (q[j] as number);
    return s;
  };
  return dot(u, v) / Math.sqrt(dot(u, u) * dot(v, v));
}

/** Effective inverse size 1/D_hkl from the equatorial and axial inverse sizes and cos φ. */
export function uniaxialInverseSize(equatorial: number, axial: number, cos: number): number {
  const sin2 = Math.max(0, 1 - cos * cos);
  return Math.sqrt(sin2 * equatorial * equatorial + cos * cos * axial * axial);
}

/** Effective microstrain μ_hkl from the equatorial and axial microstrains and cos φ. */
export function uniaxialStrain(equatorial: number, axial: number, cos: number): number {
  const sin2 = Math.max(0, 1 - cos * cos);
  const denominator = Math.sqrt(equatorial * equatorial * cos * cos + axial * axial * sin2);
  return denominator > 0 ? (equatorial * axial) / denominator : 0;
}

/**
 * Stephens coefficients that give the same microstrain μ (10⁻⁶) in every direction, a starting
 * point for the generalized model: the least-squares solution of Σ S_i T_i = μ²/d⁴ over the given
 * reflections, each row divided by (1/d²)² so every reflection counts the same. It is exact when
 * (1/d²)² lies in the span of the terms, as it does for every Laue class with a metric of that
 * symmetry except GSAS-II's rhombohedral form (see stephensTerms), where it is the closest fit.
 */
export function stephensFromIsotropic(
  laue: LaueClass,
  mu: number,
  gStar: readonly number[],
  hkls: readonly Hkl[],
): number[] {
  const n = stephensNames(laue).length;
  const a = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (const hkl of hkls) {
    const t = stephensTerms(laue, hkl);
    let q = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        q += (hkl[i] as number) * (gStar[i * 3 + j] as number) * (hkl[j] as number);
    // Rows scaled by 1/q² so every reflection counts the same, whatever its d.
    const w = 1 / (q * q);
    for (let i = 0; i < n; i++) {
      b[i] = (b[i] as number) + w * (t[i] as number) * mu * mu;
      for (let j = 0; j < n; j++)
        a[i * n + j] = (a[i * n + j] as number) + w * w * (t[i] as number) * (t[j] as number);
    }
  }
  return solveSymmetric(a, b, n);
}

/** Solution of A x = b for a symmetric positive semi-definite A (Gaussian elimination, pivoting). */
function solveSymmetric(a: Float64Array, b: Float64Array, n: number): number[] {
  const m = a.slice();
  const x = b.slice();
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r * n + c] as number) > Math.abs(m[pivot * n + c] as number)) pivot = r;
    if (pivot !== c) {
      for (let j = 0; j < n; j++) {
        const t = m[c * n + j] as number;
        m[c * n + j] = m[pivot * n + j] as number;
        m[pivot * n + j] = t;
      }
      const t = x[c] as number;
      x[c] = x[pivot] as number;
      x[pivot] = t;
    }
    const diag = m[c * n + c] as number;
    if (Math.abs(diag) < 1e-300) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = (m[r * n + c] as number) / diag;
      if (f === 0) continue;
      for (let j = c; j < n; j++)
        m[r * n + j] = (m[r * n + j] as number) - f * (m[c * n + j] as number);
      x[r] = (x[r] as number) - f * (x[c] as number);
    }
  }
  return Array.from({ length: n }, (_, i) => {
    const diag = m[i * n + i] as number;
    return Math.abs(diag) < 1e-300 ? 0 : (x[i] as number) / diag;
  });
}
