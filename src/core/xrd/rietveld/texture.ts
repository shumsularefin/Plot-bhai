/*
 * Spherical-harmonic preferred orientation (texture) of a powder with cylindrical sample
 * symmetry, as GSAS-II computes it (GSASIIstrMath.SHPOcal, commit 2c62562):
 *
 *   A(h) = 1 + Σ_{l,n} C_l^n · (4π/(2l + 1)) · k_l^n(φ, β) · k_l^0(ψ)
 *
 * - h: the reflection (h k l); A multiplies its intensity (1 for a random powder).
 * - C_l^n: the refined coefficients, l = 2, 4, …, up to the chosen even order, n the terms the
 *   Laue class allows (GSAS-II's OdfChk; GenSHCoeffT with sample symmetry '0', IfLMN false).
 * - k_l^n(φ, β): the crystal harmonic, symmetrised for the Laue class (GSASIIlattice.GetKcl).
 *   φ (polar) and β (azimuth) give the direction of the reciprocal vector h in the crystal
 *   (GSASIIlattice.CrsAng): φ is its angle to c* (b* or a* for the monoclinic unique axis), β is
 *   defined per Laue class. For cubic classes the harmonics are combinations with Bunge's
 *   coefficients (BOH, below).
 * - k_l^0(ψ): the sample harmonic for cylindrical symmetry, ψ the angle between the scattering
 *   vector and the sample axis (GSASIIlattice.GetKsl with M = 0): 90° for every reflection in
 *   Bragg–Brentano reflection geometry (GSAS-II's SamAng with the goniometer angles 0, 90, 0, 0
 *   and ω coupled to θ), and θ for a capillary (Debye–Scherrer, angles 0, 0, 0, 0).
 * - Both harmonics use the normalised associated Legendre functions P̄_l^m written as Fourier
 *   series, P̄_l^m(x) = Σ_s a_l^{ms} cos(s x) (even m) or sin(s x) (odd m) (GSAS-II's Fortran
 *   PLMPSI and APLMS), with a_l^{ms} from Q_l^{mn} (QLMN): the formula of Bunge, Texture
 *   Analysis in Materials Science (1982), the same one QLMNINIT tabulates.
 *
 * The texture index J = 1 + Σ C²/(2l + 1) (GSASIIlattice.textureIndex) is 1 for a random powder.
 * Angles are in degrees, as in GSAS-II.
 */

import type { Cell } from '../reference/powder';
import type { CellKind } from './cell';
import type { Hkl } from './reflections';

/** Laue classes as GSAS-II names them (SGData['SGLaue']), with the monoclinic unique axis. */
export type TextureLaue =
  | '-1'
  | '2/m'
  | 'mmm'
  | '4/m'
  | '4/mmm'
  | '3'
  | '3R'
  | '3m1'
  | '31m'
  | '3mR'
  | '6/m'
  | '6/mmm'
  | 'm3'
  | 'm3m';

export interface TextureSymmetry {
  laue: TextureLaue;
  /** Unique axis of a monoclinic cell ('a', 'b' or 'c'); 'c' otherwise (unused). */
  unique: 'a' | 'b' | 'c';
}

/** Highest even order offered (the cubic table below goes to 16). */
export const MAX_TEXTURE_ORDER = 16;

const RAD = Math.PI / 180;
const RSQ2PI = 1 / Math.sqrt(2 * Math.PI);
const SQ2 = Math.sqrt(2);
const SQ3 = 1.732050807569;

const LAUE_31M = new Set([149, 151, 153, 157, 159, 162, 163]);

/**
 * GSAS-II's Laue class of a phase from the crystal system of its cell (cellKind) and its
 * space-group number (1–230), when known. Without the number the higher class of the system is
 * used (6/mmm, 4/mmm, 3mR, m3m), which allows fewer coefficients.
 */
export function textureSymmetry(kind: CellKind, spaceGroupNumber?: number): TextureSymmetry {
  const sg = spaceGroupNumber ?? 0;
  const of = (laue: TextureLaue, unique: TextureSymmetry['unique'] = 'c') => ({ laue, unique });
  switch (kind) {
    case 'cubic':
      return of(sg >= 195 && sg <= 206 ? 'm3' : 'm3m');
    case 'hexagonal':
      if (sg >= 143 && sg <= 148) return of('3');
      if (sg >= 149 && sg <= 167) return of(LAUE_31M.has(sg) ? '31m' : '3m1');
      if (sg >= 168 && sg <= 176) return of('6/m');
      return of('6/mmm');
    case 'rhombohedral':
      return of(sg === 146 || sg === 148 ? '3R' : '3mR');
    case 'tetragonal':
      return of(sg >= 75 && sg <= 88 ? '4/m' : '4/mmm');
    case 'orthorhombic':
      return of('mmm');
    case 'monoclinic-alpha':
      return of('2/m', 'a');
    case 'monoclinic-beta':
      return of('2/m', 'b');
    case 'monoclinic-gamma':
      return of('2/m', 'c');
    default:
      return of('-1');
  }
}

