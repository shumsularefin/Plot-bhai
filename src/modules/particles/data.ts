import {
  type Calibration,
  type LengthUnit,
  type Measurement,
  type Point,
  type Rect,
} from '../../core/particles/geometry';
import { DEFAULT_ADJUST } from '../../core/particles/detect/adjust';
import {
  DEFAULT_DETECT_SETTINGS,
  type DetectSettings,
  type ThresholdMethod,
} from '../../core/particles/detect/pipeline';
import type { Runs } from '../../core/particles/detect/regions';
import type { BinMethod } from '../../core/particles/distribution';
import type { InterceptStructure } from '../../core/particles/stereology';
import type { WizardState } from '../../ui/wizard/types';

/** Facts about the loaded image. The image itself is stored separately (see imageStore.ts). */
export interface ImageInfo {
  /** Changes with every new image; keys the cached decoded copy. */
  id: string;
  name: string;
  /** Size of the original image in pixels. */
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'tiff';
  /** True for the generated example image. Never a real micrograph. */
  synthetic: boolean;
  /** Messages from reading the file, for example about a page that was skipped. */
  notes: string[];
}

/** The scale bar the user drew; the length is filled in afterwards. */
export interface ScaleBar {
  p1: Point;
  p2: Point;
  length: number | null;
  unit: LengthUnit;
}

/** A particle found by the detection or added or changed by hand. Its pixels are on the working copy grid. */
export interface Particle {
  id: number;
  runs: Runs;
  source: 'auto' | 'added' | 'merged' | 'cut';
}

/** Which detected particles are shown and counted. Size limits are in `unit`. */
export interface ParticleFilters {
  unit: 'px' | LengthUnit;
  minDiameter: number | null;
  maxDiameter: number | null;
  minCircularity: number | null;
  excludeEdge: boolean;
}

export const DEFAULT_FILTERS: ParticleFilters = {
  unit: 'px',
  minDiameter: null,
  maxDiameter: null,
  minCircularity: null,
  excludeEdge: false,
};

/** Groups of extra measurements, as in ImageJ's Set Measurements (see measureColumns.ts). */
export type MeasureGroup =
  | 'area'
  | 'perimeter'
  | 'centroid'
  | 'bounds'
  | 'ellipse'
  | 'shape'
  | 'feret'
  | 'grey'
  | 'minmax'
  | 'median'
  | 'intden'
  | 'moments';

/** Automatic detection settings, its result and the user's edits of it. */
export interface DetectState {
  settings: DetectSettings;
  filters: ParticleFilters;
  particles: Particle[];
  /** The number the next particle gets; ids are never reused. */
  nextParticleId: number;
  /** Settings and crop of the last detection, to tell when the result is out of date. */
  detectedWith: string | null;
  /** True once the user has merged, cut, added or deleted a particle. */
  edited: boolean;
  /** The grey level the automatic method chose in the last detection, if one was used. */
  thresholdUsed: number | null;
  /** True when the last detection's automatic method found no two peaks and used Otsu. */
  fellBack: boolean;
  /** Extra measurement groups shown in the particle table and CSV (Set measurements). */
  columns: MeasureGroup[];
  /** The typical diameter (working copy pixels) the last detection used to separate clumps. */
  diameterUsed: number | null;
}

export const initialDetectState: DetectState = {
  settings: DEFAULT_DETECT_SETTINGS,
  filters: DEFAULT_FILTERS,
  particles: [],
  nextParticleId: 1,
  detectedWith: null,
  edited: false,
  thresholdUsed: null,
  fellBack: false,
  columns: [],
  diameterUsed: null,
};

/** Which diameter of each particle goes into the distribution. */
export type SizeMeasure = 'equal-area' | 'longest' | 'shortest';

export const SIZE_MEASURE_NAMES: Record<SizeMeasure, string> = {
  'equal-area': 'Equal-area diameter',
  longest: 'Longest caliper (Feret) diameter',
  shortest: 'Shortest caliper (Feret) diameter',
};

/** One image's diameters, kept so that several images can be pooled into one distribution. */
export interface PoolEntry {
  id: string;
  name: string;
  /** nm when the image had a scale, otherwise px. Entries of the two kinds are never mixed. */
  unit: 'nm' | 'px';
  /** The three diameters of every particle, in `unit`. */
  equalArea: number[];
  longest: number[];
  shortest: number[];
}

/** Settings of the distribution step. */
export interface DistributionSettings {
  measure: SizeMeasure;
  /** Unit for display and export when the image has a scale. */
  unit: LengthUnit;
  binMethod: BinMethod;
  manualBins: number;
  /** Use the particles of the image on screen (detected particles and, if chosen, hand measurements). */
  useCurrent: boolean;
  includeHand: boolean;
  showFit: 'lognormal' | 'normal' | 'none';
  showCumulative: boolean;
}

export const DEFAULT_DISTRIBUTION: DistributionSettings = {
  measure: 'equal-area',
  unit: 'nm',
  binMethod: 'freedman-diaconis',
  manualBins: 12,
  useCurrent: true,
  includeHand: false,
  showFit: 'lognormal',
  showCumulative: false,
};

