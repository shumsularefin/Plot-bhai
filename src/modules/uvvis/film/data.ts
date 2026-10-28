import type { RegionFit } from '../../../core/xrd/peaks/fit';
import type { ProfileKind } from '../../../core/xrd/peaks/profiles';
import type { Spectrum } from '../../../core/uvvis/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../../ui/plot/export';
import type { PlotSettings } from '../../../ui/plot/PlotPanel';

export type FilmMethod = 'plasmon' | 'swanepoel';

export const METHOD_LABELS: Record<FilmMethod, string> = {
  plasmon: 'Plasmon band fit (absorbance)',
  swanepoel: 'Thin film thickness and refractive index (Swanepoel)',
};

/** Everything saved for a plasmon or thin-film analysis. */
export interface FilmData {
  method: FilmMethod;
  spectrum: Spectrum | null;
  plasmon: {
    /** Fit range, nm. */
    fromNm: number | null;
    toNm: number | null;
    /** Starting band positions, nm. */
    centresNm: number[];
    profile: ProfileKind;
    /** The last fit (energy axis, eV) and the settings it was made with. */
    result: { key: string; fit: RegionFit } | null;
  };
  swanepoel: {
    /** Substrate given by its refractive index or by its own transmittance (percent). */
    substrateBy: 'index' | 'transmittance';
    substrateIndex: number | null;
    substrateTPct: number | null;
    /** Smallest fringe prominence, percent transmittance. */
    prominencePct: number;
    /** Wavelength range used, nm (null: the whole spectrum). */
    fromNm: number | null;
    toNm: number | null;
  };
  plot: PlotSettings;
}

/** Defaults of my own choosing, adjustable on screen. */
export const initialFilmData: FilmData = {
  method: 'plasmon',
  spectrum: null,
  plasmon: { fromNm: null, toNm: null, centresNm: [], profile: 'lorentzian', result: null },
  swanepoel: {
    substrateBy: 'index',
    substrateIndex: null,
    substrateTPct: null,
    prominencePct: 2,
    fromNm: null,
    toNm: null,
  },
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

export const FILM_STATE_VERSION = 1;
