/*
 * A phase made from a cell suggested by indexing (index.ts), for a Le Bail fit in the Rietveld
 * step: every reflection the lattice centring allows, with no structure.
 *
 * Centring conditions (International Tables Vol. A, integral reflection conditions):
 *   P none; I h + k + l = 2n; F h, k, l all even or all odd; C h + k = 2n; A k + l = 2n.
 * Glide planes and screw axes remove further reflections, but the space group is unknown, so
 * those reflections stay in the list; a Le Bail fit gives them an intensity near zero.
 * Reflections are grouped into families by the lattice symmetry of the crystal system
 * (reflections.ts, familyKey). Each family starts with |F|² = 1 per reflection, so the starting
 * Σ|F|² is its multiplicity; the Le Bail extraction replaces it with the observed intensity.
 */

import type { Cell } from '../reference/powder';
import { dSpacing, reciprocalMetric } from '../reference/powder';
import type { ReferencePeak, ReferencePhase } from '../reference/types';
import { cellKind, type CellKind } from '../rietveld/cell';
import { familyKey, type Hkl } from '../rietveld/reflections';
import type { Centring, IndexSolution } from './index';

/** True when the centring allows reflection (h k l). */
export function centringAllows(centring: Centring, [h, k, l]: Hkl): boolean {
  const even = (n: number) => n % 2 === 0;
  switch (centring) {
    case 'P':
      return true;
    case 'I':
      return even(h + k + l);
    case 'F':
      return (even(h) && even(k) && even(l)) || (!even(h) && !even(k) && !even(l));
    case 'C':
      return even(h + k);
    case 'A':
      return even(k + l);
  }
}

/**
 * Every family of reflections with d ≥ dMin (Å) that the centring allows, largest d first, as
 * reference lines with |F|² = 1 per reflection. `i` is not an intensity here: it is set to 100 for
 * every line (the lattice gives positions only).
 */
export function latticePeaks(
  cell: Cell,
  kind: CellKind,
  centring: Centring,
  dMin: number,
): ReferencePeak[] {
  const g = reciprocalMetric(cell);
  const key = familyKey(cell, kind);
  const families = new Map<string, { d: number; members: Hkl[] }>();
  // h = a · d* (a the real axis, d* the reciprocal vector, |d*| = 1/d), so |h| ≤ a / d_min for
  // any cell, oblique ones included.
  const [hMax, kMax, lMax] = [cell.a, cell.b, cell.c].map((v) => Math.floor(v / dMin)) as [
    number,
    number,
    number,
  ];
  for (let h = -hMax; h <= hMax; h++)
    for (let k = -kMax; k <= kMax; k++)
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const hkl: Hkl = [h, k, l];
        if (!centringAllows(centring, hkl)) continue;
        const d = dSpacing(g, h, k, l);
        if (d < dMin) continue;
        const id = key(hkl);
        const family = families.get(id);
        if (family) family.members.push(hkl);
        else families.set(id, { d, members: [hkl] });
      }
  return [...families.values()]
    .sort((p, q) => q.d - p.d)
    .map(({ d, members }) => {
      // Representative: the member with the largest h, then k, then l (as the library does).
      const rep = [...members].sort((p, q) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2])[0] as Hkl;
      return { d, m: members.length, mf2: members.length, i: 100, hkl: [rep] };
    });
}

/**
 * A reference phase for an indexing suggestion, to add to the candidates and fit by Le Bail.
 * `figures` is written into the name so the user can tell suggestions apart.
 */
export function indexedPhase(solution: IndexSolution, dMin = 0.8): ReferencePhase {
  const cell: Cell = {
    a: solution.a,
    b: solution.b,
    c: solution.c,
    alpha: solution.alpha,
    beta: solution.beta,
    gamma: solution.gamma,
  };
  const kind = cellKind(solution.system, cell);
  const round = (v: number) => Number(v.toFixed(5));
  return {
    id: `indexed-${solution.system}-${solution.centring}-${[cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma].map(round).join('-')}`,
    name: `Indexed cell (${solution.system} ${solution.centring}, M${solution.n} = ${solution.m20.toFixed(1)})`,
    formula: '',
    codId: null,
    origin: {
      kind: 'indexed',
      system: solution.system,
      centring: solution.centring,
      m20: solution.m20,
      fN: solution.fN,
      n: solution.n,
    },
    spaceGroup: { hm: `${solution.centring} lattice (space group unknown)`, number: 0 },
    crystalSystem: solution.system,
    cell,
    citation: { journal: '', volume: '', page: '', year: '', doi: null },
    peaks: latticePeaks(cell, kind, solution.centring, dMin),
  };
}
