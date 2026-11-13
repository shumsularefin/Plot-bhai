/*
 * Structure model for Rietveld structure refinement: atom positions (only the coordinates the
 * site symmetry leaves free), site occupancies and isotropic displacement parameters B (Å²).
 *
 * Structure factor of reflection h = (h k l), electron units:
 *   F(h) = Σ_atoms Σ_images  o · f(s) · T · exp(2πi h·x'),   x' = R x + t   (each image of the atom)
 *   f(s) = Σ_{i=1..4} a_i exp(−b_i s²) + c,   s = sin θ / λ = 1/(2d)   (Å⁻¹)
 *   T    = exp(−B s²) for isotropic atoms (B = 8π² U), or exp(−2π² hᵀ u h) for anisotropic ones,
 *          u the dimensionless tensor rotated to each image (as in reference/powder.ts).
 * A family's Σ|F|² is the sum of |F|² over its members (all reflections equivalent under the
 * lattice symmetry), which replaces the reference value when the structure is refined.
 *
 * Special positions: each atom is first moved onto the exact special position its coordinates
 * stand for (specialPosition below; 0.3333 becomes 1/3), so its images coincide exactly.
 *
 * Free coordinates: an atom on a special position x₀ is left unchanged by its stabiliser, the
 * operators (R, t) with R x₀ + t ≡ x₀ (mod 1). A shift δ keeps it there when R δ = δ for each of
 * them, so the allowed shifts are the null space of the stacked (R − I): x = x₀ + Σ c_i v_i with the
 * basis vectors v_i and refined coefficients c_i (for example x, x, x on a 3-fold axis has one).
 *
 * Anisotropic displacement (optional): the dimensionless tensor u = a*_i a*_j U_ij (U the CIF
 * U_ij, Å²) of an image is R u Rᵀ, so the site symmetry allows the u with R u Rᵀ = u for every
 * operator of the stabiliser; as for positions, the allowed changes are the null space of the
 * stacked linear maps u ↦ R u Rᵀ − u (on the 6 independent components). The refined
 * coefficients are in Å² of U. An isotropic atom made anisotropic starts from u = U_iso G*
 * (G* the reciprocal metric), which gives the same T = exp(−2π² U_iso / d²).
 *
 * Substitution on a shared site (optional, for doped materials): a second element shares an
 * atom's site, coordinates and displacement parameters, and the site's scattering factor becomes
 *   f_site(s) = (1 − x) f_host(s) + x f_dopant(s)
 * with x the refined fraction of the site taken by the dopant (0 to 1). The total occupancy of the
 * site stays that of the file, so x is the composition on the site (for example x in
 * Zn₁₋ₓCoₓO). This is GSAS-II's constraint of two atoms on one site with Frac₁ + Frac₂ fixed and
 * equal positions and U, written as one atom.
 *
 * Anomalous dispersion (optional): each atom's f(s) becomes f(s) + f′ + i f″, with f′ and f″
 * (electrons) for the wavelength used, independent of s (data/reference/anomalous-dispersion.json,
 * Cromer–Liberman values computed by GSAS-II). With
 *   A  = Σ (f + f′) T cos φ,   B  = Σ (f + f′) T sin φ,   A″ = Σ f″ T cos φ,   B″ = Σ f″ T sin φ
 * (φ = 2π h·x', over every image of every atom), F(h) = (A − B″) + i(B + A″) and F(−h) =
 * (A + B″) + i(A″ − B). A powder pattern adds h and −h, so the value used is their mean
 *   |F|² = A² + B² + A″² + B″²,
 * as in GSAS-II's StructureFactor2. For a centrosymmetric structure B = B″ = 0 and f″ only adds
 * A″²; for a non-centrosymmetric one this is the Friedel average. f″ also multiplies the same
 * occupancy and displacement factor T as f.
 *
 * Bond restraints (optional): each bond present at the start (0.5 Å < d ≤ r₁ + r₂ + 0.45 Å,
 * covalent radii) adds the pseudo-observation (d − d₀)/σ, σ = 0.02 Å, which keeps the bonds close
 * to their starting lengths while the pattern moves the atoms.
 */

