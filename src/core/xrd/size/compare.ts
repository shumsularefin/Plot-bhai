/*
 * Comparing crystallite sizes reported in a paper with sizes recalculated from peak widths
 * (here usually widths read off the paper's own figure). The sizes come from the existing
 * methods (scherrer, williamsonHallUdm); this file only lines them up with the reported numbers
 * and looks for the usual reasons they differ.
 */

import { correctWidth } from '../instrument/correction';
import { scherrer, williamsonHallUdm, type SizePeak } from './methods';

const DEG = Math.PI / 180;

/** The calculation settings the paper states (or that are assumed when it does not). */
export interface PaperSettings {
  k: number;
  /** Wavelength, ångström. */
  lambdaA: number;
  /** Instrument FWHM the paper subtracted, degrees 2θ (0 when none). */
  instrumentDeg: number;
  correction: 'gaussian' | 'lorentzian';
}

/** One peak: the width measured here and what the paper reports for it. */
export interface ComparedPeakInput {
  twoTheta: number;
  /** FWHM measured here, degrees 2θ. */
  fwhm: number;
  /** Crystallite size the paper gives for this peak, nm (null when it gives none). */
  reportedNm: number | null;
  /** FWHM the paper gives for this peak, degrees 2θ (null when it gives none). */
  reportedFwhm: number | null;
}

/** Relative difference (a − b) / b, or NaN. */
export const relativeDifference = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a - b) / b : NaN;

/** A possible reason for a mismatch, when it reproduces the paper's number. */
export interface Explanation {
  text: string;
  /** The size this slip would give, nm. */
  sizeNm: number;
}

export interface ComparedPeak extends ComparedPeakInput {
  /** Width after the paper's instrument correction, degrees 2θ (NaN when nothing is left). */
  corrected: number;
  /** Scherrer size from the width measured here with the paper's settings, nm. */
  sizeNm: number;
  /** (recalculated − reported) / reported. */
  sizeDifference: number;
  /** FWHM (degrees 2θ) that the paper's size implies with its own settings: β = Kλ / (D cos θ), plus the instrument width back. */
  impliedFwhm: number;
  explanations: Explanation[];
}

/** Within this fraction, a slip "reproduces" the reported size. */
const MATCH = 0.05;

/** Instrument width added back to a sample width, the inverse of the correction. */
function addInstrument(sample: number, s: PaperSettings): number {
  if (s.instrumentDeg <= 0) return sample;
  return s.correction === 'gaussian'
    ? Math.sqrt(sample ** 2 + s.instrumentDeg ** 2)
    : sample + s.instrumentDeg;
}

/**
 * Sizes that common slips would give, kept when one comes within 5 % of the reported size.
 * Each is computed with D = K λ / (β cos θ) and one thing changed.
 */
function explain(peak: { twoTheta: number; beta: number }, s: PaperSettings, reported: number) {
  const lambdaNm = s.lambdaA / 10;
  const theta = (peak.twoTheta / 2) * DEG;
  const slips: Explanation[] = [
    {
      text: 'The width was used in degrees instead of radians.',
      sizeNm: (s.k * lambdaNm) / ((peak.beta / DEG) * Math.cos(theta)),
    },
    {
      text: 'cos 2θ was used instead of cos θ.',
      sizeNm: (s.k * lambdaNm) / (peak.beta * Math.cos(2 * theta)),
    },
    {
      text: 'The wavelength was used in ångström where nanometres were needed (a factor of 10).',
      sizeNm: (s.k * s.lambdaA) / (peak.beta * Math.cos(theta)),
    },
    {
      text: 'Half the width (the half width at half maximum) was used instead of the full width.',
      sizeNm: (s.k * lambdaNm) / ((peak.beta / 2) * Math.cos(theta)),
    },
  ];
  return slips.filter((e) => Math.abs(relativeDifference(e.sizeNm, reported)) <= MATCH);
}

/** Per-peak Scherrer comparison. */
export function comparePeaks(
  peaks: readonly ComparedPeakInput[],
  s: PaperSettings,
): ComparedPeak[] {
  const lambdaNm = s.lambdaA / 10;
  return peaks.map((p) => {
    const corrected =
      s.instrumentDeg > 0 ? correctWidth(p.fwhm, s.instrumentDeg, s.correction).width : p.fwhm;
    const usable = corrected > 0;
    const sizeNm = usable
      ? (scherrer(
          [{ twoTheta: p.twoTheta, beta: corrected * DEG, betaSigma: 0, modulusGPa: null }],
          {
            k: s.k,
            lambdaNm,
            modulusGPa: null,
          },
        ).rows[0]?.size.value ?? NaN)
      : NaN;
    const reported = p.reportedNm;
    const impliedSample =
      reported && reported > 0
        ? (s.k * lambdaNm) / (reported * Math.cos((p.twoTheta / 2) * DEG)) / DEG
        : NaN;
    const sizeDifference = reported ? relativeDifference(sizeNm, reported) : NaN;
    const explanations =
      reported && usable && Math.abs(sizeDifference) > 0.15
        ? explain({ twoTheta: p.twoTheta, beta: corrected * DEG }, s, reported)
        : [];
    return {
      ...p,
      corrected: usable ? corrected : NaN,
      sizeNm,
      sizeDifference,
      impliedFwhm: Number.isFinite(impliedSample) ? addInstrument(impliedSample, s) : NaN,
      explanations,
    };
  });
}

export interface OverallComparison {
  /** Mean of the per-peak Scherrer sizes, or the Williamson–Hall size, nm. */
  sizeNm: number;
  /** Williamson–Hall microstrain (dimensionless), NaN for Scherrer. */
  strain: number;
  sizeDifference: number;
  strainDifference: number;
  /** Plain-language problems from the method itself (too few peaks, negative slope). */
  messages: string[];
}

/** The paper's overall value against the mean Scherrer size or the Williamson–Hall (UDM) line. */
export function compareOverall(
  peaks: readonly ComparedPeak[],
  method: 'scherrer' | 'wh-udm',
  s: PaperSettings,
  reportedNm: number | null,
  reportedStrain: number | null,
): OverallComparison {
  const usable = peaks.filter((p) => Number.isFinite(p.corrected));
  const sizePeaks: SizePeak[] = usable.map((p) => ({
    twoTheta: p.twoTheta,
    beta: p.corrected * DEG,
    betaSigma: 0,
    modulusGPa: null,
  }));
  const settings = { k: s.k, lambdaNm: s.lambdaA / 10, modulusGPa: null };
  let sizeNm: number;
  let strain = NaN;
  let messages: string[];
  if (method === 'scherrer') {
    const r = scherrer(sizePeaks, settings);
    sizeNm = r.mean;
    messages = r.messages.map((m) => m.text);
  } else {
    const r = williamsonHallUdm(sizePeaks, settings);
    sizeNm = r.size?.value ?? NaN;
    strain = r.strain?.value ?? NaN;
    messages = r.messages.filter((m) => m.level !== 'info').map((m) => m.text);
  }
  return {
    sizeNm,
    strain,
    sizeDifference: reportedNm ? relativeDifference(sizeNm, reportedNm) : NaN,
    strainDifference: reportedStrain ? relativeDifference(strain, reportedStrain) : NaN,
    messages,
  };
}
