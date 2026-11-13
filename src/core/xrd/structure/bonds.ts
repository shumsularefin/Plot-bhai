/*
 * Bond lengths and bond angles of a crystal structure with their standard uncertainties,
 * propagated from the covariance of the cell parameters and the atom coordinates.
 *
 * Positions are fractional, lengths in Å, angles in degrees. The parameter vector p of the
 * covariance is [a, b, c (Å), α, β, γ (degrees), x₁, y₁, z₁, x₂, … (fractions)] for the atoms of
 * the asymmetric unit in their given order. For a function f(p) the linear (first-order)
 * propagation is σ²(f) = gᵀ C g, g = ∂f/∂p, with the derivatives below taken analytically.
 */

import { parseSymop, type Symop } from '../reference/symmetry.ts';
import type { Cell } from '../reference/powder.ts';
import { applySymop, BOND_TOLERANCE, directMetric, type Vec3 } from './geometry.ts';

type Matrix3 = [number, number, number, number, number, number, number, number, number];

const RAD = Math.PI / 180;
/** Pairs closer than this (Å) are partly occupied alternatives of one site, not a bond. */
const MIN_BOND = 0.5;
/** Two images closer than this (fractional) are the same position (an atom on a special site). */
const SAME = 1e-4;

export interface GeometryAtom {
  label: string;
  element: string;
  x: Vec3;
  occupancy: number;
}

/** A structure and the covariance of its parameters, as the refinement reports it. */
export interface StructureGeometry {
  cell: Cell;
  /** Symmetry operators in CIF notation, in the order of the file (the symmetry codes use it). */
  ops: string[];
  atoms: GeometryAtom[];
  /**
   * Covariance of p = [a, b, c, α, β, γ, x₁, y₁, z₁, …] (units Å, degrees, fractions), row-major,
   * size (6 + 3N)²; zero rows and columns for parameters that were not refined.
   */
  covariance: number[];
}

export interface Bond {
  /** Asymmetric-unit atom at the origin of the bond. */
  from: number;
  /** Asymmetric-unit atom the target is an image of. */
  to: number;
  /** Operator index (0-based, file order) and lattice translation of the target: R x + t + n. */
  op: number;
  n: Vec3;
  /** CIF symmetry code of the target, "2_655" (operator 2, translation +1, 0, 0); "." for 1_555. */
  symmetry: string;
  /** Length (Å) and its standard uncertainty (Å). */
  length: number;
  su: number;
  /** ∂length/∂p, for the uncertainty of quantities built from several bonds. */
  gradient: Float64Array;
}

export interface BondAngle {
  /** Central atom (asymmetric unit) and the two bonds from it (indices into the bond list). */
  at: number;
  first: number;
  second: number;
  /** Angle (degrees) and its standard uncertainty (degrees; NaN at 0° or 180°). */
  value: number;
  su: number;
}

/** CIF geometry symmetry code: operator number (1-based) and 5 + each translation. */
export function symmetryCode(op: number, n: Vec3): string {
  return op === 0 && n.every((v) => v === 0) ? '.' : `${op + 1}_${n.map((v) => 5 + v).join('')}`;
}

/**
 * ∂G/∂p for the six cell parameters (Å for lengths, degrees for angles), with
 * G = [[a², ab cos γ, ac cos β], [ab cos γ, b², bc cos α], [ac cos β, bc cos α, c²]].
 */
export function metricDerivatives(cell: Cell): Matrix3[] {
  const { a, b, c } = cell;
  const [ca, cb, cg] = [cell.alpha, cell.beta, cell.gamma].map((v) => Math.cos(v * RAD)) as Vec3;
  const [sa, sb, sg] = [cell.alpha, cell.beta, cell.gamma].map((v) => Math.sin(v * RAD)) as Vec3;
  const sym = (g11: number, g22: number, g33: number, g12: number, g13: number, g23: number) =>
    [g11, g12, g13, g12, g22, g23, g13, g23, g33] as Matrix3;
  return [
    sym(2 * a, 0, 0, b * cg, c * cb, 0),
    sym(0, 2 * b, 0, a * cg, 0, c * ca),
    sym(0, 0, 2 * c, 0, a * cb, b * ca),
    sym(0, 0, 0, 0, 0, -b * c * sa * RAD),
    sym(0, 0, 0, 0, -a * c * sb * RAD, 0),
    sym(0, 0, 0, -a * b * sg * RAD, 0, 0),
  ];
}

