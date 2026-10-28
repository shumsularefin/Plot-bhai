import { DEFAULT_TOLERANCE_CM } from '../../core/ftir/assign';
import type { RegionFit } from '../../core/xrd/peaks/fit';
import type { ProfileKind } from '../../core/xrd/peaks/profiles';
import { DEFAULT_FTIR_PROCESSING, type FtirProcessing } from '../../core/ftir/process';
import { EXAMPLE_BANDS, generateFtir, transmittanceOf } from '../../core/ftir/synthetic';
import type { FtirSpectrum } from '../../core/ftir/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import type { PlotSettings } from '../../ui/plot/PlotPanel';
import type { WizardState } from '../../ui/wizard/types';

/** What the plots in step 2 and the figure in step 5 show. */
export interface FtirView {
  quantity: 'absorbance' | 'transmittance';
}

/** Peak picking settings of one spectrum. */
export interface PeakSettings {
  /** Smallest prominence to keep, percent of the highest minus the lowest absorbance. */
  prominencePercent: number;
  /** Search range in cm⁻¹; null means the end of the spectrum. */
  fromCm: number | null;
  toCm: number | null;
}

export const DEFAULT_PEAK_SETTINGS: PeakSettings = {
  prominencePercent: 5,
  fromCm: null,
  toCm: null,
};

/** An assignment the user accepted or typed for the peak at this wavenumber. */
export interface Assignment {
  wavenumber: number;
  label: string;
}

/** A wavenumber range for an integrated band area, cm⁻¹. */
export interface AreaRange {
  fromCm: number | null;
  toCm: number | null;
  label: string;
}

/** Second derivative, band fitting, band areas and subtraction of one spectrum (step 4). */
export interface BandSettings {
  derivative: {
    /** Savitzky–Golay window (odd number of points) and polynomial order. */
    window: number;
    order: number;
    /** Smallest minimum kept, percent of the deepest one. */
    depthPercent: number;
    /** True when the fit's starting positions were taken from the minima. */
    used: boolean;
  };
  fit: {
    fromCm: number | null;
    toCm: number | null;
    profile: ProfileKind;
    /** Starting band positions, cm⁻¹. */
    centres: number[];
    /**
     * The last fit, cleared when its settings change; `key` records the processing it was made
     * on, so a fit made before the spectrum was processed differently is shown as out of date.
     */
    result: { key: string; fit: RegionFit } | null;
  };
  areas: {
    ranges: AreaRange[];
    /** Index of the range the others are divided by. */
    reference: number;
  };
  subtract: {
    referenceId: string | null;
    /** Scale factor k in A_sample − k · A_reference. */
    factor: number;
    /** Range where only the reference absorbs, for finding k. */
    fromCm: number | null;
    toCm: number | null;
  };
}

/**
 * Defaults of my own choosing, adjustable on screen. A 15-point window with a cubic smooths
 * noise in the second derivative while keeping bands a few tens of points wide.
 */
export const DEFAULT_BAND_SETTINGS: BandSettings = {
  derivative: { window: 15, order: 3, depthPercent: 5, used: false },
  fit: { fromCm: null, toCm: null, profile: 'pseudo-voigt', centres: [], result: null },
  areas: { ranges: [], reference: 0 },
  subtract: { referenceId: null, factor: 1, fromCm: null, toCm: null },
};

/** Everything saved for an FTIR analysis. */
export interface FtirData {
  spectra: FtirSpectrum[];
  plot: PlotSettings;
  view: FtirView;
  /** Processing settings per spectrum id. Missing means every step is off. */
  processing: Record<string, FtirProcessing>;
  /** Peak picking per spectrum id. */
  peaks: Record<string, PeakSettings>;
  /** Accepted or edited assignments per spectrum id. */
  assignments: Record<string, Assignment[]>;
  /** Band analysis per spectrum id. Missing means the defaults. */
  bands: Record<string, BandSettings>;
  /** How far a peak may lie from a typical range or band to be suggested, cm⁻¹. */
  toleranceCm: number;
}

export const initialFtirData: FtirData = {
  spectra: [],
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
  view: { quantity: 'absorbance' },
  processing: {},
  peaks: {},
  assignments: {},
  bands: {},
  toleranceCm: DEFAULT_TOLERANCE_CM,
};

/** Version of the saved shape. Bump it, and add a migration, when the shape changes. */
export const FTIR_STATE_VERSION = 3;

/** Index of the Bands step, which version 1 did not have. */
const BANDS_STEP = 3;

/**
 * Upgrades version 1 (no band analysis and no Bands step) and version 2 (no ATR correction);
 * newer or unknown versions are discarded.
 */
export function migrateFtirData(
  saved: unknown,
  version: number,
): WizardState<FtirData> | undefined {
  if (version !== 1 && version !== 2) return undefined;
  const state = saved as WizardState<Partial<FtirData>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  const shift = (step: number) => (version === 1 && step >= BANDS_STEP ? step + 1 : step);
  const processing: Record<string, FtirProcessing> = {};
  for (const [id, p] of Object.entries(state.data.processing ?? {})) {
    processing[id] = { ...p, atr: DEFAULT_FTIR_PROCESSING.atr };
  }
  return {
    step: shift(state.step),
    furthest: shift(state.furthest),
    data: {
      ...initialFtirData,
      ...state.data,
      processing,
      bands: version === 1 ? {} : (state.data.bands ?? {}),
    },
  };
}

export const processingFor = (data: Pick<FtirData, 'processing'>, id: string): FtirProcessing =>
  data.processing[id] ?? DEFAULT_FTIR_PROCESSING;
export const peaksFor = (data: Pick<FtirData, 'peaks'>, id: string): PeakSettings =>
  data.peaks[id] ?? DEFAULT_PEAK_SETTINGS;

export const bandsFor = (data: Pick<FtirData, 'bands'>, id: string): BandSettings =>
  data.bands[id] ?? DEFAULT_BAND_SETTINGS;

export function newId(): string {
  return crypto.randomUUID();
}

const EXAMPLE_NOTE =
  'Synthetic example, generated by this site from arbitrary band positions. It is not a measurement of any real material.';

/** Two synthetic example spectra: an absorbance spectrum with a sloped baseline, and its %T version without one. */
export function exampleSpectra(): FtirSpectrum[] {
  const grid = { startCm: 400, endCm: 4000, stepCm: 2 };
  const withBaseline = generateFtir({
    ...grid,
    bands: EXAMPLE_BANDS,
    baseline: { offset: 0.05, slope: 0.00006, curvature: 0.03 },
    noiseSeed: 21,
    noiseSd: 0.004,
  });
  const second = generateFtir({
    ...grid,
    bands: EXAMPLE_BANDS.slice(1, 5).map((b) => ({ ...b, height: b.height * 1.2 })),
    noiseSeed: 22,
    noiseSd: 0.004,
  });
  const make = (
    name: string,
    values: Float64Array,
    wavenumber: Float64Array,
    kind: FtirSpectrum['kind'],
    extra: string,
  ): FtirSpectrum => ({
    id: newId(),
    name,
    source: 'synthetic',
    wavenumber,
    values,
    kind,
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [{ level: 'info', text: `${EXAMPLE_NOTE} ${extra}` }],
  });
  return [
    make(
      'Example absorbance (synthetic)',
      withBaseline.absorbance,
      withBaseline.wavenumber,
      'absorbance',
      'It has a sloped, curved baseline, so try the baseline step.',
    ),
    make(
      'Example transmittance (synthetic)',
      transmittanceOf(second.absorbance),
      second.wavenumber,
      'transmittance',
      'Percent transmittance.',
    ),
  ];
}