import { applySymop, distance, type Vec3 } from '../structure/geometry';
import { parseSymop, type Symop } from '../reference/symmetry';
import {
  expandAtoms,
  reciprocalMetric,
  type Cell,
  type FormFactor,
  type FormFactors,
} from '../reference/powder';
import type { StoredStructure } from '../reference/types';
import type { Hkl } from './reflections';

type Matrix3 = [number, number, number, number, number, number, number, number, number];

export const RESTRAINT_SIGMA = 0.02;
const BOND_TOLERANCE = 0.45;
const MAX_RESTRAINTS = 300;

interface Image {
  op: Symop;
  /** Rotated dimensionless u tensor for anisotropic atoms, or null. */
  u: Matrix3 | null;
}

export interface StructureAtom {
  label: string;
  element: string;
  x0: Vec3;
  /** Directions in which the site symmetry lets the atom move (fractional). */
  basis: Vec3[];
  occupancy0: number;
  /** Starting B (Å²): 8π² U_iso, or 0 when the file gave none. */
  b0: number;
  /** True for atoms with anisotropic U: B is not refined for them. */
  anisotropic: boolean;
  /** Starting dimensionless u (row-major) for anisotropic atoms, else null. */
  u0: Matrix3 | null;
  /** Allowed changes of u per Å² of CIF U_ij coefficient (empty for isotropic atoms). */
  uBasis: Matrix3[];
  /** The same in CIF U (11, 22, 33, 12, 13, 23; Å²), and the starting CIF U. */
  uBasisCif: number[][];
  uCif0: number[] | null;
  images: Image[];
  factor: FormFactor;
  /** Anomalous dispersion f′, f″ (electrons) of the element; [0, 0] when not used. */
  dispersion: readonly [number, number];
  /** A second element on the same site (doping), or undefined. */
  substitute?: {
    element: string;
    factor: FormFactor;
    dispersion: readonly [number, number];
    fraction0: number;
    refine: boolean;
  };
}

/** A dopant placed on a site of the structure: the atom label, its element and the fraction x. */
export interface Substitution {
  site: string;
  element: string;
  /** Starting (or fixed) fraction of the site taken by the dopant, 0 to 1. */
  fraction: number;
  /** Refine x, or keep it at the given value. */
  refine: boolean;
}

export interface Restraint {
  /** Atom indices and the operator and lattice translation applied to the second atom. */
  i: number;
  j: number;
  op: Symop;
  n: Vec3;
  /** Starting distance, Å. */
  d0: number;
}

export interface StructureModel {
  atoms: StructureAtom[];
  restraints: Restraint[];
}

/** Current values of one atom's refinable quantities. */
export interface AtomState {
  x: Vec3;
  occupancy: number;
  b: number;
  /** Fraction of the site taken by the substituting element (0 without one). */
  fraction?: number;
  /** Dimensionless u of each image, in the order of StructureAtom.images (anisotropic atoms). */
  uImages?: Matrix3[];
}

/** Indices (i, j) of the 6 independent components 11, 22, 33, 12, 13, 23. */
const PAIRS: [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 2],
  [0, 1],
  [0, 2],
  [1, 2],
];

/** R u Rᵀ for a row-major rotation R and symmetric u. */
export function rotateTensor(r: readonly number[], u: readonly number[]): Matrix3 {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++)
        for (let l = 0; l < 3; l++)
          s += (r[i * 3 + k] as number) * (u[k * 3 + l] as number) * (r[j * 3 + l] as number);
      out[i * 3 + j] = s;
    }
  return out as Matrix3;
}

const symmetric = (v: readonly number[]): Matrix3 => {
  const m = new Array<number>(9).fill(0);
  PAIRS.forEach(([i, j], k) => {
    m[i * 3 + j] = v[k] as number;
    m[j * 3 + i] = v[k] as number;
  });
  return m as Matrix3;
};

