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
import type { SigmoidType } from '../../core/uvvis/crossChecks';
import {
  DEFAULT_UVVIS_PEAKS,
  NO_UVVIS_EDITS,
  type UvvisPeakEdits,
  type UvvisPeakSettings,
} from '../../core/uvvis/peaks';
import type { GapMethod, TransitionId } from '../../core/uvvis/tauc';
import type { RegionFit } from '../../core/xrd/peaks/fit';
import type { ProfileKind } from '../../core/xrd/peaks/profiles';
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
  /**
   * Other transition types reported in Results next to `transition`, each with its own region
   * (papers often give the direct and the indirect gap).
   */
  reported: TransitionId[];
  /** What was measured: a film (thickness in nm) or a solution or dispersion in a cuvette (path in cm). */
  sample: 'film' | 'solution';
  /** Film thickness in nm; null when unknown (the Tauc axis is then only proportional to α). */
  thicknessNm: number | null;
  /** Cuvette path length in cm, for a solution; null when unknown. */
  pathCm: number | null;
  /** For a film: id of a reflectance spectrum of the same film, to correct α for reflection. */
  reflectanceId: string | null;
  /** Cody plot, (α/E)^(1/2) against E, as a cross-check; region null means the suggestion. */
  cody: { enabled: boolean; region: [number, number] | null };
  /**
   * Sigmoid (Boltzmann) fit of the edge as a cross-check; type null follows the transition type,
   * range null means the suggestion.
   */
  sigmoid: { enabled: boolean; type: SigmoidType | null; range: [number, number] | null };
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
  reported: [],
  sample: 'film',
  thicknessNm: null,
  pathCm: null,
  reflectanceId: null,
  cody: { enabled: false, region: null },
  sigmoid: { enabled: false, type: null, range: null },
  regions: {},
  urbach: { enabled: false, region: null },
  derivative: 'off',
  method: null,
  baselineRegion: null,
  component: null,
};

/** Band fit on the energy axis of one spectrum (Bands step), as in the film tool. */
export interface BandFitSettings {
  fromNm: number | null;
  toNm: number | null;
  profile: ProfileKind;
  /** Starting band positions, nm. */
  centresNm: number[];
  /** The last fit and the key of the data and settings it was made with. */
  result: { key: string; fit: RegionFit } | null;
}

export const DEFAULT_BAND_FIT: BandFitSettings = {
  fromNm: null,
  toNm: null,
  profile: 'pseudo-voigt',
  centresNm: [],
  result: null,
};

/** The combined figures in Results. */
export interface FigureChoices {
  /** Label the bands of the peak table in the combined spectra figure. */
  peakLabels: boolean;
  /** Spectra drawn in the combined Tauc figure; null means every spectrum with a fit. */
  taucIds: string[] | null;
  /** Transition of the combined Tauc figure; null means that of the first spectrum. */
  taucTransition: TransitionId | null;
}

export const DEFAULT_FIGURES: FigureChoices = {
  peakLabels: true,
  taucIds: null,
  taucTransition: null,
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
  /** Peak table settings and hand edits per spectrum id. Missing means the defaults. */
  peaks: Record<string, UvvisPeakSettings>;
  peakEdits: Record<string, UvvisPeakEdits>;
  /** Band fit per spectrum id. */
  bandFit: Record<string, BandFitSettings>;
  /** Combined figures in Results. */
  figures: FigureChoices;
  /** Figure settings of the combined Tauc figure (the spectra figure uses `plot`). */
  taucPlot: PlotSettings;
}