/** True when the Laue class allows the term (l, m) (GSASIIlattice.OdfChk). */
function allowed(laue: TextureLaue | '0', l: number, m: number): boolean {
  if (l % 2 !== 0 || Math.abs(m) > l) return false;
  const am = Math.abs(m);
  switch (laue) {
    case '0':
      return m === 0;
    case '-1':
      return true;
    case '2/m':
      return am % 2 === 0;
    case 'mmm':
      return am % 2 === 0 && m >= 0;
    case '4/m':
      return am % 4 === 0;
    case '4/mmm':
      return am % 4 === 0 && m >= 0;
    case '3':
    case '3R':
      return am % 3 === 0;
    case '3m1':
    case '31m':
    case '3mR':
      return am % 3 === 0 && m >= 0;
    case '6/m':
      return am % 6 === 0;
    case '6/mmm':
      return am % 6 === 0 && m >= 0;
    case 'm3':
    case 'm3m':
      return m > 0 && m <= (l % 12 === 2 ? Math.floor(l / 12) : Math.floor(l / 12) + 1);
  }
}

/** The coefficients C_l^n up to an even order, as [l, n] in GSAS-II's order (GenSHCoeffT). */
export function textureTerms(laue: TextureLaue, order: number): [number, number][] {
  const terms: [number, number][] = [];
  for (let l = 2; l <= order; l += 2)
    for (let n = -l; n <= l; n++) if (allowed(laue, l, n)) terms.push([l, n]);
  return terms;
}

/** GSAS-II's name of a coefficient, "C(l,n)". */
export const textureName = ([l, n]: readonly [number, number]) => `C(${l},${n})`;

const lnFactorialCache: number[] = [0];
function lnFactorial(n: number): number {
  for (let i = lnFactorialCache.length; i <= n; i++)
    lnFactorialCache[i] = (lnFactorialCache[i - 1] as number) + Math.log(i);
  return lnFactorialCache[n] as number;
}

/** Q_l^{mn} (GSAS-II's QLMN, with the same formula for every l, m, n). */
export function qlmn(l: number, mm: number, nn: number): number {
  let m = Math.abs(mm);
  let n = Math.abs(nn);
  if (n > m) [m, n] = [n, m];
  const base =
    0.5 * (lnFactorial(l + n) + lnFactorial(l + m) + lnFactorial(l - m) + lnFactorial(l - n));
  let sum = 0;
  for (let i = 0; i <= l - n; i++) {
    if (l - m - i < 0 || m + n + i < 0) continue;
    const term = Math.exp(
      base -
        lnFactorial(i) -
        lnFactorial(l - m - i) -
        lnFactorial(l - n - i) -
        lnFactorial(m + n + i),
    );
    sum += i % 2 !== 0 ? -term : term;
  }
  let q = sum / 2 ** l;
  if ((l - m - n) % 2 !== 0) q = -q;
  if (mm < 0 && (l + nn) % 2 !== 0) q = -q;
  if (nn < 0 && (l + mm) % 2 !== 0) q = -q;
  return q;
}

/** a_l^{ms}, the Fourier coefficients of P̄_l^m (GSAS-II's APLMS). */
function aplms(l: number, m: number, s: number): number {
  const norm = Math.sqrt((2 * l + 1) / 2);
  const product = qlmn(l, m, s) * qlmn(l, 0, s);
  const am = Math.abs(m);
  let ap: number;
  if (am % 2 === 0) {
    ap = (s === 0 ? 1 : 2) * product * norm;
    if (am % 4 === 2) ap = -ap;
  } else {
    ap = s === 0 ? 0 : 2 * product * norm;
    if (am % 4 === 1) ap = -ap;
  }
  return Math.abs(ap) < 1e-6 ? 0 : ap;
}

/** P̄_l^m(ψ), ψ in degrees (GSAS-II's PLMPSI). */
export function plmpsi(l: number, m: number, psi: number): number {
  let p = 0;
  if (Math.abs(m) % 2 === 0) {
    for (let s = 0; s <= l; s += 2) p += aplms(l, m, s) * Math.cos(s * psi * RAD);
  } else {
    for (let s = 2; s <= l; s += 2) p += aplms(l, m, s) * Math.sin(s * psi * RAD);
  }
  return p;
}

/**
 * Bunge's coefficients of the cubic harmonics (even l, [001] along Z), Texture Analysis in
 * Materials Science, Table 15.2.1, as GSAS-II stores them (GSASIIlattice.BOH), to l = 16.
 */
