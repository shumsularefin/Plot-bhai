/*
 * Reflections of a reference phase prepared for whole-pattern refinement.
 *
 * A stored powder line holds the d-spacing, Σ|F|² over all reflections in the line and one (h k l)
 * per symmetry-distinct family. A refinement needs each family separately, because two families
 * that overlap by accident in the reference cell can move apart when the cell changes, and the
 * March–Dollase correction needs every reflection of a family (they make different angles with
 * the preferred direction).
 *
 * The reflections equivalent to (h k l) are found as those whose d-spacing equals its d-spacing
 * both in the reference cell and in a slightly distorted cell of the same crystal system: only
 * reflections related by the lattice symmetry stay equal in every such cell. Σ|F|² of a line is
 * shared between its families in proportion to their number of reflections (the stored data do
 * not keep |F|² per family; equal |F|² is assumed for families that overlap by accident).
 *
 * The structure amplitudes are kept from the reference structure: atom positions, occupancies
 * and displacement parameters are not refined, and the small change of the scattering factors
 * with d when the cell is refined is ignored.
 */

import { dSpacing, reciprocalMetric, type Cell } from '../reference/powder';
import type { ReferencePeak } from '../reference/types';
import { cellFromParameters, cellParameterNames, type CellKind } from './cell';

export type Hkl = [number, number, number];

export interface RefinementReflection {
  /** One reflection of the family, used for its d-spacing. */
  hkl: Hkl;
  /** Every reflection of the family under the lattice symmetry (for preferred orientation). */
  members: Hkl[];
  /** Σ|F|² of the family (electron units²). */
  mf2: number;
}

/** Inverse square d-spacing 1/d² (Å⁻²) of (h k l) for a reciprocal metric. */
function inverseSquare(gStar: readonly number[], [h, k, l]: Hkl): number {
  const d = dSpacing(gStar, h, k, l);
  return 1 / (d * d);
}

/** The same crystal system, with every free parameter changed by a small odd amount. */
function distorted(kind: CellKind, cell: Cell): Cell {
  const change: Record<keyof Cell, (v: number) => number> = {
    a: (v) => v * 1.00071,
    b: (v) => v * 0.99937,
    c: (v) => v * 1.00113,
    alpha: (v) => v + 0.37,
    beta: (v) => v - 0.29,
    gamma: (v) => v + 0.23,
  };
  const values = cellParameterNames(kind).map((name) => change[name](cell[name]));
  return cellFromParameters(kind, values, cell);
}

/**
 * Families of every stored line with d ≥ dMin (Å), with their members and their share of Σ|F|².
 */
export function refinementReflections(
  peaks: readonly ReferencePeak[],
  cell: Cell,
  kind: CellKind,
  dMin: number,
): RefinementReflection[] {
  const lines = peaks.filter((p) => p.d >= dMin);
  if (lines.length === 0) return [];
  const g0 = reciprocalMetric(cell);
  const g1 = reciprocalMetric(distorted(kind, cell));
  const smallest = Math.min(...lines.map((p) => p.d)) * (1 - 1e-4);
  const key = (hkl: Hkl) =>
    `${Math.round(inverseSquare(g0, hkl) * 1e8)}:${Math.round(inverseSquare(g1, hkl) * 1e8)}`;

  // Every (h k l) down to the smallest d, grouped by its pair of d-spacings: |h| ≤ a/d.
  const groups = new Map<string, Hkl[]>();
  const hMax = Math.floor(cell.a / smallest);
  const kMax = Math.floor(cell.b / smallest);
  const lMax = Math.floor(cell.c / smallest);
  const limit = 1 / (smallest * smallest);
  for (let h = -hMax; h <= hMax; h++)
    for (let k = -kMax; k <= kMax; k++)
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const hkl: Hkl = [h, k, l];
        if (inverseSquare(g0, hkl) > limit) continue;
        const id = key(hkl);
        const group = groups.get(id);
        if (group) group.push(hkl);
        else groups.set(id, [hkl]);
      }

  const out: RefinementReflection[] = [];
  for (const line of lines) {
    // Families of the line; two stored families can be one family of the lattice symmetry.
    const families = new Map<string, Hkl[]>();
    for (const hkl of line.hkl) {
      const id = key(hkl);
      if (!families.has(id)) families.set(id, groups.get(id) ?? [hkl]);
    }
    const total = [...families.values()].reduce((s, m) => s + m.length, 0);
    for (const members of families.values())
      out.push({
        hkl: members[0] as Hkl,
        members,
        mf2: (line.mf2 * members.length) / total,
      });
  }
  return out;
}
