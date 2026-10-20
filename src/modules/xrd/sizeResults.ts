import { correctPeaks, type CorrectedPeak } from '../../core/xrd/instrument/correction';
import { ANODES } from '../../core/xrd/radiation';
import {
  dislocationDensity,
  halderWagner,
  monshi,
  scherrer,
  sizeStrainPlot,
  specificSurfaceArea,
  williamsonHallUdedm,
  williamsonHallUdm,
  williamsonHallUsdm,
  type Estimate,
  type LineMethod,
  type LineResult,
  type ScherrerResult,
  type SizePeak,
  type SizeSettings,
} from '../../core/xrd/size/methods';
import type { DataMessage } from '../../core/xrd/types';
import { peaksFor, type PatternChoices, type XrdData } from './data';
import { instrumentModel } from './instrument';

const DEG = Math.PI / 180;

export type MethodId = 'scherrer' | LineMethod;

export const METHOD_NAMES: Record<MethodId, string> = {
  scherrer: 'Scherrer',
  monshi: 'Monshi–Scherrer',
  'wh-udm': 'Williamson–Hall UDM',
  'wh-usdm': 'Williamson–Hall USDM',
  'wh-udedm': 'Williamson–Hall UDEDM',
  ssp: 'Size–strain plot',
  hw: 'Halder–Wagner',
};

export const METHOD_SHORT: Record<MethodId, string> = {
  scherrer: 'Scherrer',
  monshi: 'Monshi',
  'wh-udm': 'W–H UDM',
  'wh-usdm': 'W–H USDM',
  'wh-udedm': 'W–H UDEDM',
  ssp: 'SSP',
  hw: 'H–W',
};

export const LINE_METHODS: LineMethod[] = ['monshi', 'wh-udm', 'wh-usdm', 'wh-udedm', 'ssp', 'hw'];

/** One fitted peak with its corrected width and the user's choices. */
export interface ResultPeak extends CorrectedPeak {
  /** Position in the sorted list of fitted peaks (the key for the user's choices). */
  index: number;
  used: boolean;
  /** Can be used at all: a corrected width exists. */
  usable: boolean;
  modulusGPa: number | null;
}

/** One row of the summary table. */
export interface SummaryRow {
  method: MethodId;
  /** Size in nm; for Scherrer the mean with sigma = standard deviation over peaks. */
  size: Estimate | null;
  strain: Estimate | null;
  stress: Estimate | null;
  energyDensity: Estimate | null;
  dislocation: Estimate | null;
  surface: Estimate | null;
  rSquared: number;
  n: number;
  messages: DataMessage[];
  unavailable?: string;
}

export type SizeResults =
  | { kind: 'none'; reason: string }
  | {
      kind: 'ok';
      skipped: boolean;
      fitKey: string;
      peaks: ResultPeak[];
      settings: SizeSettings;
      scherrer: ScherrerResult;
      lines: Record<LineMethod, LineResult>;
      summary: SummaryRow[];
    };

const EMPTY_CHOICES = (fitKey: string): PatternChoices => ({ fitKey, use: {}, modulus: {} });

/** The user's choices for a pattern, or empty ones when they belong to an earlier fit. */
export function choicesFor(data: XrdData, patternId: string, fitKey: string): PatternChoices {
  const saved = data.results.patterns[patternId];
  return saved && saved.fitKey === fitKey ? saved : EMPTY_CHOICES(fitKey);
}

/**
 * Everything the results step shows for one pattern, recomputed from the saved settings so it
 * follows every change to K, the correction, the modulus or the peak selection at once.
 */
export function sizeResults(data: XrdData, patternId: string): SizeResults {
  const fit = peaksFor(data, patternId).fit;
  if (!fit || fit.regions.every((r) => r.peaks.length === 0))
    return { kind: 'none', reason: 'This pattern has no fitted peaks yet. Fit them in step 5.' };
  const instrument = instrumentModel(data.instrument);
  if ('problem' in instrument)
    return {
      kind: 'none',
      reason: `Instrument correction (step 6) is incomplete: ${instrument.problem}`,
    };
  const skipped = 'skipped' in instrument;

  const observed = fit.regions
    .flatMap((r) =>
      r.peaks.map((p) => ({
        twoTheta: p.center,
        fwhm: p.fwhm,
        fwhmSigma: p.sigma.fwhm,
        eta: p.eta,
      })),
    )
    .sort((a, b) => a.twoTheta - b.twoTheta);
  const corrected: CorrectedPeak[] =
    'model' in instrument
      ? correctPeaks(observed, { ...instrument.model, method: data.instrument.method })
      : observed.map((p) => ({
          twoTheta: p.twoTheta,
          observed: p.fwhm,
          observedSigma: p.fwhmSigma,
          instrument: 0,
          instrumentSigma: 0,
          corrected: p.fwhm,
          correctedSigma: p.fwhmSigma,
          ratio: 0,
          limited: false,
          messages: [],
        }));

  const choices = choicesFor(data, patternId, fit.inputKey);
  const peaks: ResultPeak[] = corrected.map((c, index) => {
    const usable = Number.isFinite(c.corrected) && c.corrected > 0;
    return {
      ...c,
      index,
      usable,
      used: usable && (choices.use[index] ?? !c.limited),
      modulusGPa: choices.modulus[index] ?? null,
    };
  });

  const settings: SizeSettings = {
    k: data.results.k,
    lambdaNm: ANODES[data.radiation.anode].kAlpha1 / 10,
    modulusGPa: data.results.modulusGPa,
  };
  const selected: SizePeak[] = peaks
    .filter((p) => p.used)
    .map((p) => ({
      twoTheta: p.twoTheta,
      beta: p.corrected * DEG,
      betaSigma: p.correctedSigma * DEG,
      modulusGPa: p.modulusGPa,
    }));

  const s = scherrer(selected, settings);
  const lines: Record<LineMethod, LineResult> = {
    monshi: monshi(selected, settings),
    'wh-udm': williamsonHallUdm(selected, settings),
    'wh-usdm': williamsonHallUsdm(selected, settings),
    'wh-udedm': williamsonHallUdedm(selected, settings),
    ssp: sizeStrainPlot(selected, settings),
    hw: halderWagner(selected, settings),
  };

  const density = data.results.densityGcm3;
  const derived = (size: Estimate | null) => ({
    dislocation: size ? dislocationDensity(size) : null,
    surface: size && density !== null ? specificSurfaceArea(size, density) : null,
  });
  const scherrerSize = selected.length > 0 ? { value: s.mean, sigma: s.sd } : null;
  const summary: SummaryRow[] = [
    {
      method: 'scherrer',
      size: scherrerSize,
      strain: null,
      stress: null,
      energyDensity: null,
      ...derived(scherrerSize),
      rSquared: NaN,
      n: selected.length,
      messages: s.messages,
    },
    ...LINE_METHODS.map((method) => {
      const r = lines[method];
      return {
        method,
        size: r.size,
        strain: r.strain,
        stress: r.stress ?? null,
        energyDensity: r.energyDensity ?? null,
        ...derived(r.size),
        rSquared: r.fit?.rSquared ?? NaN,
        n: r.points.length,
        messages: r.messages,
        ...(r.unavailable !== undefined && { unavailable: r.unavailable }),
      };
    }),
  ];

  return {
    kind: 'ok',
    skipped,
    fitKey: fit.inputKey,
    peaks,
    settings,
    scherrer: s,
    lines,
    summary,
  };
}