/** u = u0 + Σ c_k uBasis_k, or null for an isotropic atom. */
export function atomTensor(atom: StructureAtom, c: readonly number[]): Matrix3 | null {
  if (!atom.u0) return null;
  const u = [...atom.u0] as Matrix3;
  atom.uBasis.forEach((v, k) => {
    for (let i = 0; i < 9; i++) u[i] = (u[i] as number) + (c[k] ?? 0) * (v[i] as number);
  });
  return u;
}

/** True when the symmetric tensor is positive definite (Sylvester's criterion). */
export function positiveDefinite(u: readonly number[]): boolean {
  const [a, b, c, , e, f, , , i] = u as Matrix3;
  const m1 = a;
  const m2 = a * e - b * b;
  const m3 = a * (e * i - f * f) - b * (b * i - f * c) + c * (b * f - e * c);
  return m1 > 0 && m2 > 0 && m3 > 0;
}

/**
 * Tolerance (fractional) for an operator to map an atom onto itself. CIF coordinates are often
 * given to 3 decimals (0.333 for 1/3), and an image can then be off by up to 3 × 0.0005, so
 * 0.002 (0.02 Å in a 10 Å cell).
 */
const EPS = 2e-3;
const wrapDiff = (v: number) => v - Math.round(v);

/**
 * The exact special position near x: the mean of its images under the operators that map it onto
 * itself within EPS, each image taken nearest to x. The images of a point under its stabiliser
 * are permuted by every operator of it, so their mean is fixed by all of them (a CIF's 0.3333
 * becomes 1/3, as in GSAS-II). A general position is returned unchanged.
 */
export function specialPosition(ops: readonly Symop[], x: Vec3): Vec3 {
  const sum = [0, 0, 0];
  let n = 0;
  for (const g of ops) {
    const shift = applySymop(g, x).map((v, i) => wrapDiff(v - (x[i] as number)));
    if (!shift.every((v) => Math.abs(v) < EPS)) continue;
    shift.forEach((v, i) => (sum[i] = (sum[i] as number) + (x[i] as number) + v));
    n++;
  }
  return n > 0 ? (sum.map((v) => v / n) as Vec3) : x;
}

/** Null space of a stack of n-column rows (Gaussian elimination), as basis vectors. */
export function nullSpace(rows: number[][], n = 3): number[][] {
  const a = rows.map((r) => [...r]);
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < n && row < a.length; col++) {
    let best = row;
    for (let r = row + 1; r < a.length; r++)
      if (Math.abs(a[r]?.[col] as number) > Math.abs(a[best]?.[col] as number)) best = r;
    if (Math.abs(a[best]?.[col] as number) < 1e-9) continue;
    [a[row], a[best]] = [a[best] as number[], a[row] as number[]];
    const pr = a[row] as number[];
    const pv = pr[col] as number;
    for (let j = 0; j < n; j++) pr[j] = (pr[j] as number) / pv;
    for (let r = 0; r < a.length; r++) {
      if (r === row) continue;
      const other = a[r] as number[];
      const f = other[col] as number;
      for (let j = 0; j < n; j++) other[j] = (other[j] as number) - f * (pr[j] as number);
    }
    pivots.push(col);
    row++;
  }
  const out: number[][] = [];
  for (let free = 0; free < n; free++) {
    if (pivots.includes(free)) continue;
    const v = new Array<number>(n).fill(0);
    v[free] = 1;
    pivots.forEach((col, r) => (v[col] = -((a[r] as number[])[free] as number)));
    out.push(v);
  }
  return out;
}

/** f′ and f″ (electrons) of each element for one wavelength. */
export type Dispersion = Readonly<Record<string, readonly [number, number]>>;

/**
 * Builds the structure model; atoms whose element has no scattering factor make it throw. With
 * `dispersion`, every element of the structure must be in it.
 */