/** Settings of the area fraction, line intercept and XRD comparison section. */
export interface StereologySettings {
  /** What the detected regions are, which decides the intercept formula. */
  structure: InterceptStructure;
  /** Test lines in each direction (horizontal and vertical). */
  lines: number;
  /** Crystallite size the user typed from an XRD analysis, in nm. */
  xrdSizeNm: number | null;
  /** Name of the XRD method that gave it, for the table and the methods text. */
  xrdMethod: string;
}

export const DEFAULT_STEREOLOGY: StereologySettings = {
  structure: 'phase',
  lines: 10,
  xrdSizeNm: null,
  xrdMethod: '',
};

/** Everything saved for a particle size analysis. */
export interface ParticleData {
  image: ImageInfo | null;
  /** Region to analyse (original pixels); null means the whole image. */
  crop: Rect | null;
  scale: ScaleBar | null;
  measurements: Measurement[];
  /** The number the next measurement gets; ids are never reused. */
  nextId: number;
  detect: DetectState;
  distribution: DistributionSettings;
  /** Images saved for pooling. Kept when another image is loaded. */
  pool: PoolEntry[];
  stereology: StereologySettings;
}

export const initialParticleData: ParticleData = {
  image: null,
  crop: null,
  scale: null,
  measurements: [],
  nextId: 1,
  detect: initialDetectState,
  distribution: DEFAULT_DISTRIBUTION,
  pool: [],
  stereology: DEFAULT_STEREOLOGY,
};

/** Version of the saved shape. Bump it, and add a migration, when the shape changes. */
export const PARTICLE_STATE_VERSION = 6;

/** Index of the "Measure by hand" step, which versions 1 to 3 had before the last step. */
const OLD_MEASURE_STEP = 3;

/** Index of the "Adjust the image" step, added in version 6 before Detect particles. */
const ADJUST_STEP = 2;

/**
 * Upgrades saved sessions: version 1 (sub-stage 10a) had no automatic detection state, version 2
 * (10b) had no distribution settings or pool, and versions 1 to 3 had a separate step for hand
 * measurements (now part of Detect particles) and splitting by necks only, versions 1 to 4
 * had no area fraction and intercept settings, and versions 1 to 5 had no "Adjust the image"
 * step, image adjustments, choice of automatic threshold or extra measurements.
 */
export function migrateParticleData(
  saved: unknown,
  version: number,
): WizardState<ParticleData> | undefined {
  const v5 = version === 5 ? (saved as WizardState<ParticleData>) : toVersion5(saved, version);
  if (!v5 || typeof v5 !== 'object' || !v5.data) return undefined;
  const shift = (step: number) => (step >= ADJUST_STEP ? step + 1 : step);
  const detect = { ...initialDetectState, ...v5.data.detect };
  // Version 5 called the only automatic method 'otsu'.
  const threshold = detect.settings.threshold as Omit<DetectSettings['threshold'], 'method'> & {
    method: ThresholdMethod | 'otsu';
  };
  return {
    step: shift(v5.step),
    furthest: shift(v5.furthest),
    data: {
      ...v5.data,
      detect: {
        ...detect,
        settings: {
          ...detect.settings,
          adjust: DEFAULT_ADJUST,
          threshold: {
            ...DEFAULT_DETECT_SETTINGS.threshold,
            ...threshold,
            method: threshold.method === 'otsu' ? 'auto' : threshold.method,
            auto: 'otsu',
          },
        },
      },
    },
  };
}

/** Versions 1 to 4 brought to the shape of version 5. */
function toVersion5(saved: unknown, version: number): WizardState<ParticleData> | undefined {
  if (version < 1 || version > 4) return undefined;
  const state = saved as WizardState<Partial<ParticleData>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  if (version === 4)
    return {
      ...state,
      data: { ...initialParticleData, ...state.data, stereology: DEFAULT_STEREOLOGY },
    };
  const detect: Partial<DetectState> =
    version === 1 ? initialDetectState : (state.data.detect ?? initialDetectState);
  const settings = { ...DEFAULT_DETECT_SETTINGS, ...detect.settings };
  const shift = (step: number) => (step > OLD_MEASURE_STEP ? step - 1 : step);
  return {
    step: shift(state.step),
    furthest: shift(state.furthest),
    data: {
      ...initialParticleData,
      ...state.data,
      detect: {
        ...initialDetectState,
        ...detect,
        settings: { ...settings, split: { ...DEFAULT_DETECT_SETTINGS.split, ...settings.split } },
      },
    },
  };
}

/** The usable calibration: a drawn bar with a positive length, otherwise null. */
export function calibrationOf(scale: ScaleBar | null): Calibration | null {
  if (!scale || scale.length === null || !(scale.length > 0)) return null;
  return { p1: scale.p1, p2: scale.p2, length: scale.length, unit: scale.unit };
}

export function newId(): string {
  return crypto.randomUUID();
}
