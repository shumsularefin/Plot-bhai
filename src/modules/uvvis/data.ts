import {
  DEFAULT_CLEANING,
  type CleaningSettings,
  type DisplayQuantity,
} from '../../core/uvvis/process';
import {
  blankAbsorbance,
  directGapAbsorbance,
  directGapReflectance,
  EXAMPLE_BAND_GAP_EV,
} from '../../core/uvvis/synthetic';
import type { GapMethod, TransitionId } from '../../core/uvvis/tauc';
import type { Spectrum } from '../../core/uvvis/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import type { PlotSettings } from '../../ui/plot/PlotPanel';
import type { WizardState } from '../../ui/wizard/types';

/** What the plots show. */
export interface ViewSettings {
  /** 'measured' shows every spectrum as it was recorded. */
  quantity: DisplayQuantity | 'measured';
  xUnit: 'nm' | 'ev';
}

/** Where to look for the absorption maximum. Null means the end of the spectrum. */
export interface LambdaRange {
  fromNm: number | null;
  toNm: number | null;
}

/** Band gap settings of one spectrum. */
export interface BandGapChoice {
  transition: TransitionId;
  /** Film thickness in nm; null when unknown (the Tauc axis is then only proportional to α). */
  thicknessNm: number | null;
  /** Fit region in eV per transition type; a missing entry means the automatic suggestion. */
  regions: Partial<Record<TransitionId, [number, number]>>;
  /** Urbach energy from the tail below the edge. */
  urbach: { enabled: boolean; region: [number, number] | null };
  /** Derivative method: off, or the peak of dS/dE (linear) or d ln S/dE (log). */
  derivative: 'off' | 'linear' | 'log';
  /**
   * How Eg is read from the Tauc line (see `GapMethod`); null chooses automatically: the sub-gap
   * baseline is subtracted when one is found, otherwise the line's axis intercept is used.
   */
  method: GapMethod | null;
  /** Sub-gap baseline region in eV; null means the automatic suggestion. */
  baselineRegion: [number, number] | null;
  /**
   * Set on sessions saved before the baseline methods (version 2): the edge region is suggested
   * as it was then, so the saved band gap does not change. Cleared when the user picks a method.
   */
  legacySuggestion?: true;
  /**
   * For the method 'subtract-component': the spectrum of the second component (a dye, modifier
   * or support measured alone) and its scale factor c, or null to fit c below the edge.
   */
  component: { spectrumId: string; factor: number | null } | null;
}

export const DEFAULT_BAND_GAP: BandGapChoice = {
  transition: 'direct-allowed',
  thicknessNm: null,
  regions: {},
  urbach: { enabled: false, region: null },
  derivative: 'off',
  method: null,
  baselineRegion: null,
  component: null,
};

/** Everything saved for a UV-Vis analysis. */
export interface UvvisData {
  spectra: Spectrum[];
  plot: PlotSettings;
  /** Cleaning settings per spectrum id. Missing means every step is off. */
  cleaning: Record<string, CleaningSettings>;
  view: ViewSettings;
  lambdaRange: LambdaRange;
  /** Band gap settings per spectrum id. Missing means the defaults. */
  bandGap: Record<string, BandGapChoice>;
}

export const initialUvvisData: UvvisData = {
  spectra: [],
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
  cleaning: {},
  view: { quantity: 'measured', xUnit: 'nm' },
  lambdaRange: { fromNm: null, toNm: null },
  bandGap: {},
};

/** Version of the saved shape. Bump it, and extend migrateUvvisData, when the shape changes. */
export const UVVIS_STATE_VERSION = 4;

/**
 * Upgrades saved sessions: version 1 (sub-stage 8a) had no band gap settings; version 2 read Eg
 * only where the Tauc line meets the axis; version 3 had no second-component subtraction. A
 * version 2 spectrum keeps that method and the old way of suggesting the edge region, so its band
 * gap stays the same until the user changes it.
 */