export function structureModel(
  cell: Cell,
  structure: StoredStructure,
  factors: FormFactors,
  radii: Readonly<Record<string, number>>,
  allAnisotropic = false,
  substitutions: readonly Substitution[] = [],
  dispersion?: Dispersion,
): StructureModel {
  const dispersionOf = (element: string): readonly [number, number] => {
    if (!dispersion) return [0, 0];
    const value = dispersion[element];
    if (!value) throw new Error(`no anomalous dispersion values for ${element}`);
    return value;
  };
  for (const sub of substitutions) {
    if (!structure.atoms.some((a) => a.label === sub.site))
      throw new Error(`no site labelled ${sub.site}`);
    if (!factors[sub.element]) throw new Error(`no scattering factor for ${sub.element}`);
  }
  const ops = structure.ops.map(parseSymop);
  const gStar = reciprocalMetric(cell);
  const aStar = [Math.sqrt(gStar[0]), Math.sqrt(gStar[4]), Math.sqrt(gStar[8])];
  const atoms: StructureAtom[] = structure.atoms.map((given) => {
    const atom = { ...given, x: specialPosition(ops, given.x) };
    const factor = factors[atom.element];
    if (!factor) throw new Error(`no scattering factor for ${atom.element}`);
    const sub = substitutions.find((q) => q.site === atom.label);
    const sites = expandAtoms({ cell, ops, atoms: [atom] });
    const images: Image[] = sites.map((site) => {
      const op = ops.find((g) =>
        applySymop(g, atom.x).every((v, i) => Math.abs(wrapDiff(v - (site.x[i] as number))) < 1e-3),
      ) as Symop;
      return { op, u: null as Matrix3 | null };
    });
    const rows: number[][] = [];
    const tensorRows: number[][] = [];
    for (const g of ops) {
      const moved = applySymop(g, atom.x);
      if (!moved.every((v, i) => Math.abs(wrapDiff(v - (atom.x[i] as number))) < EPS)) continue;
      for (let i = 0; i < 3; i++)
        rows.push([0, 1, 2].map((j) => (g.rot[i * 3 + j] as number) - (i === j ? 1 : 0)));
      // Column m: R E_m Rᵀ − E_m for the unit symmetric tensor E_m; one row per component.
      const columns = PAIRS.map((_, m) => {
        const e = symmetric(PAIRS.map((__, k) => (k === m ? 1 : 0)));
        const d = rotateTensor(g.rot, e);
        return PAIRS.map(([i, j]) => (d[i * 3 + j] as number) - (e[i * 3 + j] as number));
      });
      for (let q = 0; q < 6; q++) tensorRows.push(columns.map((col) => col[q] as number));
    }
    const scaled = (v: readonly number[]) => {
      const m = symmetric(v);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          m[i * 3 + j] = (m[i * 3 + j] as number) * (aStar[i] as number) * (aStar[j] as number);
      return m;
    };
    const u0: Matrix3 | null = atom.uAniso
      ? scaled(atom.uAniso)
      : allAnisotropic
        ? (gStar.map((g) => g * (atom.uIso ?? 0)) as Matrix3)
        : null;
    // Basis in CIF U (Å²), scaled to the dimensionless u: u_ij = a*_i a*_j U_ij.
    const uBasisCif = u0 ? nullSpace(tensorRows, 6) : [];
    const uBasis = uBasisCif.map(scaled);
    const uCif0 = u0
      ? atom.uAniso
        ? [...atom.uAniso]
        : PAIRS.map(
            ([i, j]) => (u0[i * 3 + j] as number) / ((aStar[i] as number) * (aStar[j] as number)),
          )
      : null;
    for (const image of images) image.u = u0 ? rotateTensor(image.op.rot, u0) : null;
    return {
      label: atom.label,
      element: atom.element,
      x0: [...atom.x] as Vec3,
      basis: nullSpace(rows) as Vec3[],
      occupancy0: atom.occupancy,
      b0: atom.uIso === null ? 0 : 8 * Math.PI ** 2 * atom.uIso,
      anisotropic: u0 !== null,
      u0,
      uBasis,
      uBasisCif,
      uCif0,
      images,
      factor,
      dispersion: dispersionOf(atom.element),
      ...(sub && {
        substitute: {
          element: sub.element,
          factor: factors[sub.element] as FormFactor,
          dispersion: dispersionOf(sub.element),
          fraction0: Math.min(1, Math.max(0, sub.fraction)),
          refine: sub.refine,
        },
      }),
    };
  });

  // Bonds at the start: every asymmetric-unit atom to every image of every atom, translations ±1.
  const restraints: Restraint[] = [];
  atoms.forEach((ai, i) =>
    atoms.forEach((aj, j) => {
      const limit = (radii[ai.element] ?? NaN) + (radii[aj.element] ?? NaN) + BOND_TOLERANCE;
      if (!(limit > 0)) return;
      for (const image of aj.images)
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (let c = -1; c <= 1; c++) {
              const n: Vec3 = [a, b, c];
              const d0 = distance(cell, ai.x0, applySymop(image.op, aj.x0, n));
              if (d0 > 0.5 && d0 <= limit && (j > i || (j === i && d0 > 0)))
                restraints.push({ i, j, op: image.op, n, d0 });
            }
    }),
  );
  // Each bond i–j is found from both ends when i = j; keep the list bounded.
  return { atoms, restraints: restraints.slice(0, MAX_RESTRAINTS) };
}

