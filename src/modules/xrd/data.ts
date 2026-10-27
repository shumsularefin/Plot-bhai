import type { CorrectionMethod } from '../../core/xrd/instrument/correction';
import type { CurveKind } from '../../core/xrd/instrument/curve';
import { DEFAULT_DETECTION, type DetectionOptions } from '../../core/xrd/peaks/detect';
import type { FitOptions, PeakGuess, RegionFit } from '../../core/xrd/peaks/fit';
import { DEFAULT_PROCESSING, type ProcessingSettings } from '../../core/xrd/process/pipeline';
import { DEFAULT_RADIATION, type RadiationSettings } from '../../core/xrd/radiation';
import { examplePatterns } from '../../core/xrd/synthetic';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { Pattern } from '../../core/xrd/types';
import {
  DEFAULT_CHOICES,
  type RefineChoices,
  type RietveldResult,
} from '../../core/xrd/rietveld/refine';
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
  /** Reference phases chosen in steps 3 and 4. */
  material: MaterialState;
  /** Texture coefficient and crystallinity settings (results step). */
  analysis: AnalysisSettings;
  /** Basic Rietveld refinement (step 5). */
  rietveld: RietveldState;
  /** Values reported in a paper, per pattern id, to compare with (results step). */
  paper?: Record<string, PaperCheckState>;
}

/** What a paper reports for a pattern digitized from its figure, and how it calculated it. */
export interface PaperCheckState {
  /** The fit the peak choices belong to; choices of an earlier fit are dropped. */
  fitKey: string;
  k: number;
  lambdaA: number;
  /** Instrument FWHM the paper subtracted, degrees 2θ; 0 for none. */
  instrumentDeg: number;
  correction: 'gaussian' | 'lorentzian';
  method: 'scherrer' | 'wh-udm';
  /** Per fitted peak (by position in the sorted list): whether it is compared, and the paper's values. */
  peaks: Record<number, { use: boolean; reportedNm: number | null; reportedFwhm: number | null }>;
  /** The paper's overall size (mean Scherrer or Williamson–Hall), nm. */
  reportedNm: number | null;
  /** The paper's microstrain (Williamson–Hall), dimensionless. */
  reportedStrain: number | null;
}

export const DEFAULT_PAPER_CHECK: Omit<PaperCheckState, 'fitKey'> = {
  k: 0.9,
  lambdaA: 1.5406,
  instrumentDeg: 0,
  correction: 'gaussian',
  method: 'scherrer',
  peaks: {},
  reportedNm: null,
  reportedStrain: null,
};

/** Settings and last result of the basic Rietveld refinement. */
export interface RietveldState {
  /** Pattern refined; missing means the first. */
  patternId?: string;
  /** Candidate phases left out of the refinement. */
  excluded: string[];
  /** Preferred-orientation direction typed per phase id, for example "0 0 1"; empty means none. */
  orientation: Record<string, string>;
  choices: RefineChoices;
  backgroundTerms: number;
  /**
   * Refine the cleaned data (zero shift, smoothing, background and Kα2 stripping from step 2,
   * without normalisation) rather than the uploaded data. Missing (older sessions) means true.
   */
  useCleaned?: boolean;
  /** 2θ range refined, degrees; null means the whole pattern. */
  from: number | null;
  to: number | null;
  /**
   * Last result, with a key of the settings it was made with (to tell when it is out of date) and
   * its methods sentences.
   */
  result: { key: string; outcome: RietveldResult; methods: string } | null;
}

export const DEFAULT_RIETVELD: RietveldState = {
  excluded: [],
  orientation: {},
  choices: DEFAULT_CHOICES,
  backgroundTerms: 6,
  useCleaned: true,
  from: null,
  to: null,
  result: null,
};

/** Settings of the extra analyses in the results step. */
export interface AnalysisSettings {
  /** Peak measure for the texture coefficient. */
  textureBasis: 'height' | 'area';
  /** Crystallinity settings by pattern id. Missing means the defaults. */
  crystallinity: Record<string, CrystallinityChoice>;
}

/** Crystallinity index settings of one pattern. Null values mean "work it out from the pattern". */
export interface CrystallinityChoice {
  /** Calculate the index and list it in the results summary. */
  enabled: boolean;
  /** 2θ range, degrees; null means the whole pattern. */
  from: number | null;
  to: number | null;
  hump: 'gaussian' | 'anchors';
  /** Gaussian hump centre and FWHM, degrees 2θ; null means the middle of the range and a quarter of it. */
  centre: number | null;
  fwhm: number | null;
  /** Anchor 2θ positions, typed as numbers separated by spaces or commas. */
  anchors: string;
}

export const DEFAULT_CRYSTALLINITY: CrystallinityChoice = {
  enabled: false,
  from: null,
  to: null,
  hump: 'gaussian',
  centre: null,
  fwhm: null,
  anchors: '',
};

export const DEFAULT_ANALYSIS: AnalysisSettings = { textureBasis: 'area', crystallinity: {} };

export function crystallinityFor(data: XrdData, id: string): CrystallinityChoice {
  return data.analysis.crystallinity[id] ?? DEFAULT_CRYSTALLINITY;
}

/** Calculated profile drawn over the measured pattern in step 4 (a display aid, not a refinement). */
export interface SimulationState {
  show: boolean;
  /** Width of every calculated line, degrees 2θ. */
  fwhmDeg: number;
  /** Lorentzian fraction of the pseudo-Voigt line shape. */
  eta: number;
}

