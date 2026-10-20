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
}

export const initialXrdData: XrdData = {
  patterns: [],
  plot: { normalise: false, offsetPercent: 20, export: DEFAULT_EXPORT_SETTINGS },
  radiation: DEFAULT_RADIATION,
  processing: {},
};

/** Version of the saved shape. Bump it, and extend migrateXrdData, when the shape changes. */
export const XRD_STATE_VERSION = 3;

/** Upgrades saved sessions: version 2 (Stage 1) had no radiation or processing settings. */
export function migrateXrdData(saved: unknown, version: number): WizardState<XrdData> | undefined {
  if (version !== 2) return undefined;
  const state = saved as WizardState<Omit<XrdData, 'radiation' | 'processing'>>;
  return { ...state, data: { ...state.data, radiation: DEFAULT_RADIATION, processing: {} } };
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