/** Position of an atom for coefficients c along its free directions. */
export function atomPosition(atom: StructureAtom, c: readonly number[]): Vec3 {
  const x: Vec3 = [...atom.x0];
  atom.basis.forEach((v, k) => {
    for (let i = 0; i < 3; i++) x[i] = (x[i] as number) + (c[k] ?? 0) * (v[i] as number);
  });
  return x;
}

/** Scattering factor f(s) for s² = 1/(4d²). */
function scatter(f: FormFactor, s2: number): number {
  let v = f[8];
  for (let i = 0; i < 4; i++) v += (f[i] as number) * Math.exp(-(f[i + 4] as number) * s2);
  return v;
}

/**
 * |F(h)|² for the current atom states (d in Å); with anomalous dispersion, the mean of |F(h)|² and
 * |F(−h)|² (see the header).
 */
export function structureFactorSquared(
  model: StructureModel,
  states: readonly AtomState[],
  [h, k, l]: Hkl,
  d: number,
): number {
  const s2 = 1 / (4 * d * d);
  let re = 0;
  let im = 0;
  let re2 = 0;
  let im2 = 0;
  model.atoms.forEach((atom, a) => {
    const state = states[a] as AtomState;
    const sub = atom.substitute;
    const x = sub ? (state.fraction ?? sub.fraction0) : 0;
    const f = sub
      ? (1 - x) * (scatter(atom.factor, s2) + atom.dispersion[0]) +
        x * (scatter(sub.factor, s2) + sub.dispersion[0])
      : scatter(atom.factor, s2) + atom.dispersion[0];
    const fpp = sub ? (1 - x) * atom.dispersion[1] + x * sub.dispersion[1] : atom.dispersion[1];
    atom.images.forEach((image, m) => {
      let t: number;
      const u = state.uImages?.[m] ?? image.u;
      if (u) {
        const q =
          h * h * u[0] +
          k * k * u[4] +
          l * l * u[8] +
          2 * (h * k * u[1] + h * l * u[2] + k * l * u[5]);
        t = Math.exp(-2 * Math.PI ** 2 * q);
      } else t = Math.exp(-state.b * s2);
      const x = applySymop(image.op, state.x);
      const phase = 2 * Math.PI * (h * x[0] + k * x[1] + l * x[2]);
      const weight = state.occupancy * t;
      const c = Math.cos(phase);
      const sn = Math.sin(phase);
      re += weight * f * c;
      im += weight * f * sn;
      if (fpp !== 0) {
        re2 += weight * fpp * c;
        im2 += weight * fpp * sn;
      }
    });
  });
  return re * re + im * im + re2 * re2 + im2 * im2;
}

/** Number of refinable quantities of an atom, in the order of the layout (see gradient below). */
export const atomParameterCount = (atom: StructureAtom): number =>
  atom.basis.length + 3 + atom.uBasis.length;

