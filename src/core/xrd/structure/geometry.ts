/*
 * Crystal geometry for the structure viewer: atoms of one unit cell, bonds, interatomic
 * distances and angles. All positions are fractional coordinates; lengths are in Å and angles
 * in degrees.
 */

import { formatSymop, parseSymop, type Symop } from '../reference/symmetry.ts';
import type { Cell, Crystal } from '../reference/powder.ts';
import type { StoredStructure } from '../reference/types.ts';

export type Vec3 = [number, number, number];
type Matrix3 = [number, number, number, number, number, number, number, number, number];

const RAD = Math.PI / 180;

/**
 * Direct metric tensor G (Å²), row-major: G_ij = a_i · a_j, so that the squared length of a
 * fractional vector Δx is |r|² = Δxᵀ G Δx.
 */
export function directMetric(cell: Cell): Matrix3 {
  const { a, b, c } = cell;
  const ca = Math.cos(cell.alpha * RAD);
  const cb = Math.cos(cell.beta * RAD);
  const cg = Math.cos(cell.gamma * RAD);
  return [
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
}

/** Δxᵀ G Δy (Å²): the dot product of two fractional vectors. */
function dot(g: Matrix3, u: Vec3, v: Vec3): number {
  let s = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) s += (u[i] as number) * (g[i * 3 + j] as number) * (v[j] as number);
  return s;
}

const minus = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];

/** Distance (Å) between two fractional positions: d = √(Δxᵀ G Δx), Δx = x₂ − x₁. */
export function distance(cell: Cell, x1: Vec3, x2: Vec3): number {
  const d = minus(x2, x1);
  return Math.sqrt(dot(directMetric(cell), d, d));
}

/**
 * Angle (degrees) at the middle atom: cos φ = (u·v)/(|u||v|), u = x₁ − x₂, v = x₃ − x₂, the
 * dot products taken with the metric tensor G.
 */
export function angle(cell: Cell, x1: Vec3, x2: Vec3, x3: Vec3): number {
  const g = directMetric(cell);
  const u = minus(x1, x2);
  const v = minus(x3, x2);
  const cos = dot(g, u, v) / Math.sqrt(dot(g, u, u) * dot(g, v, v));
  return Math.acos(Math.max(-1, Math.min(1, cos))) / RAD;
}

/**
 * Orthogonalisation matrix M (Å), row-major, with r = M·x: a along Cartesian X, b in the XY
 * plane, c completing a right-handed set. M = [[a, b cos γ, c cos β], [0, b sin γ,
 * c (cos α − cos β cos γ)/sin γ], [0, 0, V/(a b sin γ)]], V the cell volume.
 */
export function cartesianMatrix(cell: Cell): Matrix3 {
  const { a, b, c } = cell;
  const ca = Math.cos(cell.alpha * RAD);
  const cb = Math.cos(cell.beta * RAD);
  const cg = Math.cos(cell.gamma * RAD);
  const sg = Math.sin(cell.gamma * RAD);
  const v = a * b * c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);
  return [a, b * cg, c * cb, 0, b * sg, (c * (ca - cb * cg)) / sg, 0, 0, v / (a * b * sg)];
}

/** Cartesian position (Å) of a fractional position. */
export function toCartesian(m: Matrix3, x: Vec3): Vec3 {
  return [
    m[0] * x[0] + m[1] * x[1] + m[2] * x[2],
    m[3] * x[0] + m[4] * x[1] + m[5] * x[2],
    m[6] * x[0] + m[7] * x[1] + m[8] * x[2],
  ];
}

/** Applies an operator and then a lattice translation: x' = R·x + t + n. */
export function applySymop(op: Symop, x: Vec3, n: Vec3 = [0, 0, 0]): Vec3 {
  const r = op.rot;
  return [0, 1, 2].map(
    (i) =>
      (r[i * 3] as number) * x[0] +
      (r[i * 3 + 1] as number) * x[1] +
      (r[i * 3 + 2] as number) * x[2] +
      op.trans[i as 0 | 1 | 2] +
      n[i as 0 | 1 | 2],
  ) as Vec3;
}

