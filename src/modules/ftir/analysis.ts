import {
  intensityClass,
  peakShapes,
  type IntensityClass,
  type PeakShape,
} from '../../core/ftir/peakShape';
import { nearestMaximum, peakAt, pickPeaks, type FtirPeak } from '../../core/ftir/peaks';
import {
  DEFAULT_FTIR_PROCESSING,
  processSpectrum,
  type FtirProcessed,
} from '../../core/ftir/process';
import type { FtirSpectrum } from '../../core/ftir/types';
import {
  NO_PEAK_EDITS,
  peakEditsFor,
  peaksFor,
  processingFor,
  type Assignment,
  type FtirData,
  type PeakEdits,
  type PeakSettings,
} from './data';

/** Processes every spectrum with its own settings. */
export function processAll(
  spectra: readonly FtirSpectrum[],
  processing: FtirData['processing'],
): FtirProcessed[] {
  return spectra.map((s) => processSpectrum(s, processing[s.id] ?? DEFAULT_FTIR_PROCESSING));
}

/**
 * A click within this distance of a local maximum (cm⁻¹) adds the peak at the maximum; further
 * away it adds the peak exactly where clicked (a shoulder on a flank). My own choice: 2.5 times
 * the common 4 cm⁻¹ resolution, about the precision of a tap on a phone-sized plot.
 */
export const SNAP_CM = 10;

/** A peak of the table: picked, added by hand, or an accepted shoulder, with its shape. */
export interface TablePeak extends FtirPeak {
  origin: 'picked' | 'hand' | 'shoulder';
  /** Id of the hand edit, for peaks added by hand and shoulders. */
  handId?: string;
  /** Width, area and local baseline; null for a shoulder, which has no maximum of its own. */
  shape: PeakShape | null;
  /** Intensity class from the height above the local baseline; null for a shoulder. */
  intensity: IntensityClass | null;
  /** Width and area are unreliable: the band overlaps a neighbour or a shoulder (or is one). */
  overlap: boolean;
}

/** Peaks found by the prominence threshold alone, before hand edits. */
export function pickedPeaksOf(processed: FtirProcessed, settings: PeakSettings): FtirPeak[] {
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

/**
 * Peaks of one processed spectrum: those picked with the prominence threshold (a percentage of
 * its absorbance range), less the ones removed by hand, plus the ones added by hand, each with
 * width, area and intensity class (src/core/ftir/peakShape.ts). Increasing wavenumber.
 */
export function peaksOf(
  processed: FtirProcessed,
  settings: PeakSettings,
  edits: PeakEdits = NO_PEAK_EDITS,
): TablePeak[] {
  const x = processed.wavenumber;
  const y = processed.absorbance;
  const picked = pickedPeaksOf(processed, settings);
  const hidden = pairByPosition(
    edits.removed.map((wavenumber) => ({ wavenumber })),
    picked,
  );
  const kept = picked.filter((_, k) => hidden[k] === undefined);
  const step =
    x.length > 1 ? Math.abs((x[x.length - 1] as number) - (x[0] as number)) / (x.length - 1) : 0;
  const peaks: Omit<TablePeak, 'shape' | 'intensity' | 'overlap' | 'relative'>[] = kept.map(
    (p) => ({
      ...p,
      origin: 'picked',
    }),
  );
  for (const hand of edits.added) {
    const at = hand.shoulder
      ? hand.wavenumber
      : (nearestMaximum(x, y, hand.wavenumber, SNAP_CM) ?? hand.wavenumber);
    // A picked peak at the same place is the same band; keep it once.
    if (peaks.some((p) => Math.abs(p.wavenumber - at) <= step)) continue;
    const p = peakAt(x, y, at);
    if (p) peaks.push({ ...p, origin: hand.shoulder ? 'shoulder' : 'hand', handId: hand.id });
  }
  peaks.sort((a, b) => a.wavenumber - b.wavenumber);
  const maxima = peaks.filter((p) => p.origin !== 'shoulder');
  const shapes = peakShapes(
    x,
    y,
    maxima.map((p) => p.wavenumber),
    settings.fromCm ?? -Infinity,
    settings.toCm ?? Infinity,
  );
  const shoulders = peaks.filter((p) => p.origin === 'shoulder').map((p) => p.wavenumber);
  const highest = shapes.reduce((m, s) => Math.max(m, s.heightAbove > 0 ? s.heightAbove : 0), 0);
  const top = peaks.reduce((m, p) => Math.max(m, p.height), 0);
  let k = 0;
  return peaks.map((p) => {
    const relative = top > 0 ? (100 * p.height) / top : 0;
    if (p.origin === 'shoulder')
      return { ...p, relative, shape: null, intensity: null, overlap: true };
    const shape = shapes[k++] as PeakShape;
    const nearShoulder = shoulders.some((c) => c > shape.fromCm && c < shape.toCm);
    return {
      ...p,
      relative,
      shape,
      intensity:
        highest > 0 && shape.heightAbove > 0
          ? intensityClass((100 * shape.heightAbove) / highest, shape.fwhm)
          : null,
      overlap: shape.overlap || nearShoulder,
    };
  });
}

export interface PeakRow {
  spectrum: FtirSpectrum;
  peak: TablePeak;
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
  peaks: readonly Pick<FtirPeak, 'wavenumber'>[],
): AttachedAssignments {
  const list = assignments ?? [];
  const byPeak = pairByPosition(list, peaks);
  const used = new Set(byPeak);
  return { byPeak, detached: list.filter((a) => !used.has(a)) };
}

/**
 * Pairs stored positions with peaks, one to one: every pair within `ASSIGNMENT_MATCH_CM` is taken
 * in order of increasing distance and kept when neither is taken yet. Returns, for each peak, the
 * stored item paired with it (undefined for none). Used for assignments and for removed peaks.
 */
function pairByPosition<T extends { wavenumber: number }>(
  stored: readonly T[],
  peaks: readonly Pick<FtirPeak, 'wavenumber'>[],
): (T | undefined)[] {
  const pairs: { a: number; p: number; d: number }[] = [];
  stored.forEach((item, a) => {
    peaks.forEach((peak, p) => {
      const d = Math.abs(item.wavenumber - peak.wavenumber);
      if (d <= ASSIGNMENT_MATCH_CM) pairs.push({ a, p, d });
    });
  });
  pairs.sort((x, y) => x.d - y.d || x.a - y.a || x.p - y.p);
  const byPeak: (T | undefined)[] = peaks.map(() => undefined);
  const used = new Set<number>();
  for (const { a, p } of pairs) {
    if (used.has(a) || byPeak[p] !== undefined) continue;
    byPeak[p] = stored[a];
    used.add(a);
  }
  return byPeak;
}

/** Peaks of one spectrum of the analysis, with the processing and peak settings it has now. */
export function peaksOfSpectrum(data: FtirData, spectrum: FtirSpectrum): TablePeak[] {
  return peaksOf(
    processSpectrum(spectrum, processingFor(data, spectrum.id)),
    peaksFor(data, spectrum.id),
    peakEditsFor(data, spectrum.id),
  );
}

/** Every peak of every spectrum with its assignment, in spectrum order and then by wavenumber. */
export function peakRows(data: FtirData): PeakRow[] {
  const processed = processAll(data.spectra, data.processing);
  return data.spectra.flatMap((spectrum, i) => {
    const p = processed[i];
    if (!p) return [];
    const peaks = peaksOf(p, peaksFor(data, spectrum.id), peakEditsFor(data, spectrum.id));
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