const rotatedBases = new WeakMap<StructureAtom, Matrix3[][]>();
/** R uBasis_k Rᵀ for every image m and basis tensor k of an anisotropic atom ([m][k]). */
function imageBases(atom: StructureAtom): Matrix3[][] {
  let cached = rotatedBases.get(atom);
  if (!cached) {
    cached = atom.images.map((image) => atom.uBasis.map((v) => rotateTensor(image.op.rot, v)));
    rotatedBases.set(atom, cached);
  }
  return cached;
}

/**
 * Σ_members |F|² of a reflection family and its exact gradient with respect to every atom's
 * refinable quantities (d in Å). With A, B, A″, B″ as in the header, |F|² = A² + B² + A″² + B″²
 * and ∂|F|²/∂p = 2(A ∂A/∂p + B ∂B/∂p + A″ ∂A″/∂p + B″ ∂B″/∂p), where for one image term
 * w f cos φ (w = o T, φ = 2π h·x', x' = R(x₀ + Σ c_k v_k) + t):
 *   ∂φ/∂c_k = 2π h·(R v_k)                      (free coordinate coefficient c_k)
 *   ∂w/∂o = T                                    (occupancy)
 *   ∂T/∂B = −s² T                                (isotropic atoms; B has no effect on anisotropic ones)
 *   ∂T/∂c_k = −2π² hᵀ(R u_k Rᵀ)h T               (U_ij coefficient c_k, u_k its basis tensor)
 *   ∂f/∂x = (f_d + f′_d) − (f_h + f′_h),  ∂f″/∂x = f″_d − f″_h   (dopant fraction x)
 * The gradient is per atom in the order of the layout: coordinate coefficients, occupancy, B,
 * U_ij coefficients, dopant fraction (atomParameterCount entries per atom).
 */
