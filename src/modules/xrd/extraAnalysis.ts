import {
  patternCharacter,
  STRONG_REFERENCE_PERCENT,
  type CharacterHint,
  type Hkl,
} from '../../core/xrd/analysis/character';
import {
  crystallinity,
  PEAK_EXCLUSION_FWHM,
  type CrystallinityOutcome,
} from '../../core/xrd/analysis/crystallinity';
import { signalAt, VISIBLE_SIGNAL_RATIO, type LineSignal } from '../../core/xrd/analysis/signal';
import { textureCoefficients } from '../../core/xrd/analysis/texture';
import { ANODES } from '../../core/xrd/radiation';
import { formatHkl } from '../../core/xrd/reference/hkl';
import { referenceLines } from '../../core/xrd/reference/match';
import type { AssignmentResult, AssignedPeak, PhaseAssignment } from './assignment';
import type { CrystallinityChoice, XrdData } from './data';

/** One reflection in the texture table: a fitted peak, or a strong reference line with no peak. */
export interface TextureRow {
  /** The fitted peak, or null for a reference reflection that was not found. */
  peak: AssignedPeak | null;
  hklText: string;
  /** (hkl) of the reflection, for the pattern hints. */
  hkl: Hkl[];
  /** Observed peak height or area (0 when not found), in the pattern's own unit. */
  observed: number;
  /** Reference intensity I0, percent of the strongest line (overlapping lines are added). */
  reference: number;
  tc: number;
  /** For a reference line with no peak: where it is expected (degrees 2θ) and what the pattern shows there. */
  expected: { twoTheta: number; signal: LineSignal | null } | null;
}

/** A missing reference line where the pattern rises clearly above the local noise: a peak probably left unfitted. */
export function unfittedSignal(row: TextureRow): boolean {
  return (
    row.peak === null &&
    row.expected?.signal != null &&
    row.expected.signal.ratio >= VISIBLE_SIGNAL_RATIO
  );
}

export interface PhaseTexture {
  phase: PhaseAssignment['phase'];
  /** Rows in order of 2θ, or the reason why no coefficient could be formed. */
  result: { rows: TextureRow[] } | { reason: string };
}

/** First and last 2θ of a pattern, degrees; null when it is unknown or empty. */
function patternExtent(data: XrdData, id: string): [number, number] | null {
  const twoTheta = data.patterns.find((p) => p.id === id)?.twoTheta;
  return twoTheta && twoTheta.length > 0
    ? [twoTheta[0] as number, twoTheta[twoTheta.length - 1] as number]
    : null;
}

/**
 * Harris texture coefficients of each chosen phase from its assigned peaks (observed peak height
 * or area, as chosen) and the reference intensities of its lines. The reflections are the
 * assigned peaks plus the strong reference lines (at least STRONG_REFERENCE_PERCENT of the
 * strongest) that lie inside the scanned 2θ range but have no assigned peak; those count as observed
 * intensity 0. Two reference lines under one peak add their intensities, as the peak does. For
 * each missing line the processed pattern is read at the expected position (within the matching
 * tolerance), so a peak that is visible but was not fitted can be reported.
 */