export const initialUvvisData: UvvisData = {
  spectra: [],
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
  cleaning: {},
  view: { quantity: 'measured', xUnit: 'nm' },
  lambdaRange: { fromNm: null, toNm: null },
  bandGap: {},
  peaks: {},
  peakEdits: {},
  bandFit: {},
  figures: DEFAULT_FIGURES,
  taucPlot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

/** Version of the saved shape. Bump it, and extend migrateUvvisData, when the shape changes. */
export const UVVIS_STATE_VERSION = 5;

/** Index of the Bands step, which versions 1 to 4 did not have. */
const BANDS_STEP = 2;

/** The band gap fields added in version 5, with values that leave a saved result unchanged. */
const V5_GAP_FIELDS = {
  reported: [],
  sample: 'film',
  pathCm: null,
  reflectanceId: null,
  cody: DEFAULT_BAND_GAP.cody,
  sigmoid: DEFAULT_BAND_GAP.sigmoid,
} as const satisfies Partial<BandGapChoice>;

type V4Choice = Omit<BandGapChoice, keyof typeof V5_GAP_FIELDS>;

/**
 * Upgrades saved sessions: version 1 (sub-stage 8a) had no band gap settings; version 2 read Eg
 * only where the Tauc line meets the axis; version 3 had no second-component subtraction; version 4
 * had no Bands step (peak table and band fit), path length, reported transitions, cross-checks,
 * reflection correction or combined figures. A version 2 spectrum keeps that method and the old
 * way of suggesting the edge region, so its band gap stays the same until the user changes it.
 * The new fields get values that change no saved number, and the step index moves past the new
 * Bands step.
 */
export function migrateUvvisData(
  saved: unknown,
  version: number,
): WizardState<UvvisData> | undefined {
  if (!Number.isInteger(version) || version < 1 || version > 4) return undefined;
  const state = saved as WizardState<Partial<UvvisData> & Pick<UvvisData, 'spectra' | 'plot'>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  const v4 = version === 4 ? state : migrateToV4(state, version);
  const bandGap: Record<string, BandGapChoice> = {};
  for (const [id, choice] of Object.entries(v4.data.bandGap ?? {})) {
    bandGap[id] = { ...(choice as V4Choice), ...V5_GAP_FIELDS };
  }
  const shift = (step: number) => (step >= BANDS_STEP ? step + 1 : step);
  return {
    step: shift(v4.step),
    furthest: shift(v4.furthest),
    data: { ...initialUvvisData, ...v4.data, bandGap },
  };
}

function migrateToV4(
  state: WizardState<Partial<UvvisData> & Pick<UvvisData, 'spectra' | 'plot'>>,
  version: number,
): WizardState<Partial<UvvisData> & Pick<UvvisData, 'spectra' | 'plot'>> {
  if (version === 1) return { ...state, data: { ...state.data, bandGap: {} } };
  const old = (state.data.bandGap ?? {}) as Record<
    string,
    Omit<V4Choice, 'method' | 'baselineRegion' | 'component'> &
      Partial<Pick<V4Choice, 'method' | 'baselineRegion'>>
  >;
  const bandGap: Record<string, V4Choice> = {};
  if (version === 3) {
    for (const [id, choice] of Object.entries(old)) {
      bandGap[id] = {
        ...choice,
        method: choice.method ?? null,
        baselineRegion: choice.baselineRegion ?? null,
        component: null,
      };
    }
    return { ...state, data: { ...state.data, bandGap: bandGap as Record<string, BandGapChoice> } };
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
  return { ...state, data: { ...state.data, bandGap: bandGap as Record<string, BandGapChoice> } };
}

export function bandGapFor(data: Pick<UvvisData, 'bandGap'>, id: string): BandGapChoice {
  return data.bandGap[id] ?? DEFAULT_BAND_GAP;
}

export const peaksFor = (data: Pick<UvvisData, 'peaks'>, id: string): UvvisPeakSettings =>
  data.peaks[id] ?? DEFAULT_UVVIS_PEAKS;

export const peakEditsFor = (data: Pick<UvvisData, 'peakEdits'>, id: string): UvvisPeakEdits =>
  data.peakEdits[id] ?? NO_UVVIS_EDITS;

export const bandFitFor = (data: Pick<UvvisData, 'bandFit'>, id: string): BandFitSettings =>
  data.bandFit[id] ?? DEFAULT_BAND_FIT;

/** Transitions reported in Results: the one in use first, then the others in table order. */
export function reportedTransitions(choice: BandGapChoice): TransitionId[] {
  return [choice.transition, ...choice.reported.filter((t) => t !== choice.transition)];
}

/** Optical path in nm for α = ln(10)·A/path: the film thickness, or the cuvette path length. */
export function opticalPathNm(choice: BandGapChoice): number | null {
  if (choice.sample === 'solution') return choice.pathCm !== null ? choice.pathCm * 1e7 : null;
  return choice.thicknessNm;
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
