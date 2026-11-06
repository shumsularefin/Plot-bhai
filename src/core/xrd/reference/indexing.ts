/*
 * Indexing a powder pattern without a reference: find a cubic, tetragonal or hexagonal cell whose
 * lines explain the observed peak positions, and rank the cells by de Wolff's figure of merit.
 *
 * This is a trial-and-error search for high-symmetry cells only (the method of the classic
 * "ratio" indexing, extended to two parameters). It cannot find monoclinic or triclinic cells. It
 * tries primitive and centred lattices (cubic P, I and F, tetragonal P and I, hexagonal P) with
 * their lattice-centring absences only, not those of glide planes or screw axes, and a good figure
 * of merit does not prove a cell is right. The result is an estimate to be confirmed, for example against a
 * reference pattern.
 */

import { reciprocalTerms, refineLattice, type LatticeFit } from './lattice';

const DEG = Math.PI / 180;

export type IndexSystem = 'cubic' | 'tetragonal' | 'hexagonal';

export const INDEX_SYSTEMS: readonly IndexSystem[] = ['cubic', 'tetragonal', 'hexagonal'];

/** Lattice centring: primitive, body-centred or face-centred. */
export type Centring = 'P' | 'I' | 'F';

const CENTRINGS: Record<IndexSystem, readonly Centring[]> = {
  cubic: ['P', 'I', 'F'],
  tetragonal: ['P', 'I'],
  hexagonal: ['P'],
};

/** Reflection conditions of the centrings: I needs h + k + l even, F h, k, l all odd or all even. */
const PRESENT: Record<Centring, (h: number, k: number, l: number) => boolean> = {
  P: () => true,
  I: (h, k, l) => (h + k + l) % 2 === 0,
  F: (h, k, l) => h % 2 === k % 2 && k % 2 === l % 2,
};

export interface IndexingOptions {
  /** Largest |2θ observed − 2θ calculated| for a line to count as indexed, degrees. */
  tolerance: number;
  /** Shortest and longest cell edge tried, Å. */
  minEdge: number;
  maxEdge: number;
}

export const DEFAULT_INDEXING: IndexingOptions = { tolerance: 0.08, minEdge: 2, maxEdge: 25 };

export interface IndexedLine {
  /** Observed position, degrees 2θ. */
  twoTheta: number;
  /** Assigned indices, or null when no calculated line lies within the tolerance. */
  hkl: readonly [number, number, number] | null;
  /** Observed − calculated 2θ, degrees (to the nearest calculated line). */
  residual: number;
}

export interface IndexingSolution {
  system: IndexSystem;
  centring: Centring;
  /** Cell edges from the refinement, Å (a, or a and c). */
  fit: LatticeFit;
  lines: IndexedLine[];
  /** Lines indexed and lines used. */
  indexed: number;
  n: number;
  /** de Wolff figure of merit M(n) of the refined cell. */
  figureOfMerit: number;
}

/** One distinct set of reciprocal terms, with one hkl that gives it. */
interface Term {
  g: number[];
  hkl: [number, number, number];
}

/**
 * The distinct reciprocal terms of a system up to index `max`. Only one of each set of
 * symmetry-equivalent indices is needed, because they share the same d-spacing.
 */
function termsOf(system: IndexSystem, centring: Centring, max: number): Term[] {
  const seen = new Map<string, Term>();
  for (let h = 0; h <= max; h++)
    for (let k = 0; k <= h; k++)
      for (let l = 0; l <= (system === 'cubic' ? k : max); l++) {
        if ((h === 0 && k === 0 && l === 0) || !PRESENT[centring](h, k, l)) continue;
        const hkl: [number, number, number] = [h, k, l];
        const g = reciprocalTerms(system, hkl);
        const key = g.map((v) => v.toFixed(6)).join(',');
        if (!seen.has(key)) seen.set(key, { g, hkl });
      }
  return [...seen.values()].sort((a, b) => sum(a.g) - sum(b.g));
}

const sum = (v: readonly number[]) => v.reduce((s, x) => s + x, 0);
const dot = (g: readonly number[], p: readonly number[]) =>
  g.reduce((s, v, j) => s + v * (p[j] as number), 0);

/** q = 1/d² = 4 sin²θ / λ², Å⁻², from 2θ in degrees and λ in Å. */
const qOf = (twoTheta: number, wavelength: number) =>
  (4 * Math.sin((twoTheta * DEG) / 2) ** 2) / (wavelength * wavelength);