const BOH: Record<number, number[][]> = {
  2: [[], [], []],
  4: [[0.3046972, 0.36418281], [], []],
  6: [[-0.1410474, 0.52775103], [], []],
  8: [[0.28646862, 0.21545346, 0.32826995], [], []],
  10: [[-0.16413497, 0.33078546, 0.39371345], [], []],
  12: [
    [0.26141975, 0.27266871, 0.0327746, 0.32589402],
    [0.09298802, -0.23773812, 0.49446631, 0.0],
    [],
  ],
  14: [[-0.17557309, 0.25821932, 0.27709173, 0.3364536], [], []],
  16: [
    [0.24370673, 0.29873515, 0.06447688, 0.00377, 0.32574495],
    [0.12039646, -0.25330128, 0.23950998, 0.40962508, 0.0],
    [],
  ],
};

/** The crystal harmonic k_l^n(φ, β) of the Laue class (GSASIIlattice.GetKcl), degrees. */
export function crystalHarmonic(
  l: number,
  n: number,
  laue: TextureLaue,
  phi: number,
  beta: number,
): number {
  if (laue === 'm3' || laue === 'm3m') {
    const row = (BOH[l] as number[][])[n - 1] as number[];
    let k = 0;
    for (let j = 0; j <= l; j += 4)
      k += (row[j / 4] as number) * plmpsi(l, j, phi) * Math.cos(j * beta * RAD);
    return k;
  }
  let p = plmpsi(l, n, phi) * RSQ2PI;
  if (n !== 0) p *= SQ2;
  // Classes with mirrors take one real harmonic: cos(nβ), or sin(nβ) for n = 3, 9, … in 3m1 and
  // 3mR, where the mirror turns β into −β + a multiple of 60° (h+2k, √3h axes) or 180° − β
  // (rhombohedral axes). GSAS-II lists ['mmm','4/mmm','6/mmm','R3mR','3m1','31m'] and gives 31m
  // the sine as well: '3mR' then falls to the general cos + sin below and the 31m terms with
  // n = 3, 9, … change sign under the mirror (h k l) → (k h l); both are corrected here, so that
  // equivalent reflections get the same correction (tests/texture.test.ts).
  if (
    laue === 'mmm' ||
    laue === '4/mmm' ||
    laue === '6/mmm' ||
    laue === '3m1' ||
    laue === '31m' ||
    laue === '3mR'
  ) {
    if ((laue === '3m1' || laue === '3mR') && n % 6 === 3) return p * Math.sin(n * beta * RAD);
    return p * Math.cos(n * beta * RAD);
  }
  return p * (Math.cos(n * beta * RAD) + Math.sin(n * beta * RAD));
}

/** The sample harmonic k_l^0(ψ) for cylindrical symmetry (GSASIIlattice.GetKsl, M = 0). */
export function sampleHarmonic(l: number, psi: number): number {
  return plmpsi(l, 0, psi) * RSQ2PI;
}

/** Reciprocal metric tensor G* of a cell (Å⁻²), row-major 3 × 3. */
function reciprocalMetric(cell: Cell): number[] {
  const { a, b, c } = cell;
  const [ca, cb, cg] = [cell.alpha, cell.beta, cell.gamma].map((t) => Math.cos(t * RAD)) as [
    number,
    number,
    number,
  ];
  const g = [
    a * a,
    a * b * cg,
    a * c * cb,
    a * b * cg,
    b * b,
    b * c * ca,
    a * c * cb,
    b * c * ca,
    c * c,
  ];
  const [g0, g1, g2, , g4, g5, , , g8] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = g0 * (g4 * g8 - g5 * g5) - g1 * (g1 * g8 - g5 * g2) + g2 * (g1 * g5 - g4 * g2);
  return [
    (g4 * g8 - g5 * g5) / det,
    (g2 * g5 - g1 * g8) / det,
    (g1 * g5 - g2 * g4) / det,
    (g2 * g5 - g1 * g8) / det,
    (g0 * g8 - g2 * g2) / det,
    (g1 * g2 - g0 * g5) / det,
    (g1 * g5 - g2 * g4) / det,
    (g1 * g2 - g0 * g5) / det,
    (g0 * g4 - g1 * g1) / det,
  ];
}

const inner = (gs: number[], u: Hkl, v: Hkl) => {
  let s = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      s += (u[i] as number) * (gs[3 * i + j] as number) * (v[j] as number);
  return s;
};

