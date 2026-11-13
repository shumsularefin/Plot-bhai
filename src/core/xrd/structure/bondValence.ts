/*
 * Bond-valence sums (Brown & Altermatt 1985, Acta Cryst. B41, 244): each cation–anion bond of
 * length R (Å) carries the valence s = exp((R₀ − R)/b), R₀ and b (Å) from the table of the ion
 * pair (data/reference/bond-valence.json, I. D. Brown's bvparm2020), and the sum over the bonds
 * of a site, V = Σ occ_j s_ij (occ_j the occupancy of the neighbour), is compared with the
 * magnitude of the site's oxidation state. Uncertainty: ∂V/∂p = −Σ occ_j (s_ij / b) ∂R_ij/∂p,
 * σ²(V) = (∂V/∂p)ᵀ C (∂V/∂p), with the bond gradients and covariance of bonds.ts.
 */

import { propagate, type Bond, type GeometryAtom } from './bonds.ts';

/** The table as stored: [cation, valence, anion, valence, R₀ (Å), b (Å), reference id]. */
export interface BondValenceFile {
  source: string;
  notice: string;
  refs: Record<string, string>;
  params: [string, number, string, number, number, number, string][];
}

export interface BondValenceParameter {
  r0: number;
  b: number;
  ref: string;
  /** True when the table gives the cation's oxidation state as "not specified" (9). */
  unspecified: boolean;
}

/** Valence 9 in the table: the paper did not give the cation's oxidation state. */
const UNSPECIFIED = 9;

/** R₀ and b for a cation and an anion in the given oxidation states, or null. */
export function bondValenceParameter(
  table: BondValenceFile,
  cation: string,
  cationState: number,
  anion: string,
  anionState: number,
): BondValenceParameter | null {
  const find = (state: number) =>
    table.params.find(
      (p) => p[0] === cation && p[1] === state && p[2] === anion && p[3] === anionState,
    );
  const exact = find(cationState);
  const row = exact ?? find(UNSPECIFIED);
  return row ? { r0: row[4], b: row[5], ref: row[6], unspecified: !exact } : null;
}

/**
 * Oxidation states the table offers for each element: as a cation (with any anion present), or
 * as an anion. An element is taken as an anion when the table lists it as one and lists no
 * parameters with it as the cation towards another element of the structure (so S is an anion in
 * ZnS but a cation in a sulfate).
 */
export function offeredStates(table: BondValenceFile, elements: readonly string[]) {
  const present = new Set(elements);
  return elements.map((element) => {
    const asCation = table.params.filter(
      (p) => p[0] === element && present.has(p[2]) && p[2] !== element,
    );
    const asAnion = table.params.filter((p) => p[2] === element);
    if (asAnion.length > 0 && asCation.length === 0) {
      // Most often listed first: the anion's usual state in the table (O −2, F −1, N −3, …).
      const counts = new Map<number, number>();
      for (const p of asAnion) counts.set(p[3], (counts.get(p[3]) ?? 0) + 1);
      const states = [...counts].sort((x, y) => y[1] - x[1]).map(([s]) => s);
      return { element, anion: true, states };
    }
    const states = [...new Set(asCation.map((p) => p[1]).filter((s) => s !== UNSPECIFIED))].sort(
      (x, y) => x - y,
    );
    return { element, anion: false, states };
  });
}

export interface SiteValence {
  /** Asymmetric-unit atom. */
  site: number;
  /** Oxidation state used, and the bond-valence sum (positive) with its uncertainty. */
  state: number;
  sum: number;
  su: number;
  /** Number of bonds summed. */
  bonds: number;
  /** Ion pairs with bonds but no parameters in the table (their bonds are left out). */
  missing: string[];
  /** Reference ids of the parameters used. */
  refs: string[];
}

/**
 * Bond-valence sum of every site with an oxidation state: the bonds from the site to neighbours
 * of the opposite sign, each with the parameters of its cation–anion pair. Sites with state 0 or
 * no state are left out. `states[i]` is the oxidation state of atom i.
 */
export function bondValenceSums(
  table: BondValenceFile,
  atoms: readonly GeometryAtom[],
  states: readonly (number | null)[],
  bonds: readonly Bond[],
  covariance: readonly number[],
): SiteValence[] {
  const out: SiteValence[] = [];
  atoms.forEach((atom, i) => {
    const state = states[i];
    if (!state) return;
    let sum = 0;
    let count = 0;
    const gradient = new Float64Array(6 + 3 * atoms.length);
    const missing = new Set<string>();
    const refs = new Set<string>();
    for (const bond of bonds) {
      if (bond.from !== i) continue;
      const other = atoms[bond.to] as GeometryAtom;
      const otherState = states[bond.to];
      if (!otherState || Math.sign(otherState) === Math.sign(state)) continue;
      const [cation, anion] = state > 0 ? [atom, other] : [other, atom];
      const [cs, as] = state > 0 ? [state, otherState] : [otherState, state];
      const p = bondValenceParameter(table, cation.element, cs, anion.element, as);
      if (!p) {
        missing.add(`${cation.element}${cs}+–${anion.element}${-as}−`);
        continue;
      }
      const s = Math.exp((p.r0 - bond.length) / p.b);
      sum += other.occupancy * s;
      count++;
      refs.add(p.ref);
      const k = (-other.occupancy * s) / p.b;
      for (let q = 0; q < gradient.length; q++)
        gradient[q] = (gradient[q] as number) + k * (bond.gradient[q] as number);
    }
    out.push({
      site: i,
      state,
      sum,
      su: propagate(gradient, covariance),
      bonds: count,
      missing: [...missing],
      refs: [...refs].sort(),
    });
  });
  return out;
}

/**
 * Suggested oxidation states: anions take their usual state (offeredStates); each cation the
 * offered state closest to its own bond-valence sum with those anions (when sums can be formed),
 * else its lowest offered state. A suggestion only: the user should check it.
 */
export function suggestStates(
  table: BondValenceFile,
  atoms: readonly GeometryAtom[],
  bonds: readonly Bond[],
  covariance: readonly number[],
): (number | null)[] {
  const offered = offeredStates(
    table,
    atoms.map((a) => a.element),
  );
  const base = offered.map((o) => (o.anion ? (o.states[0] ?? null) : null));
  return atoms.map((_, i) => {
    const o = offered[i] as (typeof offered)[number];
    if (o.anion) return base[i] as number | null;
    let best: number | null = null;
    let gap = Infinity;
    for (const state of o.states) {
      const trial = base.slice();
      trial[i] = state;
      const site = bondValenceSums(table, atoms, trial, bonds, covariance).find(
        (v) => v.site === i,
      );
      if (!site || site.bonds === 0) continue;
      const d = Math.abs(site.sum - state);
      if (d < gap) {
        gap = d;
        best = state;
      }
    }
    return best ?? o.states[0] ?? null;
  });
}