/** ∂q/∂(2θ) per degree. */
const qSlope = (twoTheta: number, wavelength: number) =>
  (2 * Math.sin(twoTheta * DEG) * DEG) / (wavelength * wavelength);
const twoThetaOf = (q: number, wavelength: number) => {
  const s = (wavelength * Math.sqrt(q)) / 2;
  return s >= 1 ? NaN : (2 * Math.asin(s)) / DEG;
};

/**
 * Matches the observed lines to the calculated lines of a cell with reciprocal terms p and
 * returns the lines and de Wolff's figure of merit
 *
 *   M(N) = q_N / (2 ε̄ N_calc),
 *
 * where q_N = 1/d² of the last observed line used (Å⁻²), ε̄ the mean |q_obs − q_calc| over the N
 * lines, and N_calc the number of distinct calculated lines up to q_N (de Wolff, J. Appl. Cryst.
 * 1 (1968) 108). Lines farther than the tolerance from every calculated line are not indexed but
 * still count in ε̄, so a cell that misses lines scores low.
 */
function score(
  terms: readonly Term[],
  p: readonly number[],
  twoTheta: readonly number[],
  wavelength: number,
  tolerance: number,
): { lines: IndexedLine[]; indexed: number; figureOfMerit: number } {
  const qObs = twoTheta.map((t) => qOf(t, wavelength));
  const qLast = qObs[qObs.length - 1] as number;
  const calc = terms
    .map((t) => ({ q: dot(t.g, p), hkl: t.hkl }))
    .filter((c) => c.q <= qLast * 1.1)
    .sort((a, b) => a.q - b.q);
  const distinct = new Set(calc.filter((c) => c.q <= qLast).map((c) => c.q.toPrecision(8))).size;
  let errorSum = 0;
  let indexed = 0;
  const lines = twoTheta.map((t, i) => {
    const q = qObs[i] as number;
    let best: { q: number; hkl: [number, number, number] } | null = null;
    for (const c of calc) if (!best || Math.abs(c.q - q) < Math.abs(best.q - q)) best = c;
    if (!best) return { twoTheta: t, hkl: null, residual: NaN };
    errorSum += Math.abs(best.q - (qObs[i] as number));
    const residual = t - twoThetaOf(best.q, wavelength);
    const ok = Math.abs(residual) <= tolerance;
    if (ok) indexed++;
    return { twoTheta: t, hkl: ok ? best.hkl : null, residual };
  });
  // Error-free (synthetic) positions would give an infinite M: floor ε̄ at the q change of
  // 0.0005° 2θ at the last line, far below any measured error.
  const floor = qSlope(twoTheta[twoTheta.length - 1] as number, wavelength) * 0.0005;
  const mean = Math.max(errorSum / twoTheta.length, floor);
  const figureOfMerit = distinct > 0 ? qLast / (2 * mean * distinct) : 0;
  return { lines, indexed, figureOfMerit };
}

/** Trial cells for one system: every way of giving the first lines low indices. */
function trials(
  system: IndexSystem,
  terms: readonly Term[],
  qObs: readonly number[],
  options: IndexingOptions,
): number[][] {
  const pMin = 1 / (options.maxEdge * options.maxEdge);
  const pMax = 1 / (options.minEdge * options.minEdge);
  const ok = (p: number[]) => p.every((v) => v >= pMin && v <= pMax);
  const out = new Map<string, number[]>();
  const add = (p: number[]) => {
    if (ok(p)) out.set(p.map((v) => v.toPrecision(5)).join(','), p);
  };
  const low = terms.slice(0, system === 'cubic' ? 24 : 48);
  if (system === 'cubic') {
    for (const q of qObs.slice(0, 4)) for (const t of low) add([q / (t.g[0] as number)]);
    return [...out.values()];
  }
  const first = qObs.slice(0, 6);
  for (let i = 0; i < first.length; i++)
    for (let j = i + 1; j < first.length; j++)
      for (const s of low)
        for (const t of low) {
          // Solve q_i = s·p, q_j = t·p for the two terms p₁, p₂.
          const det =
            (s.g[0] as number) * (t.g[1] as number) - (s.g[1] as number) * (t.g[0] as number);
          if (Math.abs(det) < 1e-9) continue;
          const qi = first[i] as number;
          const qj = first[j] as number;
          add([
            (qi * (t.g[1] as number) - qj * (s.g[1] as number)) / det,
            ((s.g[0] as number) * qj - (t.g[0] as number) * qi) / det,
          ]);
        }
  return [...out.values()];
}

