import { DEFAULT_EXPORT_SETTINGS } from '../../../ui/plot/export';
import type { PlotSettings } from '../../../ui/plot/PlotPanel';
import type { LoadedTable } from '../data';

/** One run of the same sample, with the heating rate it was measured at. */
export interface KineticRun extends LoadedTable {
  id: number;
  /** Heating rate in K/min, or null until entered. */
  rate: number | null;
}

export type KineticMethod = 'kissinger' | 'fwo' | 'kas' | 'starink' | 'friedman' | 'coats-redfern';
/** The methods that give Ea at each conversion level from several heating rates. */
export type IsoconversionalMethod = 'fwo' | 'kas' | 'starink' | 'friedman';

export const METHOD_LABELS: Record<KineticMethod, string> = {
  kissinger: 'Kissinger (peak temperatures)',
  fwo: 'Flynn–Wall–Ozawa (isoconversional, TGA)',
  kas: 'Kissinger–Akahira–Sunose (isoconversional, TGA)',
  starink: 'Starink (isoconversional, TGA)',
  friedman: 'Friedman (differential isoconversional, TGA)',
  'coats-redfern': 'Coats–Redfern (reaction models, each run, TGA)',
};

/** Everything saved for a kinetics analysis. */
export interface KineticsData {
  runs: KineticRun[];
  nextId: number;
  method: KineticMethod;
  /** Temperature window of the event, °C. Null means the range every run covers. */
  fromC: number | null;
  toC: number | null;
  /** Width of the window for the DTG slope, °C (TGA runs, Kissinger). */
  dtgWindowC: number;
  /** DSC runs: true when the event points up in the file, false when it points down. */
  peakUp: boolean;
  /** Conversion levels for the isoconversional methods: from, to and step (fractions). */
  alphaFrom: number;
  alphaTo: number;
  alphaStep: number;
  plot: PlotSettings;
}

export const initialKineticsData: KineticsData = {
  runs: [],
  nextId: 1,
  method: 'kissinger',
  fromC: null,
  toC: null,
  dtgWindowC: 10,
  peakUp: false,
  alphaFrom: 0.1,
  alphaTo: 0.9,
  alphaStep: 0.1,
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

export const KINETICS_STATE_VERSION = 1;