const times = (m: readonly number[], v: Vec3): Vec3 =>
  [0, 1, 2].map(
    (i) =>
      (m[i * 3] as number) * v[0] +
      (m[i * 3 + 1] as number) * v[1] +
      (m[i * 3 + 2] as number) * v[2],
  ) as Vec3;
/** Rᵀ v. */
const transposeTimes = (m: readonly number[], v: Vec3): Vec3 =>
  [0, 1, 2].map(
    (i) => (m[i] as number) * v[0] + (m[3 + i] as number) * v[1] + (m[6 + i] as number) * v[2],
  ) as Vec3;
const dot3 = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const quadratic = (g: readonly number[], u: Vec3, v: Vec3) => dot3(u, times(g, v));

/** σ = √(gᵀ C g) for a covariance of size m × m. */
export function propagate(gradient: ArrayLike<number>, covariance: readonly number[]): number {
  const m = gradient.length;
  let variance = 0;
  for (let i = 0; i < m; i++) {
    const gi = gradient[i] as number;
    if (gi === 0) continue;
    for (let j = 0; j < m; j++)
      variance += gi * (covariance[i * m + j] as number) * (gradient[j] as number);
  }
  return Math.sqrt(Math.max(variance, 0));
}

/** The image R x + t + n of an atom, with the operator applied. */
interface Image {
  op: number;
  n: Vec3;
  x: Vec3;
}

/**
 * Every bond from each atom of the asymmetric unit: targets are all images R x_j + t + n of every
 * atom j (all operators of the file, translations that bring the image within ±1.5 cells of the
 * origin atom), kept when MIN_BOND < d ≤ limit(i, j). Images that coincide (an atom on a special
 * position reached by several operators) are counted once. Each bond is listed from both ends.
 *
 * Length d = √(Δᵀ G Δ), Δ = R x_j + t + n − x_i, with the derivatives
 *   ∂d/∂x_i = −G Δ / d,   ∂d/∂x_j = Rᵀ G Δ / d   (both added when i = j),
 *   ∂d/∂p_cell = Δᵀ (∂G/∂p) Δ / (2d).
 */
export function findBonds(
  geometry: StructureGeometry,
  limit: (from: GeometryAtom, to: GeometryAtom) => number,
): Bond[] {
  const { cell, atoms, covariance } = geometry;
  const ops: Symop[] = geometry.ops.map(parseSymop);
  const g = directMetric(cell);
  const dG = metricDerivatives(cell);
  const m = 6 + 3 * atoms.length;
  const out: Bond[] = [];
  atoms.forEach((origin, i) => {
    atoms.forEach((target, j) => {
      const max = limit(origin, target);
      if (!(max > MIN_BOND)) return;
      const images: Image[] = [];
      ops.forEach((op, k) => {
        const raw = applySymop(op, target.x);
        const base = raw.map((v, q) => -Math.round(v - (origin.x[q] as number))) as Vec3;
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (let c = -1; c <= 1; c++) {
              const n: Vec3 = [base[0] + a, base[1] + b, base[2] + c];
              const x = raw.map((v, q) => v + (n[q] as number)) as Vec3;
              if (images.some((im) => im.x.every((v, q) => Math.abs(v - (x[q] as number)) < SAME)))
                continue;
              images.push({ op: k, n, x });
            }
      });
      for (const image of images) {
        const delta = image.x.map((v, q) => v - (origin.x[q] as number)) as Vec3;
        const gd = times(g, delta);
        const length = Math.sqrt(dot3(delta, gd));
        if (!(length > MIN_BOND && length <= max)) continue;
        const gradient = new Float64Array(m);
        dG.forEach((d, q) => (gradient[q] = quadratic(d, delta, delta) / (2 * length)));
        const rot = (ops[image.op] as Symop).rot;
        const toTarget = transposeTimes(rot, gd);
        for (let q = 0; q < 3; q++) {
          gradient[6 + 3 * i + q] =
            (gradient[6 + 3 * i + q] as number) - (gd[q] as number) / length;
          gradient[6 + 3 * j + q] =
            (gradient[6 + 3 * j + q] as number) + (toTarget[q] as number) / length;
        }
        out.push({
          from: i,
          to: j,
          op: image.op,
          n: image.n,
          symmetry: symmetryCode(image.op, image.n),
          length,
          su: propagate(gradient, covariance),
          gradient,
        });
      }
    });
  });
  return out.sort((p, q) => p.from - q.from || p.length - q.length);
}

