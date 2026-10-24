import { pickPeaks, type FtirPeak } from '../../core/ftir/peaks';
import {
  DEFAULT_FTIR_PROCESSING,
  processSpectrum,
  type FtirProcessed,
} from '../../core/ftir/process';
import type { FtirSpectrum } from '../../core/ftir/types';
import { peaksFor, type FtirData, type PeakSettings } from './data';

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

/** Within this distance (cm⁻¹) a stored assignment is taken to belong to a peak. */
export const ASSIGNMENT_MATCH_CM = 2;

/** The assignment stored for the peak nearest to this wavenumber, or ''. */
export function assignmentFor(
  assignments: readonly { wavenumber: number; label: string }[] | undefined,
  wavenumber: number,
): string {
  let best = '';
  let distance = ASSIGNMENT_MATCH_CM;
  for (const a of assignments ?? []) {
    const d = Math.abs(a.wavenumber - wavenumber);
    if (d <= distance) {
      best = a.label;
      distance = d;
    }
  }
  return best;
}

/** Every peak of every spectrum with its assignment, in spectrum order and then by wavenumber. */
export function peakRows(data: FtirData): PeakRow[] {
  const processed = processAll(data.spectra, data.processing);
  return data.spectra.flatMap((spectrum, i) => {
    const p = processed[i];
    if (!p) return [];
    return peaksOf(p, peaksFor(data, spectrum.id)).map((peak) => ({
      spectrum,
      peak,
      assignment: assignmentFor(data.assignments[spectrum.id], peak.wavenumber),
    }));
  });
}
