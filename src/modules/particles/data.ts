import {
  type Calibration,
  type LengthUnit,
  type Measurement,
  type Point,
  type Rect,
} from '../../core/particles/geometry';
import { DEFAULT_DETECT_SETTINGS, type DetectSettings } from '../../core/particles/detect/pipeline';
import type { Runs } from '../../core/particles/detect/regions';
import type { BinMethod } from '../../core/particles/distribution';
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
  /** The grey level Otsu chose in the last detection, if it was used. */
  thresholdUsed: number | null;
}

export const initialDetectState: DetectState = {
  settings: DEFAULT_DETECT_SETTINGS,
  filters: DEFAULT_FILTERS,
  particles: [],
  nextParticleId: 1,
  detectedWith: null,
  edited: false,
  thresholdUsed: null,
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
};

/** Version of the saved shape. Bump it, and add a migration, when the shape changes. */
export const PARTICLE_STATE_VERSION = 3;

/**
 * Upgrades saved sessions: version 1 (sub-stage 10a) had no automatic detection state, and
 * version 2 (10b) had no distribution settings or pool.
 */
export function migrateParticleData(
  saved: unknown,
  version: number,
): WizardState<ParticleData> | undefined {
  if (version !== 1 && version !== 2) return undefined;
  const state = saved as WizardState<Partial<ParticleData>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  return {
    ...state,
    data: {
      ...initialParticleData,
      ...state.data,
      detect: version === 1 ? initialDetectState : (state.data.detect ?? initialDetectState),
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
