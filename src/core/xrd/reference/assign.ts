/*
 * Assigns fitted peaks to the reflections of the chosen reference phases.
 */

import { reciprocalTerms, type LatticeSystem } from './lattice.ts';
import type { PatternPeak } from './powder.ts';

/**
 * A weaker reference line only counts as an overlapping reflection when its intensity is at
 * least this fraction of the nearest line's: a line ten times weaker cannot visibly change the
 * peak, so it is neither shown nor allowed to make the assignment ambiguous.
 */
export const OVERLAP_FRACTION = 0.1;

export interface AssignOptions {
  /** A peak is assigned to a line within this many degrees 2θ (after the zero shift). */
  toleranceDeg: number;
  /** Reference lines weaker than this (percent of the strongest) are ignored. */
  minIntensity: number;
}

export const DEFAULT_ASSIGN: AssignOptions = { toleranceDeg: 0.15, minIntensity: 1 };

/** A reference phase for assignment: its lines (unshifted) and the zero shift to apply to them. */
export interface AssignPhase {
  id: string;
  lines: readonly PatternPeak[];
  /** Added to the reference positions, degrees 2θ (see matchPhase). */
  shift: number;
}

/** One reference line a peak may belong to. */
export interface Candidate {
  /** Reference position from the library (no zero shift), degrees 2θ. */
  twoTheta: number;
  d: number;
  /** Relative intensity, percent of the strongest line of the phase. */
  intensity: number;
  hkl: [number, number, number][];
  /** |observed − (reference + shift)|, degrees 2θ. */
  distance: number;
}

export interface Assignment {
  /** Phase of the nearest line, or null when no line is within the tolerance ("unassigned"). */
  phaseId: string | null;
  /** The nearest line first, then overlapping lines of the same phase, nearest first. */
  candidates: Candidate[];
  /** Other phases that also have a line within the tolerance of this peak. */
  competing: string[];
}

/**
 * Assigns each observed peak to the nearest reference line of any phase, comparing the observed
 * position with the line's position plus that phase's zero shift. The peak is unassigned when
 * the nearest line is further than the tolerance. Lines of the same phase that are also within
 * the tolerance, and at least OVERLAP_FRACTION as strong as the nearest one, are kept as
 * overlapping candidates.
 *
 * positions: observed peak positions, degrees 2θ. Returns one assignment per position, in order.
 */
export function assignPeaks(
  positions: readonly number[],
  phases: readonly AssignPhase[],
  options: AssignOptions = DEFAULT_ASSIGN,
): Assignment[] {
  return positions.map((position) => {
    const found = phases.map((phase) => {
      const near: Candidate[] = phase.lines
        .filter((l) => l.intensity >= options.minIntensity)
        .map((l) => ({
          twoTheta: l.twoTheta,
          d: l.d,
          intensity: l.intensity,
          hkl: l.hkl,
          distance: Math.abs(position - (l.twoTheta + phase.shift)),
        }))
        .filter((c) => c.distance <= options.toleranceDeg + 1e-9)
        .sort((a, b) => a.distance - b.distance);
      const nearest = near[0];
      const candidates = nearest
        ? near.filter((c) => c === nearest || c.intensity >= OVERLAP_FRACTION * nearest.intensity)
        : [];
      return { id: phase.id, candidates };
    });
    const matching = found
      .filter((f) => f.candidates.length > 0)
      .sort(
        (a, b) => (a.candidates[0] as Candidate).distance - (b.candidates[0] as Candidate).distance,
      );
    const best = matching[0];
    return {
      phaseId: best ? best.id : null,
      candidates: best ? best.candidates : [],
      competing: matching.slice(1).map((m) => m.id),
    };
  });
}

/**
 * The (h k l) of a peak that fixes its position uniquely in the lattice system, or null when it
 * cannot be used for a lattice fit: unassigned, an overlap of reflections whose 1/d² terms
 * differ, or a second phase also claiming the peak. Equivalent reflections of one cubic line
 * (for example (511) and (333)) have the same terms, so they are not an ambiguity.
 */
export function uniqueHkl(
  assignment: Assignment,
  system: LatticeSystem,
): [number, number, number] | null {
  if (assignment.phaseId === null || assignment.competing.length > 0) return null;
  const all = assignment.candidates.flatMap((c) => c.hkl);
  const first = all[0];
  if (!first) return null;
  const terms = reciprocalTerms(system, first);
  const same = all.every((h) =>
    reciprocalTerms(system, h).every((t, j) => Math.abs(t - (terms[j] as number)) < 1e-9),
  );
  return same ? first : null;
}
