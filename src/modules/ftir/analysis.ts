import { pickPeaks, type FtirPeak } from '../../core/ftir/peaks';
import {
  DEFAULT_FTIR_PROCESSING,
  processSpectrum,
  type FtirProcessed,
} from '../../core/ftir/process';
import type { FtirSpectrum } from '../../core/ftir/types';
import { peaksFor, processingFor, type Assignment, type FtirData, type PeakSettings } from './data';

/** Processes every spectrum with its own settings. */
export function processAll(
  spectra: readonly FtirSpectrum[],
  processing: FtirData['processing'],
): FtirProcessed[] {
  return spectra.map((s) => processSpectrum(s, processing[s.id] ?? DEFAULT_FTIR_PROCESSING));
}

/** Peaks of one processed spectrum; the prominence threshold is a percentage of its absorbance range. */
export function peaksOf(processed: FtirProcessed, settings: PeakSettings): FtirPeak[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of processed.absorbance) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!(hi > lo)) return [];
  return pickPeaks(processed.wavenumber, processed.absorbance, {
    minProminence: ((hi - lo) * settings.prominencePercent) / 100,
    ...(settings.fromCm !== null && { fromCm: settings.fromCm }),
    ...(settings.toCm !== null && { toCm: settings.toCm }),
  });
}

export interface PeakRow {
  spectrum: FtirSpectrum;
  peak: FtirPeak;
  /** The assignment the user accepted or typed for this peak, if any. */
  assignment: string;
}

/**
 * Within this distance (cm⁻¹) a stored assignment is re-attached to a peak after reprocessing.
 * My own choice, from the example spectra (tests/ftir-assignments.test.ts): switching baseline,
 * smoothing, ATR correction and normalisation on and off moves the narrow bands by up to 4.8 cm⁻¹
 * and the 300 cm⁻¹ wide O–H band by up to 15.9 cm⁻¹, because a sloping correction moves the
 * maximum of a broad band further. 20 cm⁻¹ covers that with a margin; an assignment that moved
 * more than `MOVED_NOTE_CM` is shown with the position it was made at, so the user can check it.
 */
export const ASSIGNMENT_MATCH_CM = 20;

/** An assignment re-attached further than this (cm⁻¹) from where it was made is pointed out. */
export const MOVED_NOTE_CM = 2;

export interface AttachedAssignments {
  /** The assignment attached to each peak, in the order of the peaks; undefined for none. */
  byPeak: (Assignment | undefined)[];
  /** Assignments with no peak within `ASSIGNMENT_MATCH_CM`, or whose nearest peak went to another. */
  detached: Assignment[];
}

/**
 * Attaches stored assignments to the peaks found now, one assignment per peak: every pair of an
 * assignment and a peak within `ASSIGNMENT_MATCH_CM` is taken in order of increasing distance,
 * and a pair is kept when neither is taken yet. The result depends only on the stored positions
 * and the current peaks, not on the order in which settings were changed. Assignments left over
 * are returned as detached, never dropped; they attach again when a peak returns near them.
 */
export function attachAssignments(
  assignments: readonly Assignment[] | undefined,
  peaks: readonly FtirPeak[],
): AttachedAssignments {
  const list = assignments ?? [];
  const pairs: { a: number; p: number; d: number }[] = [];
  list.forEach((assignment, a) => {
    peaks.forEach((peak, p) => {
      const d = Math.abs(assignment.wavenumber - peak.wavenumber);
      if (d <= ASSIGNMENT_MATCH_CM) pairs.push({ a, p, d });
    });
  });
  pairs.sort((x, y) => x.d - y.d || x.a - y.a || x.p - y.p);
  const byPeak: (Assignment | undefined)[] = peaks.map(() => undefined);
  const used = new Set<number>();
  for (const { a, p } of pairs) {
    if (used.has(a) || byPeak[p] !== undefined) continue;
    byPeak[p] = list[a];
    used.add(a);
  }
  return { byPeak, detached: list.filter((_, a) => !used.has(a)) };
}

/** Peaks of one spectrum of the analysis, with the processing and peak settings it has now. */
export function peaksOfSpectrum(data: FtirData, spectrum: FtirSpectrum): FtirPeak[] {
  return peaksOf(
    processSpectrum(spectrum, processingFor(data, spectrum.id)),
    peaksFor(data, spectrum.id),
  );
}

/** Every peak of every spectrum with its assignment, in spectrum order and then by wavenumber. */
export function peakRows(data: FtirData): PeakRow[] {
  const processed = processAll(data.spectra, data.processing);
  return data.spectra.flatMap((spectrum, i) => {
    const p = processed[i];
    if (!p) return [];
    const peaks = peaksOf(p, peaksFor(data, spectrum.id));
    const { byPeak } = attachAssignments(data.assignments[spectrum.id], peaks);
    return peaks.map((peak, k) => ({ spectrum, peak, assignment: byPeak[k]?.label ?? '' }));
  });
}

/** Assignments of every spectrum that are not attached to a peak now. */
export function detachedAssignments(
  data: FtirData,
): { spectrum: FtirSpectrum; assignment: Assignment }[] {
  return data.spectra.flatMap((spectrum) =>
    attachAssignments(data.assignments[spectrum.id], peaksOfSpectrum(data, spectrum)).detached.map(
      (assignment) => ({ spectrum, assignment }),
    ),
  );
}
