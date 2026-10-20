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
}

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

export function peaksFor(data: XrdData, id: string): PeakState {
  return data.peaks[id] ?? DEFAULT_PEAK_STATE;
}

export const initialXrdData: XrdData = {
  patterns: [],
  plot: { normalise: false, offsetPercent: 20, export: DEFAULT_EXPORT_SETTINGS },
  radiation: DEFAULT_RADIATION,
  processing: {},
  peaks: {},
};

/** Version of the saved shape. Bump it, and extend migrateXrdData, when the shape changes. */
export const XRD_STATE_VERSION = 4;

/**
 * Upgrades saved sessions step by step: version 2 (Stage 1) had no radiation or processing
 * settings; version 3 (Stage 2) had no peak state.
 */
export function migrateXrdData(saved: unknown, version: number): WizardState<XrdData> | undefined {
  if (version < 2 || version > 3) return undefined;
  const state = saved as WizardState<Partial<XrdData> & Pick<XrdData, 'patterns' | 'plot'>>;
  return {
    ...state,
    data: {
      ...state.data,
      radiation: state.data.radiation ?? DEFAULT_RADIATION,
      processing: state.data.processing ?? {},
      peaks: {},
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
