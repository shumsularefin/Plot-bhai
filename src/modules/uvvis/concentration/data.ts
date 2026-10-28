import type { Spectrum } from '../../../core/uvvis/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../../ui/plot/export';
import type { PlotSettings } from '../../../ui/plot/PlotPanel';

/** A standard of known concentration, or a sample taken at a time during the experiment. */
export type SampleRole = 'standard' | 'timed';

/** One measurement: a loaded spectrum, or an absorbance typed by hand. */
export interface ConcentrationSample {
  id: string;
  role: SampleRole;
  name: string;
  /** Null when the absorbance was typed instead. */
  spectrum: Spectrum | null;
  /** Absorbance typed by hand (used only without a spectrum). */
  typedAbsorbance: number | null;
  /** Concentration in `unit` for a standard, time in minutes for a timed sample. */
  value: number | null;
}

/** Everything saved for a concentration and kinetics analysis. */
export interface ConcentrationData {
  samples: ConcentrationSample[];
  /** Wavelength the absorbance is read at, nm. Null means the automatic choice (the maximum). */
  wavelengthNm: number | null;
  /** Absorbance is averaged over ± this many nm (0 reads the single interpolated value). */
  halfWidthNm: number;
  /** Where the automatic choice looks for the maximum, nm (null: the whole spectrum). */
  searchFromNm: number | null;
  searchToNm: number | null;
  /** Cell path length b, cm. */
  pathCm: number;
  /** Concentration unit of the standards, as the user writes it (for example mg/L or mol/L). */
  unit: string;
  /** Fit the calibration line through the origin (blank-corrected standards). */
  throughOrigin: boolean;
  plot: PlotSettings;
}

export const initialConcentrationData: ConcentrationData = {
  samples: [],
  wavelengthNm: null,
  halfWidthNm: 0,
  searchFromNm: null,
  searchToNm: null,
  pathCm: 1,
  unit: 'mg/L',
  throughOrigin: false,
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

export const CONCENTRATION_STATE_VERSION = 1;