export function textureFor(
  data: XrdData,
  patternId: string,
  assignment: AssignmentResult,
  basis: 'height' | 'area',
  processed: { twoTheta: ArrayLike<number>; intensity: ArrayLike<number> } | null,
): PhaseTexture[] {
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  return assignment.phases.map(({ phase, shift }) => {
    const own = assignment.peaks.filter((p) => p.assignment.phaseId === phase.id);
    const found = new Set(own.flatMap((p) => p.assignment.candidates.map((c) => c.twoTheta)));
    const scanned = patternExtent(data, patternId);
    const rows: TextureRow[] = [
      ...own.map((peak) => ({
        peak,
        hklText: peak.hklText,
        hkl: peak.assignment.candidates.flatMap((c) => c.hkl),
        observed: basis === 'height' ? peak.peak.height : peak.peak.area,
        reference: peak.assignment.candidates.reduce((s, c) => s + c.intensity, 0),
        tc: NaN,
        expected: null,
      })),
      ...referenceLines(phase, lambda)
        .filter(
          (l) =>
            l.intensity >= STRONG_REFERENCE_PERCENT &&
            !found.has(l.twoTheta) &&
            scanned !== null &&
            l.twoTheta + shift >= scanned[0] &&
            l.twoTheta + shift <= scanned[1],
        )
        .map((l) => ({
          peak: null,
          hklText: formatHkl(l.hkl),
          hkl: l.hkl,
          observed: 0,
          reference: l.intensity,
          tc: NaN,
          expected: {
            twoTheta: l.twoTheta + shift,
            signal: processed
              ? signalAt(
                  processed.twoTheta,
                  processed.intensity,
                  l.twoTheta + shift,
                  data.material.toleranceDeg,
                )
              : null,
          },
        })),
    ];
    rows.sort(
      (a, b) =>
        (a.peak ? a.peak.peak.twoTheta : Infinity) - (b.peak ? b.peak.peak.twoTheta : Infinity),
    );
    const outcome = textureCoefficients(rows);
    if (!outcome.ok) return { phase, result: { reason: outcome.reason } };
    return { phase, result: { rows: rows.map((r, i) => ({ ...r, tc: outcome.tc[i] as number })) } };
  });
}

/** Numbers separated by spaces, commas or semicolons; anything else is ignored. */
export function parseNumbers(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter((t) => t !== '')
    .map(Number)
    .filter((v) => Number.isFinite(v));
}

export interface CrystallinityRun {
  /** The values used, after filling in defaults. */
  from: number;
  to: number;
  centre: number;
  fwhm: number;
  anchors: number[];
  /** Fitted peaks inside the range whose surroundings were left out of the hump fit. */
  excludedPeaks: number;
  outcome: CrystallinityOutcome;
}

/** Runs the crystallinity index for one pattern with the user's choices and the fitted peaks. */
export function runCrystallinity(
  twoTheta: ArrayLike<number>,
  intensity: ArrayLike<number>,
  choice: CrystallinityChoice,
  peaks: readonly { twoTheta: number; fwhm: number }[],
): CrystallinityRun {
  const from = choice.from ?? (twoTheta[0] as number);
  const to = choice.to ?? (twoTheta[twoTheta.length - 1] as number);
  const centre = choice.centre ?? (from + to) / 2;
  const fwhm = choice.fwhm ?? (to - from) / 4;
  const anchors = parseNumbers(choice.anchors);
  const inside = peaks.filter((p) => p.twoTheta >= from && p.twoTheta <= to);
  const exclude = inside.map(
    (p) =>
      [
        p.twoTheta - PEAK_EXCLUSION_FWHM * p.fwhm,
        p.twoTheta + PEAK_EXCLUSION_FWHM * p.fwhm,
      ] as const,
  );
  return {
    from,
    to,
    centre,
    fwhm,
    anchors,
    excludedPeaks: inside.length,
    outcome: crystallinity(
      twoTheta,
      intensity,
      [from, to],
      choice.hump === 'gaussian'
        ? { kind: 'gaussian', centre, fwhm, exclude }
        : { kind: 'anchors', positions: anchors },
    ),
  };
}

/** Pattern-character hints from the assignment, the texture coefficients and the crystallinity. */
export function characterFor(
  assignment: AssignmentResult,
  textures: readonly PhaseTexture[],
  crystallinityIndex: number | null,
): CharacterHint[] {
  const widths = assignment.peaks.map((p) => p.peak.fwhm).sort((a, b) => a - b);
  const mid = widths.length >> 1;
  const medianFwhm =
    widths.length === 0
      ? null
      : widths.length % 2
        ? (widths[mid] as number)
        : ((widths[mid - 1] as number) + (widths[mid] as number)) / 2;
  return patternCharacter({
    phases: textures.map(({ phase, result }) => {
      const rows = 'rows' in result ? result.rows : [];
      return {
        name: phase.name,
        peaks: rows.filter((r) => r.peak).map((r) => ({ hkl: r.hkl, tc: r.tc })),
        missing: rows.filter((r) => !r.peak).map((r) => r.hkl),
      };
    }),
    medianFwhm,
    crystallinity: crystallinityIndex,
  });
}
