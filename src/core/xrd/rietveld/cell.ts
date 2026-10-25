/*
 * Unit cell parameters that a refinement may change, per crystal system, so that the cell keeps
 * its symmetry: cubic refines a; tetragonal and hexagonal (also trigonal on hexagonal axes) a and
 * c; rhombohedral axes a and α; orthorhombic a, b and c; monoclinic a, b, c and the one angle that
 * is not 90°; triclinic all six. Lengths in Å, angles in degrees.
 */

import type { Cell } from '../reference/powder';

export type CellKind =
  | 'cubic'
  | 'tetragonal'
  | 'hexagonal'
  | 'rhombohedral'
  | 'orthorhombic'
  | 'monoclinic-alpha'
  | 'monoclinic-beta'
  | 'monoclinic-gamma'
  | 'triclinic';

const near = (x: number, y: number, tolerance: number) => Math.abs(x - y) <= tolerance;

/**
 * Which parameters are independent, from the crystal system the phase names (or, when that is
 * unknown, from the cell itself).
 */
export function cellKind(system: string, cell: Cell): CellKind {
  const right = (angle: number) => near(angle, 90, 1e-3);
  const sameLength = (x: number, y: number) => near(x, y, 1e-4 * Math.max(x, y));
  const allRight = right(cell.alpha) && right(cell.beta) && right(cell.gamma);
  const hexagonal =
    right(cell.alpha) &&
    right(cell.beta) &&
    near(cell.gamma, 120, 1e-3) &&
    sameLength(cell.a, cell.b);
  const rhombohedral =
    sameLength(cell.a, cell.b) &&
    sameLength(cell.a, cell.c) &&
    near(cell.alpha, cell.beta, 1e-3) &&
    near(cell.alpha, cell.gamma, 1e-3) &&
    !right(cell.alpha);
  switch (system) {
    case 'cubic':
      return 'cubic';
    case 'tetragonal':
      return 'tetragonal';
    case 'hexagonal':
      return 'hexagonal';
    case 'trigonal':
      return rhombohedral ? 'rhombohedral' : 'hexagonal';
    case 'orthorhombic':
      return 'orthorhombic';
    case 'monoclinic':
      if (!right(cell.alpha)) return 'monoclinic-alpha';
      if (!right(cell.gamma)) return 'monoclinic-gamma';
      return 'monoclinic-beta';
    case 'triclinic':
      return 'triclinic';
  }
  // Unknown system: the highest symmetry the cell itself allows.
  if (allRight && sameLength(cell.a, cell.b) && sameLength(cell.a, cell.c)) return 'cubic';
  if (allRight && sameLength(cell.a, cell.b)) return 'tetragonal';
  if (hexagonal) return 'hexagonal';
  if (rhombohedral) return 'rhombohedral';
  if (allRight) return 'orthorhombic';
  return 'triclinic';
}

/** Names of the refinable cell parameters, in order. */
export function cellParameterNames(kind: CellKind): (keyof Cell)[] {
  switch (kind) {
    case 'cubic':
      return ['a'];
    case 'tetragonal':
    case 'hexagonal':
      return ['a', 'c'];
    case 'rhombohedral':
      return ['a', 'alpha'];
    case 'orthorhombic':
      return ['a', 'b', 'c'];
    case 'monoclinic-alpha':
      return ['a', 'b', 'c', 'alpha'];
    case 'monoclinic-beta':
      return ['a', 'b', 'c', 'beta'];
    case 'monoclinic-gamma':
      return ['a', 'b', 'c', 'gamma'];
    case 'triclinic':
      return ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
  }
}

/** The refinable parameters of a cell. */
export function parametersFromCell(kind: CellKind, cell: Cell): number[] {
  return cellParameterNames(kind).map((name) => cell[name]);
}

/** The whole cell from its refinable parameters; the fixed ones follow from the symmetry. */
export function cellFromParameters(kind: CellKind, values: readonly number[], start: Cell): Cell {
  const v = (i: number) => values[i] as number;
  switch (kind) {
    case 'cubic':
      return { a: v(0), b: v(0), c: v(0), alpha: 90, beta: 90, gamma: 90 };
    case 'tetragonal':
      return { a: v(0), b: v(0), c: v(1), alpha: 90, beta: 90, gamma: 90 };
    case 'hexagonal':
      return { a: v(0), b: v(0), c: v(1), alpha: 90, beta: 90, gamma: 120 };
    case 'rhombohedral':
      return { a: v(0), b: v(0), c: v(0), alpha: v(1), beta: v(1), gamma: v(1) };
    case 'orthorhombic':
      return { a: v(0), b: v(1), c: v(2), alpha: 90, beta: 90, gamma: 90 };
    case 'monoclinic-alpha':
      return { a: v(0), b: v(1), c: v(2), alpha: v(3), beta: 90, gamma: 90 };
    case 'monoclinic-beta':
      return { a: v(0), b: v(1), c: v(2), alpha: 90, beta: v(3), gamma: 90 };
    case 'monoclinic-gamma':
      return { a: v(0), b: v(1), c: v(2), alpha: 90, beta: 90, gamma: v(3) };
    case 'triclinic':
      return values.length === 6
        ? { a: v(0), b: v(1), c: v(2), alpha: v(3), beta: v(4), gamma: v(5) }
        : start;
  }
}

/**
 * Cell volume (Å³): V = abc·√(1 − cos²α − cos²β − cos²γ + 2 cosα cosβ cosγ).
 */
export function cellVolume(cell: Cell): number {
  const rad = Math.PI / 180;
  const ca = Math.cos(cell.alpha * rad);
  const cb = Math.cos(cell.beta * rad);
  const cg = Math.cos(cell.gamma * rad);
  return cell.a * cell.b * cell.c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);
}