/**
 * Polar angle φ and azimuth β of the reciprocal vector h in the crystal, degrees, with GSAS-II's
 * axes (GSASIIlattice.CrsAng): φ from c* (from b* or a* for a monoclinic cell with that unique
 * axis), β from a* towards b* (from c* towards a* for unique axis b, from b* towards c* for unique
 * axis a), and GSAS-II's own azimuth formulas for the cubic, hexagonal, trigonal and rhombohedral
 * classes. Cell lengths in Å and angles in degrees.
 *
 * For triclinic and monoclinic cells β is the exact azimuth of h* in the plane normal to the
 * polar axis (orthonormal axes by Gram–Schmidt in the reciprocal metric). GSAS-II there uses
 * atan2(k a/(b − h cos γ), h sin²γ) and its analogues, which equal it only when the cell angles
 * are 90°; otherwise they are not linear in h k l, so a reflection and its equivalent under the
 * 2-fold axis get different β and different corrections. The exact azimuth keeps them equal.
 */
export function crystalAngles(hkl: Hkl, cell: Cell, symmetry: TextureSymmetry): [number, number] {
  const gs = reciprocalMetric(cell);
  const { laue, unique } = symmetry;
  const [h, k, l] = hkl;
  const e = (i: number): Hkl => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
  // Polar axis, then the axes β is measured from and towards.
  const [polar, from, towards] =
    laue === '2/m' && unique === 'a'
      ? [0, 1, 2]
      : laue === '2/m' && unique === 'b'
        ? [1, 2, 0]
        : [2, 0, 1];
  // The 3-fold axis [111] of rhombohedral axes (GSAS-II means to use it, H4, but its test of the
  // Laue class names 'R3' and 'R3m', which do not occur, so it falls back to c*).
  const axis: Hkl = laue === '3R' || laue === '3mR' ? [1, 1, 1] : e(polar);
  const norm = Math.sqrt(inner(gs, hkl, hkl));
  const cosPhi = inner(gs, hkl, axis) / Math.sqrt(inner(gs, axis, axis)) / norm;
  const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi))) / RAD;
  let ba: number;
  let bb: number;
  if (laue === '-1' || laue === '2/m') {
    // Orthonormal z (polar), x (towards `from`), y (towards `towards`), as coefficient vectors.
    const sub = (u: number[], v: number[], f: number) => u.map((t, i) => t - f * (v[i] as number));
    const unit = (u: number[]) => u.map((t) => t / Math.sqrt(inner(gs, u as Hkl, u as Hkl)));
    const z = unit(axis);
    const xRaw = e(from);
    const x = unit(sub(xRaw, z, inner(gs, xRaw, z as Hkl)));
    const yRaw = e(towards);
    const y = unit(sub(sub(yRaw, z, inner(gs, yRaw, z as Hkl)), x, inner(gs, yRaw, x as Hkl)));
    ba = inner(gs, hkl, y as Hkl);
    bb = inner(gs, hkl, x as Hkl);
  } else if (laue === 'mmm' || laue === '4/m' || laue === '4/mmm') {
    ba = k * cell.a;
    bb = h * cell.b;
  } else if (laue === '3R' || laue === '3mR') {
    ba = h + k - 2 * l;
    bb = SQ3 * (h - k);
  } else if (laue === 'm3' || laue === 'm3m') {
    ba = k;
    bb = h;
  } else {
    ba = h + 2 * k;
    bb = SQ3 * h;
  }
  return [phi, Math.atan2(ba, bb) / RAD];
}

/** k_l^n of every term for one reflection, and k_l^0(ψ) of every l, ready to multiply. */
export function textureBasis(
  terms: readonly (readonly [number, number])[],
  hkl: Hkl,
  cell: Cell,
  symmetry: TextureSymmetry,
  psi: number,
): number[] {
  const [phi, beta] = crystalAngles(hkl, cell, symmetry);
  return terms.map(
    ([l, n]) =>
      ((4 * Math.PI) / (2 * l + 1)) *
      crystalHarmonic(l, n, symmetry.laue, phi, beta) *
      sampleHarmonic(l, psi),
  );
}

/** A(h) = 1 + Σ C · basis (see the header). */
export function textureCorrection(
  coefficients: ArrayLike<number>,
  basis: readonly number[],
): number {
  let a = 1;
  basis.forEach((v, i) => (a += (coefficients[i] as number) * v));
  return a;
}

/** Texture index J = 1 + Σ C²/(2l + 1) and its standard uncertainty from those of C. */
export function textureIndex(
  terms: readonly (readonly [number, number])[],
  values: readonly number[],
  esds: readonly number[],
): { value: number; esd: number } {
  let j = 1;
  let variance = 0;
  terms.forEach(([l], i) => {
    const c = values[i] as number;
    j += (c * c) / (2 * l + 1);
    variance += ((2 * c * (esds[i] ?? 0)) / (2 * l + 1)) ** 2;
  });
  return { value: j, esd: Math.sqrt(variance) };
}