export function structureFactorGradient(
  model: StructureModel,
  states: readonly AtomState[],
  members: readonly Hkl[],
  d: number,
): { value: number; gradient: Float64Array } {
  const s2 = 1 / (4 * d * d);
  const size = model.atoms.reduce((n, atom) => n + atomParameterCount(atom), 0);
  const gradient = new Float64Array(size);
  const dRe = new Float64Array(size);
  const dIm = new Float64Array(size);
  const dRe2 = new Float64Array(size);
  const dIm2 = new Float64Array(size);
  const TWO_PI = 2 * Math.PI;
  let value = 0;
  for (const [h, k, l] of members) {
    let re = 0;
    let im = 0;
    let re2 = 0;
    let im2 = 0;
    dRe.fill(0);
    dIm.fill(0);
    dRe2.fill(0);
    dIm2.fill(0);
    let offset = 0;
    model.atoms.forEach((atom, a) => {
      const state = states[a] as AtomState;
      const sub = atom.substitute;
      const x = sub ? (state.fraction ?? sub.fraction0) : 0;
      const host = scatter(atom.factor, s2) + atom.dispersion[0];
      const dopant = sub ? scatter(sub.factor, s2) + sub.dispersion[0] : 0;
      const f = sub ? (1 - x) * host + x * dopant : host;
      const fpp = sub ? (1 - x) * atom.dispersion[1] + x * sub.dispersion[1] : atom.dispersion[1];
      const df = sub ? dopant - host : 0;
      const dfpp = sub ? sub.dispersion[1] - atom.dispersion[1] : 0;
      const nc = atom.basis.length;
      const iOcc = offset + nc;
      const iB = iOcc + 1;
      const iU = iB + 1;
      const iX = iU + atom.uBasis.length;
      const bases = atom.uBasis.length > 0 ? imageBases(atom) : null;
      atom.images.forEach((image, m) => {
        const u = state.uImages?.[m] ?? image.u;
        const quad = (t: readonly number[]) =>
          h * h * (t[0] as number) +
          k * k * (t[4] as number) +
          l * l * (t[8] as number) +
          2 * (h * k * (t[1] as number) + h * l * (t[2] as number) + k * l * (t[5] as number));
        const t = u ? Math.exp(-2 * Math.PI ** 2 * quad(u)) : Math.exp(-state.b * s2);
        const xi = applySymop(image.op, state.x);
        const phase = TWO_PI * (h * xi[0] + k * xi[1] + l * xi[2]);
        const c = Math.cos(phase);
        const sn = Math.sin(phase);
        const w = state.occupancy * t;
        re += w * f * c;
        im += w * f * sn;
        re2 += w * fpp * c;
        im2 += w * fpp * sn;
        const r = image.op.rot;
        atom.basis.forEach((v, q) => {
          const rv = (i: number) =>
            (r[i * 3] as number) * (v[0] as number) +
            (r[i * 3 + 1] as number) * (v[1] as number) +
            (r[i * 3 + 2] as number) * (v[2] as number);
          const dPhase = TWO_PI * (h * rv(0) + k * rv(1) + l * rv(2));
          const j = offset + q;
          dRe[j] = (dRe[j] as number) - w * f * sn * dPhase;
          dIm[j] = (dIm[j] as number) + w * f * c * dPhase;
          dRe2[j] = (dRe2[j] as number) - w * fpp * sn * dPhase;
          dIm2[j] = (dIm2[j] as number) + w * fpp * c * dPhase;
        });
        /** Adds g·(f cos φ, f sin φ, f″ cos φ, f″ sin φ) to the derivatives of entry j. */
        const add = (j: number, g: number) => {
          dRe[j] = (dRe[j] as number) + g * f * c;
          dIm[j] = (dIm[j] as number) + g * f * sn;
          dRe2[j] = (dRe2[j] as number) + g * fpp * c;
          dIm2[j] = (dIm2[j] as number) + g * fpp * sn;
        };
        add(iOcc, t);
        if (!u) add(iB, -s2 * w);
        if (bases)
          (bases[m] as Matrix3[]).forEach((basis, q) =>
            add(iU + q, -2 * Math.PI ** 2 * quad(basis) * w),
          );
        if (sub) {
          dRe[iX] = (dRe[iX] as number) + w * df * c;
          dIm[iX] = (dIm[iX] as number) + w * df * sn;
          dRe2[iX] = (dRe2[iX] as number) + w * dfpp * c;
          dIm2[iX] = (dIm2[iX] as number) + w * dfpp * sn;
        }
      });
      offset = iX + 1;
    });
    value += re * re + im * im + re2 * re2 + im2 * im2;
    for (let j = 0; j < size; j++)
      gradient[j] =
        (gradient[j] as number) +
        2 *
          (re * (dRe[j] as number) +
            im * (dIm[j] as number) +
            re2 * (dRe2[j] as number) +
            im2 * (dIm2[j] as number));
  }
  return { value, gradient };
}

/** Restraint residuals (d − d₀)/σ for the current atom positions. */
export function restraintResiduals(
  cell: Cell,
  model: StructureModel,
  states: readonly AtomState[],
): number[] {
  return model.restraints.map((r) => {
    const xi = (states[r.i] as AtomState).x;
    const xj = applySymop(r.op, (states[r.j] as AtomState).x, r.n);
    return (distance(cell, xi, xj) - r.d0) / RESTRAINT_SIGMA;
  });
}

/**
 * Unit-cell contents with each dopant on its site: (site multiplicity) × occupancy × x atoms of
 * the host element become the dopant. `atoms` gives, per atom of the model, its occupancy and
 * dopant fraction x.
 */
export function substitutedContents(
  contents: Readonly<Record<string, number>>,
  model: StructureModel,
  atoms: readonly { occupancy: number; fraction: number }[],
): Record<string, number> {
  const out: Record<string, number> = { ...contents };
  model.atoms.forEach((atom, a) => {
    if (!atom.substitute) return;
    const state = atoms[a] as { occupancy: number; fraction: number };
    const moved = atom.images.length * state.occupancy * state.fraction;
    out[atom.element] = (out[atom.element] ?? 0) - moved;
    out[atom.substitute.element] = (out[atom.substitute.element] ?? 0) + moved;
  });
  return out;
}
