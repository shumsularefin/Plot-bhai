import {
  type Calibration,
  type LengthUnit,
  type Measurement,
  type Point,
  type Rect,
} from '../../core/particles/geometry';
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

/** Everything saved for a particle size analysis. */
export interface ParticleData {
  image: ImageInfo | null;
  /** Region to analyse (original pixels); null means the whole image. */
  crop: Rect | null;
  scale: ScaleBar | null;
  measurements: Measurement[];
  /** The number the next measurement gets; ids are never reused. */
  nextId: number;
}

export const initialParticleData: ParticleData = {
  image: null,
  crop: null,
  scale: null,
  measurements: [],
  nextId: 1,
};

/** Version of the saved shape. Bump it, and add a migration, when the shape changes. */
export const PARTICLE_STATE_VERSION = 1;

/** No older versions exist yet, so older or newer saved data are discarded. */
export function migrateParticleData(): WizardState<ParticleData> | undefined {
  return undefined;
}

/** The usable calibration: a drawn bar with a positive length, otherwise null. */
export function calibrationOf(scale: ScaleBar | null): Calibration | null {
  if (!scale || scale.length === null || !(scale.length > 0)) return null;
  return { p1: scale.p1, p2: scale.p2, length: scale.length, unit: scale.unit };
}

export function newId(): string {
  return crypto.randomUUID();
}