/**
 * Indexes peak positions (degrees 2θ, any order) measured with wavelength λ (Å), trying each
 * given crystal system, and returns up to `limit` refined cells, best first. A cell must index
 * all but at most one line in ten (rounded down, at least all but one of five or more) to be
 * listed; cells are ranked by M(N). Needs at least 3 lines for a cubic cell and 4 otherwise.
 * Uses at most the first 20 lines, as M(20) does.
 */
export function indexPattern(
  positions: readonly number[],
  wavelength: number,
  systems: readonly IndexSystem[],
  options: IndexingOptions = DEFAULT_INDEXING,
  limit = 5,
): IndexingSolution[] {
  const twoTheta = [...positions]
    .filter((t) => Number.isFinite(t) && t > 0 && t < 180)
    .sort((a, b) => a - b)
    .slice(0, 20);
  const qObs = twoTheta.map((t) => qOf(t, wavelength));
  const allowedMisses = Math.max(twoTheta.length >= 5 ? 1 : 0, Math.floor(twoTheta.length / 10));
  const found: IndexingSolution[] = [];
  const tries = systems.flatMap((system) => CENTRINGS[system].map((c) => [system, c] as const));
  for (const [system, centring] of tries) {
    if (twoTheta.length < (system === 'cubic' ? 3 : 4)) continue;
    const terms = termsOf(system, centring, 6);
    const tolQ = twoTheta.map((t) => qSlope(t, wavelength) * options.tolerance);
    /** Quick test before scoring: no more lines than allowed lie away from every term. */
    const plausible = (p: readonly number[]) => {
      let misses = 0;
      for (let i = 0; i < qObs.length; i++) {
        const q = qObs[i] as number;
        const tol = tolQ[i] as number;
        if (!terms.some((t) => Math.abs(dot(t.g, p) - q) <= tol) && ++misses > allowedMisses)
          return false;
      }
      return true;
    };
    const scored = trials(system, terms, qObs, options)
      .filter(plausible)
      .map((p) => ({ p, ...score(terms, p, twoTheta, wavelength, options.tolerance) }))
      .filter((s) => s.indexed >= twoTheta.length - allowedMisses)
      .sort((a, b) => b.figureOfMerit - a.figureOfMerit)
      .slice(0, 10);
    for (const s of scored) {
      const peaks = s.lines.flatMap((l) => (l.hkl ? [{ twoTheta: l.twoTheta, hkl: l.hkl }] : []));
      const refined = refineLattice(system, peaks, wavelength, false);
      if (!refined.ok) continue;
      const p = refined.fit.edges.map((e) => 1 / (e.a.value * e.a.value));
      const again = score(terms, p, twoTheta, wavelength, options.tolerance);
      if (again.indexed < twoTheta.length - allowedMisses) continue;
      found.push({
        system,
        centring,
        fit: refined.fit,
        lines: again.lines,
        indexed: again.indexed,
        n: twoTheta.length,
        figureOfMerit: again.figureOfMerit,
      });
    }
  }
  // The same cell is often reached from several trials: keep the best of each.
  // A tetragonal or hexagonal cell with c = a·√(…) can mimic a cubic one exactly; when two cells
  // score within 10 %, the one with fewer parameters (higher symmetry) goes first.
  const params = (s: IndexingSolution) => s.fit.edges.length;
  const ranked = found.sort((a, b) => {
    const close =
      Math.abs(a.figureOfMerit - b.figureOfMerit) <=
      0.1 * Math.max(a.figureOfMerit, b.figureOfMerit);
    return close && params(a) !== params(b)
      ? params(a) - params(b)
      : b.figureOfMerit - a.figureOfMerit;
  });
  const unique = new Map<string, IndexingSolution>();
  for (const s of ranked) {
    const key = `${s.system}${s.centring}:${s.fit.edges.map((e) => e.a.value.toFixed(3)).join(',')}`;
    if (!unique.has(key)) unique.set(key, s);
  }
  return [...unique.values()].slice(0, limit);
}
