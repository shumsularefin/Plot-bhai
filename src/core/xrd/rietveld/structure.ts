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
 * Free coordinates: an atom on a special position x₀ is left unchanged by its stabiliser, the
 * operators (R, t) with R x₀ + t ≡ x₀ (mod 1). A shift δ keeps it there when R δ = δ for each of
 * them, so the allowed shifts are the null space of the stacked (R − I): x = x₀ + Σ c_i v_i with the
 * basis vectors v_i and refined coefficients c_i (for example x, x, x on a 3-fold axis has one).
 *
 * Bond restraints (optional): each bond present at the start (0.5 Å < d ≤ r₁ + r₂ + 0.45 Å,
 * covalent radii) adds the pseudo-observation (d − d₀)/σ, σ = 0.02 Å, which keeps the bonds close
 * to their starting lengths while the pattern moves the atoms.
 */

import { applySymop, distance, type Vec3 } from '../structure/geometry';
import { parseSymop, type Symop } from '../reference/symmetry';
import { expandAtoms, type Cell, type FormFactor, type FormFactors } from '../reference/powder';
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
  /** True for atoms with anisotropic U: their displacement is kept, B is not refined. */
  anisotropic: boolean;
  images: Image[];
  factor: FormFactor;
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
}

const EPS = 1e-4;
const wrapDiff = (v: number) => v - Math.round(v);

/** Null space of a stack of 3-column rows (Gaussian elimination), as basis vectors. */
export function nullSpace(rows: number[][]): Vec3[] {
  const a = rows.map((r) => [...r]);
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < 3 && row < a.length; col++) {
    let best = row;
    for (let r = row + 1; r < a.length; r++)
      if (Math.abs(a[r]?.[col] as number) > Math.abs(a[best]?.[col] as number)) best = r;
    if (Math.abs(a[best]?.[col] as number) < 1e-9) continue;
    [a[row], a[best]] = [a[best] as number[], a[row] as number[]];
    const pr = a[row] as number[];
    const pv = pr[col] as number;
    for (let j = 0; j < 3; j++) pr[j] = (pr[j] as number) / pv;
    for (let r = 0; r < a.length; r++) {
      if (r === row) continue;
      const other = a[r] as number[];
      const f = other[col] as number;
      for (let j = 0; j < 3; j++) other[j] = (other[j] as number) - f * (pr[j] as number);
    }
    pivots.push(col);
    row++;
  }
  const out: Vec3[] = [];
  for (let free = 0; free < 3; free++) {
    if (pivots.includes(free)) continue;
    const v: Vec3 = [0, 0, 0];
    v[free] = 1;
    pivots.forEach((col, r) => (v[col] = -((a[r] as number[])[free] as number)));
    out.push(v);
  }
  return out;
}

/** Builds the structure model; atoms whose element has no scattering factor make it throw. */
export function structureModel(
  cell: Cell,
  structure: StoredStructure,
  factors: FormFactors,
  radii: Readonly<Record<string, number>>,
): StructureModel {
  const ops = structure.ops.map(parseSymop);
  const atoms: StructureAtom[] = structure.atoms.map((atom) => {
    const factor = factors[atom.element];
    if (!factor) throw new Error(`no scattering factor for ${atom.element}`);
    const sites = expandAtoms({ cell, ops, atoms: [atom] });
    const images: Image[] = sites.map((site) => {
      const op = ops.find((g) =>
        applySymop(g, atom.x).every((v, i) => Math.abs(wrapDiff(v - (site.x[i] as number))) < 1e-3),
      ) as Symop;
      return { op, u: site.u as Matrix3 | null };
    });
    const rows: number[][] = [];
    for (const g of ops) {
      const moved = applySymop(g, atom.x);
      if (!moved.every((v, i) => Math.abs(wrapDiff(v - (atom.x[i] as number))) < EPS)) continue;
      for (let i = 0; i < 3; i++)
        rows.push([0, 1, 2].map((j) => (g.rot[i * 3 + j] as number) - (i === j ? 1 : 0)));
    }
    return {
      label: atom.label,
      element: atom.element,
      x0: [...atom.x] as Vec3,
      basis: nullSpace(rows),
      occupancy0: atom.occupancy,
      b0: atom.uIso === null ? 0 : 8 * Math.PI ** 2 * atom.uIso,
      anisotropic: atom.uAniso !== null,
      images,
      factor,
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

/** |F(h)|² for the current atom states (d in Å). */
export function structureFactorSquared(
  model: StructureModel,
  states: readonly AtomState[],
  [h, k, l]: Hkl,
  d: number,
): number {
  const s2 = 1 / (4 * d * d);
  let re = 0;
  let im = 0;
  model.atoms.forEach((atom, a) => {
    const state = states[a] as AtomState;
    const f = scatter(atom.factor, s2);
    for (const image of atom.images) {
      let t: number;
      if (image.u) {
        const u = image.u;
        const q =
          h * h * u[0] +
          k * k * u[4] +
          l * l * u[8] +
          2 * (h * k * u[1] + h * l * u[2] + k * l * u[5]);
        t = Math.exp(-2 * Math.PI ** 2 * q);
      } else t = Math.exp(-state.b * s2);
      const x = applySymop(image.op, state.x);
      const phase = 2 * Math.PI * (h * x[0] + k * x[1] + l * x[2]);
      const amplitude = state.occupancy * f * t;
      re += amplitude * Math.cos(phase);
      im += amplitude * Math.sin(phase);
    }
  });
  return re * re + im * im;
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