export function migrateUvvisData(
  saved: unknown,
  version: number,
): WizardState<UvvisData> | undefined {
  if (version !== 1 && version !== 2 && version !== 3) return undefined;
  const state = saved as WizardState<Partial<UvvisData> & Pick<UvvisData, 'spectra' | 'plot'>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  if (version === 1) return { ...state, data: { ...initialUvvisData, ...state.data, bandGap: {} } };
  const old = (state.data.bandGap ?? {}) as Record<
    string,
    Omit<BandGapChoice, 'method' | 'baselineRegion' | 'component'> &
      Partial<Pick<BandGapChoice, 'method' | 'baselineRegion'>>
  >;
  const bandGap: Record<string, BandGapChoice> = {};
  if (version === 3) {
    for (const [id, choice] of Object.entries(old)) {
      bandGap[id] = {
        ...choice,
        method: choice.method ?? null,
        baselineRegion: choice.baselineRegion ?? null,
        component: null,
      };
    }
    return { ...state, data: { ...initialUvvisData, ...state.data, bandGap } };
  }
  // Spectra without saved settings used the defaults, which are made explicit here.
  for (const spectrum of state.data.spectra ?? []) {
    const choice = old[spectrum.id] ?? DEFAULT_BAND_GAP;
    bandGap[spectrum.id] = {
      ...choice,
      method: 'axis',
      baselineRegion: null,
      component: null,
      legacySuggestion: true,
    };
  }
  return { ...state, data: { ...initialUvvisData, ...state.data, bandGap } };
}

export function bandGapFor(data: Pick<UvvisData, 'bandGap'>, id: string): BandGapChoice {
  return data.bandGap[id] ?? DEFAULT_BAND_GAP;
}

export function cleaningFor(data: Pick<UvvisData, 'cleaning'>, id: string): CleaningSettings {
  return data.cleaning[id] ?? DEFAULT_CLEANING;
}

export function newId(): string {
  return crypto.randomUUID();
}

const EXAMPLE_NOTE = `Synthetic example, generated by this site with a made-up band gap of ${EXAMPLE_BAND_GAP_EV} eV (direct allowed transition). It is not a measurement of any real material.`;

/** Synthetic example spectra: a sample with a solvent baseline, a diffuse reflectance sample and the blank. */
export function exampleSpectra(): Spectrum[] {
  const grid = { startNm: 250, endNm: 800, stepNm: 1 };
  const blank = blankAbsorbance({ ...grid, offset: 0.05, slopePerNm: 0.0002 });
  const sample = directGapAbsorbance({
    ...grid,
    bandGapEv: EXAMPLE_BAND_GAP_EV,
    baseline: 0,
    noiseSeed: 11,
    noiseSd: 0.004,
  });
  const reflectance = directGapReflectance({
    ...grid,
    bandGapEv: EXAMPLE_BAND_GAP_EV,
    noiseSeed: 12,
    noiseSd: 0.05,
  });
  const make = (
    name: string,
    spectrum: { wavelengthNm: Float64Array; values: Float64Array },
    kind: Spectrum['kind'],
    scale: Spectrum['scale'],
    extra: string,
  ): Spectrum => ({
    id: newId(),
    name,
    source: 'synthetic',
    ...spectrum,
    kind,
    scale,
    kindOrigin: 'generated',
    synthetic: true,
    notes: [{ level: 'info', text: `${EXAMPLE_NOTE} ${extra}` }],
  });
  return [
    make(
      'Example absorbance (synthetic)',
      {
        wavelengthNm: sample.wavelengthNm,
        values: sample.values.map((v, i) => v + (blank.values[i] as number)),
      },
      'absorbance',
      'percent',
      'The solvent blank is added to it, so subtract the blank in the next step.',
    ),
    make('Example blank (synthetic)', blank, 'absorbance', 'percent', 'This is the solvent blank.'),
    make(
      'Example diffuse reflectance (synthetic)',
      reflectance,
      'reflectance',
      'percent',
      'Percent diffuse reflectance.',
    ),
  ];
}
