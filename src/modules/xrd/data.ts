import type { CorrectionMethod } from '../../core/xrd/instrument/correction';
import type { CurveKind } from '../../core/xrd/instrument/curve';
import { DEFAULT_DETECTION, type DetectionOptions } from '../../core/xrd/peaks/detect';
import type { FitOptions, PeakGuess, RegionFit } from '../../core/xrd/peaks/fit';
import { DEFAULT_PROCESSING, type ProcessingSettings } from '../../core/xrd/process/pipeline';
import { DEFAULT_RADIATION, type RadiationSettings } from '../../core/xrd/radiation';
import { examplePatterns } from '../../core/xrd/synthetic';
import type { Pattern } from '../../core/xrd/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import type { PlotSettings } from '../../ui/plot/PlotPanel';
import type { WizardState } from '../../ui/wizard/types';

/** Everything saved for an XRD analysis. */
export interface XrdData {
  patterns: Pattern[];
  plot: PlotSettings;
  radiation: RadiationSettings;
  /** Preprocessing settings per pattern id. Missing means every step is off. */
  processing: Record<string, ProcessingSettings>;
  /** Peak detection and fitting per pattern id. */
  peaks: Record<string, PeakState>;
  /** One instrument for all patterns. */
  instrument: InstrumentState;
  /** Size and strain settings, shared by all patterns, plus each pattern's peak choices. */
  results: ResultsSettings;
}

export interface ResultsSettings {
  /** Scherrer shape factor K, dimensionless. */
  k: number;
  /** Young's modulus for USDM and UDEDM, GPa. */
  modulusGPa: number | null;
  /** Material density for the specific surface area, g/cm³. */
  densityGcm3: number | null;
  patterns: Record<string, PatternChoices>;
}

/**
 * Per-pattern choices, by position in the sorted list of fitted peaks. They belong to one fit
 * (fitKey) and are dropped when the peaks are fitted again.
 */
export interface PatternChoices {
  fitKey: string;
  /** Explicit include (true) or exclude (false); otherwise peaks limited by resolution are left out. */
  use: Record<number, boolean>;
  /** Young's modulus for this peak's direction, GPa. */
  modulus: Record<number, number>;
}

export const DEFAULT_RESULTS: ResultsSettings = {
  k: 0.9,
  modulusGPa: null,
  densityGcm3: null,
  patterns: {},
};

/** Where the instrument width comes from, or 'skip' to leave widths uncorrected. */
export type InstrumentSource = 'constant' | 'caglioti' | 'standard' | 'skip';

export interface InstrumentState {
  source: InstrumentSource;
  /** Typed constant instrument FWHM, degrees 2θ. */
  constantFwhm: number | null;
  /**
   * Typed Caglioti parameters. 'fwhm': FWHM² = U tan²θ + V tanθ + W in degrees²;
   * 'gsas': GSAS-II Gaussian σ² in centidegrees².
   */
  caglioti: { u: number | null; v: number | null; w: number | null; convention: 'fwhm' | 'gsas' };
  /** Instrument Lorentzian fraction η for the Voigt correction when the width is typed in. */
  eta: number;
  method: CorrectionMethod;
  standard: StandardState | null;
}

/** A measured line-profile standard, cleaned and fitted like a sample. */
export interface StandardState {
  pattern: Pattern;
  material: 'LaB6' | 'Si' | 'other';
  processing: ProcessingSettings;
  peaks: PeakState;
  /** Fitted standard peaks (by position in the fitted list) left out of the curve. */
  excluded: number[];
  curve: CurveKind;
}

export const DEFAULT_INSTRUMENT: InstrumentState = {
  source: 'constant',
  constantFwhm: null,
  caglioti: { u: null, v: null, w: null, convention: 'fwhm' },
  eta: 0,
  method: 'gaussian',
  standard: null,
};

export interface PeakState {
  detection: DetectionOptions;
  fitOptions: FitOptions;
  /** Starting positions and widths for fitting. Updated to the fitted values after a fit. */
  guesses: PeakGuess[];
  /** Automatic detection has run at least once (it runs by itself only the first time). */
  detected: boolean;
  /** Last fit, and the inputs it used, so a changed input marks it out of date. */
  fit: { regions: RegionFit[]; inputKey: string } | null;
}

export const DEFAULT_PEAK_STATE: PeakState = {
  detection: DEFAULT_DETECTION,
  fitOptions: { profile: 'pseudo-voigt', fixedEta: null },
  guesses: [],
  detected: false,
  fit: null,
};

/** Identifies the inputs of a fit, so a later change to any of them marks the fit out of date. */
export function fitInputKey(
  guesses: readonly PeakGuess[],
  fitOptions: FitOptions,
  processing: ProcessingSettings,
  radiation: RadiationSettings,
): string {
  return JSON.stringify({ guesses, fitOptions, processing, radiation });
}

export function peaksFor(data: XrdData, id: string): PeakState {
  return data.peaks[id] ?? DEFAULT_PEAK_STATE;
}

export const initialXrdData: XrdData = {
  patterns: [],
  plot: { normalise: false, offsetPercent: 20, export: DEFAULT_EXPORT_SETTINGS },
  radiation: DEFAULT_RADIATION,
  processing: {},
  peaks: {},
  instrument: DEFAULT_INSTRUMENT,
  results: DEFAULT_RESULTS,
};

/** Version of the saved shape. Bump it, and extend migrateXrdData, when the shape changes. */
export const XRD_STATE_VERSION = 6;

/**
 * Upgrades saved sessions: version 2 (Stage 1) had no radiation or processing settings;
 * version 3 (Stage 2) had no peak state; version 4 (Stage 3) had no instrument settings;
 * version 5 (Stage 4) had no size and strain settings.
 */
export function migrateXrdData(saved: unknown, version: number): WizardState<XrdData> | undefined {
  if (version < 2 || version > 5) return undefined;
  const state = saved as WizardState<Partial<XrdData> & Pick<XrdData, 'patterns' | 'plot'>>;
  return {
    ...state,
    data: {
      ...state.data,
      radiation: state.data.radiation ?? DEFAULT_RADIATION,
      processing: state.data.processing ?? {},
      peaks: state.data.peaks ?? {},
      instrument: state.data.instrument ?? DEFAULT_INSTRUMENT,
      results: DEFAULT_RESULTS,
    },
  };
}

export function processingFor(data: XrdData, id: string): ProcessingSettings {
  return data.processing[id] ?? DEFAULT_PROCESSING;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** The synthetic example patterns as stored patterns. Clearly marked as not real data. */
export function examplePatternRecords(): Pattern[] {
  return examplePatterns().map((example) => ({
    id: newId(),
    name: example.name,
    source: 'synthetic',
    twoTheta: example.twoTheta,
    intensity: example.intensity,
    intensityUnit: 'counts',
    unitOrigin: 'generated',
    synthetic: true,
    notes: [
      {
        level: 'info',
        text: 'Synthetic example: generated peaks (each with a Cu Kα2 line) on a smooth background with simulated counting noise. It is not a measurement of any real material.',
      },
    ],
  }));
}
