/*
 * Runtime use of the reference library: line positions for any wavelength, a text search over
 * the material families, and a guide score for how well a measured pattern agrees with a
 * reference phase.
 */

import { patternFor, type PatternPeak } from './powder.ts';
import type { ReferenceIndexEntry, ReferencePhase } from './types.ts';

/**
 * Reference lines of a phase for the wavelength λ (Å): 2θ in degrees from Bragg's law
 * λ = 2 d sin θ, and relative intensities (strongest = 100) recomputed from the stored
 * Σ|F|² with the Lorentz-polarisation factor.
 */
export function referenceLines(phase: ReferencePhase, wavelength: number): PatternPeak[] {
  return patternFor(
    phase.peaks.map((p) => ({ d: p.d, multiplicity: p.m, mf2: p.mf2, hkl: p.hkl })),
    wavelength,
  );
}

/** Lower-case text without spaces, hyphens and brackets, with subscript digits as plain digits. */
function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-_()[\],.]/g, '');
}

/**
 * Families whose name, aliases or formula contain the typed text, best matches first
 * (names and aliases that start with the text before those that merely contain it).
 */
export function searchFamilies(
  families: readonly ReferenceIndexEntry[],
  query: string,
): ReferenceIndexEntry[] {
  const q = normalise(query);
  if (q === '') return [...families];
  const scored: { family: ReferenceIndexEntry; rank: number }[] = [];
  for (const family of families) {
    const terms = [family.name, family.formula, ...family.aliases].map(normalise);
    // Phase names count too, so "anatase" finds titanium dioxide.
    for (const phase of family.phases) terms.push(normalise(phase.name));
    let rank = Infinity;
    for (const term of terms) {
      if (term === q) rank = Math.min(rank, 0);
      else if (term.startsWith(q)) rank = Math.min(rank, 1);
      else if (term.includes(q)) rank = Math.min(rank, 2);
    }
    if (rank < Infinity) scored.push({ family, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((s) => s.family);
}

export interface MatchOptions {
  /** A reference line counts as found when a measured peak is within this many degrees 2θ. */
  toleranceDeg: number;
  /** The zero shift is searched from −maxShiftDeg to +maxShiftDeg. */
  maxShiftDeg: number;
  /** Step of the zero-shift search, degrees. */
  shiftStepDeg: number;
  /** Only reference lines at least this strong (percent of the strongest) are scored. */
  minIntensity: number;
}

export const DEFAULT_MATCH: MatchOptions = {
  toleranceDeg: 0.15,
  maxShiftDeg: 0.3,
  shiftStepDeg: 0.01,
  minIntensity: 5,
};

export interface MatchedLine {
  /** Reference position after the zero shift, degrees 2θ. */
  twoTheta: number;
  d: number;
  hkl: [number, number, number][];
  /** Relative intensity, percent of the strongest reference line. */
  intensity: number;
  /** Position of the measured peak found within the tolerance, or null. */
  observed: number | null;
}

export interface MatchResult {
  /** Intensity-weighted fraction (0 to 1) of the scored reference lines that were found. */
  score: number;
  /** The zero shift that gave the best score, degrees 2θ (added to the reference positions). */
  shift: number;
  lines: MatchedLine[];
}

/**
 * Guide score for a reference phase against measured peak positions.
 *
 *   score = Σ I_k · found_k / Σ I_k
 *
 * over the reference lines k with relative intensity I_k ≥ minIntensity that fall inside the
 * measured range (shrunk by maxShift at both ends so the set does not change with the shift).
 * found_k is 1 when a measured peak lies within the tolerance of the line's position plus the
 * zero shift. The shift is the single value in [−maxShift, +maxShift] that maximises the
 * score; ties go to the shift with the smaller mean distance between found lines and peaks,
 * then to the smaller |shift|.
 *
 * lines: reference lines at 2θ in degrees (see referenceLines). peaks: measured peak
 * positions, degrees 2θ, increasing. range: first and last 2θ of the measured data.
 * This is a guide for simple, well-separated phases, not phase identification.
 */
export function matchPhase(
  lines: readonly PatternPeak[],
  peaks: readonly number[],
  range: readonly [number, number],
  options: MatchOptions = DEFAULT_MATCH,
): MatchResult {
  const sorted = [...peaks].sort((a, b) => a - b);
  const lo = range[0] + options.maxShiftDeg;
  const hi = range[1] - options.maxShiftDeg;
  const scored = lines.filter(
    (l) => l.intensity >= options.minIntensity && l.twoTheta >= lo && l.twoTheta <= hi,
  );
  const total = scored.reduce((s, l) => s + l.intensity, 0);

  /** Nearest measured peak to x, by binary search. */
  const nearest = (x: number): number | null => {
    if (sorted.length === 0) return null;
    let a = 0;
    let b = sorted.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if ((sorted[mid] as number) < x) a = mid + 1;
      else b = mid;
    }
    const before = sorted[a - 1];
    const after = sorted[a];
    if (before === undefined) return after ?? null;
    if (after === undefined) return before;
    return x - before <= after - x ? before : after;
  };

  const evaluate = (shift: number) => {
    let found = 0;
    let distance = 0;
    let count = 0;
    const matched: MatchedLine[] = scored.map((l) => {
      const position = l.twoTheta + shift;
      const peak = nearest(position);
      const hit = peak !== null && Math.abs(peak - position) <= options.toleranceDeg + 1e-9;
      if (hit) {
        found += l.intensity;
        distance += Math.abs((peak as number) - position);
        count++;
      }
      return {
        twoTheta: position,
        d: l.d,
        hkl: l.hkl,
        intensity: l.intensity,
        observed: hit ? peak : null,
      };
    });
    return { shift, found, meanDistance: count > 0 ? distance / count : Infinity, matched };
  };

  const steps = Math.round(options.maxShiftDeg / options.shiftStepDeg);
  let best = evaluate(0);
  for (let k = -steps; k <= steps; k++) {
    const candidate = evaluate(k * options.shiftStepDeg);
    const better =
      candidate.found > best.found + 1e-9 ||
      (Math.abs(candidate.found - best.found) <= 1e-9 &&
        (candidate.meanDistance < best.meanDistance - 1e-9 ||
          (Math.abs(candidate.meanDistance - best.meanDistance) <= 1e-9 &&
            Math.abs(candidate.shift) < Math.abs(best.shift) - 1e-9)));
    if (better) best = candidate;
  }
  return {
    score: total > 0 ? best.found / total : 0,
    shift: Math.abs(best.shift) < 1e-9 ? 0 : best.shift,
    lines: best.matched,
  };
}

/**
 * Measured peaks that no shown phase explains: those with no reference line of any phase within
 * toleranceDeg. peaks: measured positions, degrees 2θ. lineSets: each phase's line positions in
 * degrees 2θ, already including its zero shift. Returns the unexplained positions in input order.
 */
export function unexplainedPeaks(
  peaks: readonly number[],
  lineSets: readonly (readonly number[])[],
  toleranceDeg: number,
): number[] {
  return peaks.filter((p) =>
    lineSets.every((lines) => lines.every((x) => Math.abs(x - p) > toleranceDeg)),
  );
}