/**
 * Angle at the origin atom between every two bonds from it, with u, v the two bond vectors:
 *   cos φ = uᵀ G v / (|u| |v|),   ∂φ/∂p = −(1/sin φ) ∂cos φ/∂p,
 *   ∂cos φ/∂u = G v/(|u||v|) − cos φ · G u/|u|²  (and the same with u, v swapped),
 *   ∂cos φ/∂p_cell = uᵀ G′ v/(|u||v|) − (cos φ / 2)(uᵀ G′ u/|u|² + vᵀ G′ v/|v|²),
 * with ∂u/∂x_i = −1 and ∂u/∂x_j = R_j for the target image R_j x_j + t + n. At 0° or 180° the
 * first-order uncertainty is undefined (sin φ = 0) and NaN is reported.
 */
export function findAngles(geometry: StructureGeometry, bonds: readonly Bond[]): BondAngle[] {
  const { cell, atoms, covariance } = geometry;
  const ops: Symop[] = geometry.ops.map(parseSymop);
  const g = directMetric(cell);
  const dG = metricDerivatives(cell);
  const m = 6 + 3 * atoms.length;
  const vector = (bond: Bond): Vec3 => {
    const x = applySymop(ops[bond.op] as Symop, (atoms[bond.to] as GeometryAtom).x, bond.n);
    const o = (atoms[bond.from] as GeometryAtom).x;
    return [x[0] - o[0], x[1] - o[1], x[2] - o[2]];
  };
  const out: BondAngle[] = [];
  for (let p = 0; p < bonds.length; p++) {
    const bp = bonds[p] as Bond;
    for (let q = p + 1; q < bonds.length; q++) {
      const bq = bonds[q] as Bond;
      if (bq.from !== bp.from) continue;
      const u = vector(bp);
      const v = vector(bq);
      const gu = times(g, u);
      const gv = times(g, v);
      const uu = dot3(u, gu);
      const vv = dot3(v, gv);
      const norm = Math.sqrt(uu * vv);
      const cos = Math.max(-1, Math.min(1, dot3(u, gv) / norm));
      const value = Math.acos(cos) / RAD;
      const sin = Math.sqrt(1 - cos * cos);
      let su = NaN;
      if (sin > 1e-9) {
        const grad = new Float64Array(m);
        dG.forEach(
          (d, k) =>
            (grad[k] =
              quadratic(d, u, v) / norm -
              (cos / 2) * (quadratic(d, u, u) / uu + quadratic(d, v, v) / vv)),
        );
        const du = [0, 1, 2].map(
          (k) => (gv[k] as number) / norm - (cos * (gu[k] as number)) / uu,
        ) as Vec3;
        const dv = [0, 1, 2].map(
          (k) => (gu[k] as number) / norm - (cos * (gv[k] as number)) / vv,
        ) as Vec3;
        const ru = transposeTimes((ops[bp.op] as Symop).rot, du);
        const rv = transposeTimes((ops[bq.op] as Symop).rot, dv);
        const at = 6 + 3 * bp.from;
        for (let k = 0; k < 3; k++) {
          grad[at + k] = (grad[at + k] as number) - (du[k] as number) - (dv[k] as number);
          grad[6 + 3 * bp.to + k] = (grad[6 + 3 * bp.to + k] as number) + (ru[k] as number);
          grad[6 + 3 * bq.to + k] = (grad[6 + 3 * bq.to + k] as number) + (rv[k] as number);
        }
        // φ in degrees: ∂φ/∂p = −(180/π) ∂cos φ/∂p / sin φ.
        for (let k = 0; k < m; k++) grad[k] = -(grad[k] as number) / sin / RAD;
        su = propagate(grad, covariance);
      }
      out.push({ at: bp.from, first: p, second: q, value, su });
    }
  }
  return out;
}

/** Bond limit used by the viewer and the restraints: r_i + r_j + 0.45 Å (covalent radii). */
export function covalentLimit(
  radii: Readonly<Record<string, number>>,
  tolerance = BOND_TOLERANCE,
): (from: GeometryAtom, to: GeometryAtom) => number {
  return (from, to) => (radii[from.element] ?? NaN) + (radii[to.element] ?? NaN) + tolerance;
}