/** The candidate phases to compare (library in data/reference, or CIF files the user loaded). */
export interface MaterialState {
  /** Phases to compare in step 4, in the order chosen: library phase ids and loaded-CIF ids. */
  candidates: string[];
  /** Candidates the user selected to use for labels and results. */
  phaseIds: string[];
  /** Structures read from CIF files the user loaded, with their calculated lines. */
  userPhases: ReferencePhase[];
  /** Phases whose stick patterns are switched off in the comparison. */
  hidden: string[];
  /** JCPDS/ICDD card numbers typed by the user, by phase id. Never checked by the app. */
  jcpds: Record<string, string>;
  /** A reference line counts as found within this many degrees 2θ. */
  toleranceDeg: number;
  simulation: SimulationState;
}

export const DEFAULT_SIMULATION: SimulationState = { show: false, fwhmDeg: 0.15, eta: 0.5 };

export const DEFAULT_MATERIAL: MaterialState = {
  candidates: [],
  phaseIds: [],
  userPhases: [],
  hidden: [],
  jcpds: {},
  toleranceDeg: 0.15,
  simulation: DEFAULT_SIMULATION,
};

/**
 * The material choice of a version 6 to 8 session, when one family of the former inorganic
 * library was chosen and phases were ticked within it: the ticked phases become the candidates.
 * That library has since been replaced by the online COD search, so the material step asks the
 * user to add them again from COD.
 */
export function upgradeMaterial(saved: Record<string, unknown> | undefined): MaterialState {
  if (!saved) return DEFAULT_MATERIAL;
  const phaseIds = Array.isArray(saved['phaseIds']) ? (saved['phaseIds'] as string[]) : [];
  return {
    ...DEFAULT_MATERIAL,
    candidates: phaseIds,
    phaseIds,
    hidden: Array.isArray(saved['hidden']) ? (saved['hidden'] as string[]) : [],
    jcpds: (saved['jcpds'] as Record<string, string> | undefined) ?? {},
    toleranceDeg:
      typeof saved['toleranceDeg'] === 'number'
        ? saved['toleranceDeg']
        : DEFAULT_MATERIAL.toleranceDeg,
  };
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

/*
 * The filled-in settings are cached per stored object, so the same stored settings always give
 * the same object: hooks that recompute when their settings change (cleaning and peak search in
 * web workers) would otherwise restart on every render, without end.
 */
const filledPeaks = new WeakMap<PeakState, PeakState>();

export function peaksFor(data: XrdData, id: string): PeakState {
  const stored = data.peaks[id];
  if (!stored) return DEFAULT_PEAK_STATE;
  let filled = filledPeaks.get(stored);
  if (!filled) {
    // Sessions saved before the noise tests existed have no values for them: use the defaults.
    filled = { ...stored, detection: { ...DEFAULT_DETECTION, ...stored.detection } };
    filledPeaks.set(stored, filled);
  }
  return filled;
}

export const initialXrdData: XrdData = {
  patterns: [],
  plot: { normalise: false, offsetPercent: 20, export: DEFAULT_EXPORT_SETTINGS },
  radiation: DEFAULT_RADIATION,
  processing: {},
  peaks: {},
  instrument: DEFAULT_INSTRUMENT,
  results: DEFAULT_RESULTS,
  material: DEFAULT_MATERIAL,
  analysis: DEFAULT_ANALYSIS,
  rietveld: DEFAULT_RIETVELD,
};

/** Version of the saved shape. Bump it, and extend migrateXrdData, when the shape changes. */
export const XRD_STATE_VERSION = 10;

/**
 * Upgrades saved sessions: version 2 (Stage 1) had no radiation or processing settings;
 * version 3 (Stage 2) had no peak state; version 4 (Stage 3) had no instrument settings;
 * version 5 (Stage 4) had no size and strain settings; version 6 (Stage 5) had no reference
 * material choice; version 7 (sub-stage 6c) had no texture and crystallinity settings;
 * version 8 chose one library family instead of a list of candidate phases (see upgradeMaterial);
 * version 9 had no Rietveld step, so steps from "Fit peaks" on were one place earlier.
 */
export function migrateXrdData(saved: unknown, version: number): WizardState<XrdData> | undefined {
  if (version < 2 || version > 9) return undefined;
  const state = saved as WizardState<Partial<XrdData> & Pick<XrdData, 'patterns' | 'plot'>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  const RIETVELD_STEP = 4;
  const shift = (index: number) => (index >= RIETVELD_STEP ? index + 1 : index);
  return {
    ...state,
    step: shift(state.step),
    furthest: shift(state.furthest),
    data: {
      ...state.data,
      radiation: state.data.radiation ?? DEFAULT_RADIATION,
      processing: state.data.processing ?? {},
      peaks: state.data.peaks ?? {},
      instrument: state.data.instrument ?? DEFAULT_INSTRUMENT,
      results: state.data.results ?? DEFAULT_RESULTS,
      material:
        version <= 8
          ? upgradeMaterial(state.data.material as Record<string, unknown> | undefined)
          : (state.data.material ?? DEFAULT_MATERIAL),
      analysis: state.data.analysis ?? DEFAULT_ANALYSIS,
      rietveld: DEFAULT_RIETVELD,
    },
  };
}

const filledProcessing = new WeakMap<ProcessingSettings, ProcessingSettings>();

export function processingFor(data: XrdData, id: string): ProcessingSettings {
  const stored = data.processing[id];
  if (!stored) return DEFAULT_PROCESSING;
  let filled = filledProcessing.get(stored);
  if (!filled) {
    // Settings saved before arPLS existed have no width for it. Cached like peaksFor.
    filled = { ...stored, background: { ...DEFAULT_PROCESSING.background, ...stored.background } };
    filledProcessing.set(stored, filled);
  }
  return filled;
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