/** The parts of a parsed structure the viewer and the refinement keep, rounded for storage. */
export function storeStructure(crystal: Crystal): StoredStructure {
  const sig = (v: number) => Number(v.toPrecision(5));
  return {
    ops: crystal.ops.map(formatSymop),
    atoms: crystal.atoms.map((atom) => ({
      label: atom.label,
      element: atom.element,
      x: atom.x.map((v) => Number(v.toFixed(6))) as Vec3,
      occupancy: Number(atom.occupancy.toFixed(4)),
      uIso: atom.uIso === null ? null : sig(atom.uIso),
      uAniso: atom.uAniso
        ? (atom.uAniso.map(sig) as [number, number, number, number, number, number])
        : null,
    })),
  };
}

/** Rebuilds the crystal (cell, parsed operators, atoms) from a stored structure. */
export function crystalFromStored(cell: Cell, structure: StoredStructure): Crystal {
  return { cell, ops: structure.ops.map(parseSymop), atoms: structure.atoms };
}

export interface CellAtom {
  /** Index of the asymmetric-unit atom it comes from. */
  site: number;
  label: string;
  element: string;
  occupancy: number;
  /** Fractional position, each coordinate in [0, 1]. */
  x: Vec3;
}

/** How close (fractional) a coordinate must be to 0 or 1 to count as on a face of the cell. */
export const FACE_TOLERANCE = 1e-3;

/**
 * Every atom drawn in one unit cell: the asymmetric unit moved by all operators and wrapped into
 * [0, 1), duplicates removed, and then the copies of atoms on faces, edges and corners (a
 * coordinate within FACE_TOLERANCE of 0 is also drawn at 1).
 */
export function cellAtoms(crystal: Crystal): CellAtom[] {
  const wrap = (v: number) => {
    const w = v - Math.floor(v);
    return w > 1 - FACE_TOLERANCE ? 0 : w;
  };
  const out: CellAtom[] = [];
  crystal.atoms.forEach((atom, site) => {
    const inside: Vec3[] = [];
    for (const op of crystal.ops) {
      const x = applySymop(op, atom.x).map(wrap) as Vec3;
      if (inside.some((y) => y.every((v, i) => Math.abs(v - (x[i] as number)) < FACE_TOLERANCE)))
        continue;
      inside.push(x);
    }
    for (const x of inside) {
      // 0 → also 1 on each axis where the coordinate is on a face.
      const choices = x.map((v) => (v < FACE_TOLERANCE ? [v, v + 1] : [v]));
      for (const a of choices[0] as number[])
        for (const b of choices[1] as number[])
          for (const c of choices[2] as number[])
            out.push({
              site,
              label: atom.label,
              element: atom.element,
              occupancy: atom.occupancy,
              x: [a, b, c],
            });
    }
  });
  return out;
}

/** Bond tolerance (Å) added to the sum of covalent radii, a common choice in structure viewers. */
export const BOND_TOLERANCE = 0.45;
/** Pairs closer than this (Å) are partly occupied alternatives of one site, not a bond. */
const MIN_BOND = 0.5;

/**
 * Bonds between drawn atoms: i–j is a bond when 0.5 Å < d_ij ≤ r_i + r_j + tolerance, r the
 * covalent radii (Å). Atoms whose element has no radius get none.
 */
export function bonds(
  cell: Cell,
  atoms: readonly CellAtom[],
  radii: Readonly<Record<string, number>>,
  tolerance = BOND_TOLERANCE,
): [number, number][] {
  const g = directMetric(cell);
  const out: [number, number][] = [];
  for (let i = 0; i < atoms.length; i++) {
    const ri = radii[(atoms[i] as CellAtom).element];
    if (ri === undefined) continue;
    for (let j = i + 1; j < atoms.length; j++) {
      const rj = radii[(atoms[j] as CellAtom).element];
      if (rj === undefined) continue;
      const d = minus((atoms[j] as CellAtom).x, (atoms[i] as CellAtom).x);
      const length = Math.sqrt(dot(g, d, d));
      if (length > MIN_BOND && length <= ri + rj + tolerance) out.push([i, j]);
    }
  }
  return out;
}
