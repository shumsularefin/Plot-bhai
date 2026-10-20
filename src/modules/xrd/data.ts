import { examplePatterns } from '../../core/xrd/synthetic';
import type { Pattern } from '../../core/xrd/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import type { PlotSettings } from '../../ui/plot/PlotPanel';

/** Everything saved for an XRD analysis. */
export interface XrdData {
  patterns: Pattern[];
  plot: PlotSettings;
}

export const initialXrdData: XrdData = {
  patterns: [],
  plot: { normalise: false, offsetPercent: 20, export: DEFAULT_EXPORT_SETTINGS },
};

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
        text: 'Synthetic example: generated peaks on a smooth background with simulated counting noise. It is not a measurement of any real material.',
      },
    ],
  }));
}
