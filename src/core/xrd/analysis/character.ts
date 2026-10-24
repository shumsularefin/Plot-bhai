/*
 * "Pattern character": rule-based hints about preferred orientation, random powder and
 * nanocrystalline or amorphous content. The thresholds below are rules of thumb chosen for this
 * app, not published values; they are flagged for verification in docs/PROGRESS.md.
 */

import { formatHkl } from '../reference/hkl';

export type Hkl = [number, number, number];

/** Said with every hint. */
export const SINGLE_CRYSTAL_DISCLAIMER =
  'Estimate only; a powder pattern cannot prove single-crystal or layered structure.';

/** A reference reflection counts as strong from this share of the strongest line, percent. */
export const STRONG_REFERENCE_PERCENT = 10;
/** Orientation hint: at least this many strong reference reflections of other families are absent. */
export const ORIENTATION_MIN_MISSING = 2;
/** Random-powder hint: at least this share of the strong reflections is present … */
export const RANDOM_MIN_PRESENT = 0.8;
/** … and every texture coefficient lies in this range. */
export const RANDOM_TC_RANGE: readonly [number, number] = [0.5, 1.5];
/** Random-powder hint needs at least this many observed reflections. */
export const RANDOM_MIN_PEAKS = 4;
/** Broad-peak hint: median FWHM at or above this, degrees 2θ. */
export const BROAD_FWHM_DEG = 1;
/** Amorphous hint: crystallinity index below this, percent. */
export const AMORPHOUS_BELOW_PERCENT = 50;

/** An observed peak assigned to a phase: its (hkl) candidates and texture coefficient, if known. */
export interface CharacterPeak {
  hkl: readonly Hkl[];
  tc: number | null;
}

export interface CharacterPhase {
  name: string;
  peaks: readonly CharacterPeak[];
  /** (hkl) of strong reference reflections in the scanned range that have no peak. */
  missing: readonly (readonly Hkl[])[];
}

export interface CharacterInput {
  phases: readonly CharacterPhase[];
  /** Median FWHM of the fitted peaks, degrees 2θ; null when there are none. */
  medianFwhm: number | null;
  /** Crystallinity index, percent; null when it has not been calculated. */
  crystallinity: number | null;
}

export interface CharacterHint {
  id: 'orientation' | 'random' | 'broad' | 'amorphous';
  title: string;
  /** What it suggests, with the disclaimer. */
  text: string;
  /** The evidence in plain language. */
  reason: string;
}

/** True when two (hkl) are parallel, that is, they belong to the same family (h k l) × n. */
function parallel(a: Hkl, b: Hkl): boolean {
  return (
    a[1] * b[2] - a[2] * b[1] === 0 &&
    a[2] * b[0] - a[0] * b[2] === 0 &&
    a[0] * b[1] - a[1] * b[0] === 0
  );
}

const list = (hkl: readonly (readonly Hkl[])[], max = 4) => {
  const shown = hkl.slice(0, max).map((h) => formatHkl(h));
  return shown.join(', ') + (hkl.length > max ? ', …' : '');
};

/**
 * Hints about the character of the pattern, each with its reason and the disclaimer. Rules:
 *  - orientation: all of a phase's peaks (at least two) belong to one family of planes (all
 *    candidates parallel, such as (002), (004)) while at least ORIENTATION_MIN_MISSING strong
 *    reflections of other families are absent;
 *  - random powder: a phase has at least RANDOM_MIN_PEAKS peaks, at least RANDOM_MIN_PRESENT of its
 *    strong reflections are present and all texture coefficients lie within RANDOM_TC_RANGE;
 *  - broad: median FWHM ≥ BROAD_FWHM_DEG;
 *  - amorphous: crystallinity index < AMORPHOUS_BELOW_PERCENT.
 */
export function patternCharacter(input: CharacterInput): CharacterHint[] {
  const hints: CharacterHint[] = [];
  const hint = (id: CharacterHint['id'], title: string, text: string, reason: string) =>
    hints.push({ id, title, text: `${text} ${SINGLE_CRYSTAL_DISCLAIMER}`, reason });

  for (const phase of input.phases) {
    const observed = phase.peaks.flatMap((p) => (p.hkl[0] ? [p.hkl] : []));
    const direction = observed[0]?.[0];
    if (direction && observed.length >= 2) {
      const oneFamily = observed.every((h) => h.some((v) => parallel(v, direction)));
      const absent = phase.missing.filter((h) => !h.some((v) => parallel(v, direction)));
      if (oneFamily && absent.length >= ORIENTATION_MIN_MISSING)
        hint(
          'orientation',
          `${phase.name}: possible preferred orientation`,
          'Strong orientation, or a thin film or epitaxial layer, is possible.',
          `Only reflections of one family of planes were found (${list(observed)}), while the strong reflections ${list(absent)} of ${phase.name} are missing.`,
        );
    }
    const present = phase.peaks.length;
    const strong = present + phase.missing.length;
    const tcs = phase.peaks.flatMap((p) => (p.tc === null ? [] : [p.tc]));
    if (
      present >= RANDOM_MIN_PEAKS &&
      present / strong >= RANDOM_MIN_PRESENT &&
      tcs.length === present &&
      tcs.every((t) => t >= RANDOM_TC_RANGE[0] && t <= RANDOM_TC_RANGE[1])
    )
      hint(
        'random',
        `${phase.name}: looks like a randomly oriented powder`,
        'The pattern is consistent with a randomly oriented powder.',
        `${present} of ${strong} strong reference reflections of ${phase.name} are present and all texture coefficients are between ${RANDOM_TC_RANGE[0]} and ${RANDOM_TC_RANGE[1]}.`,
      );
  }

  if (input.medianFwhm !== null && input.medianFwhm >= BROAD_FWHM_DEG)
    hint(
      'broad',
      'Very broad peaks',
      'Nanocrystalline or poorly ordered material is possible.',
      `The median peak width is ${input.medianFwhm.toFixed(2)}° 2θ (at or above ${BROAD_FWHM_DEG}°). Strain and instrument broadening also widen peaks.`,
    );
  if (input.crystallinity !== null && input.crystallinity < AMORPHOUS_BELOW_PERCENT)
    hint(
      'amorphous',
      'Large amorphous share',
      'A large part of the scattering may come from amorphous content.',
      `The crystallinity index is ${input.crystallinity.toFixed(0)} % (below ${AMORPHOUS_BELOW_PERCENT} %); it depends on the range, background and hump you chose.`,
    );
  return hints;
}
