import type { AxisScale } from '../../core/digitize/calibration';
import type { Rgb } from '../../core/digitize/extract';
import type { Point, Rect } from '../../core/particles/geometry';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import type { PlotSettings } from '../../ui/plot/PlotPanel';

/** The loaded screenshot. The file itself is kept in IndexedDB (imageStore). */
export interface ShotImageInfo {
  /** Changes with every new image; keys the stored file and the decoded copy. */
  id: string;
  name: string;
  width: number;
  height: number;
  /** True for the generated example figure. */
  synthetic: boolean;
  /** What the example figure shows. */
  description?: string;
  notes: string[];
}

/** One calibration mark: where it is on the (rotated) image and the value typed for it. */
export interface AxisMark {
  at: Point | null;
  value: number | null;
}

export type MarkId = 'x1' | 'x2' | 'y1' | 'y2';

export interface CurveSettings {
  /** Colour of the curve, picked by clicking it. */
  color: Rgb | null;
  /** Largest colour difference still read as the curve (0–442). */
  tolerance: number;
  /** Ignore straight lines spanning the area (axes, gridlines). */
  removeLines: boolean;
  /** Points on the curve the trace starts from (image pixels after rotation). */
  seeds: Point[];
  /** Areas whose traced points are removed. */
  erased: Rect[];
  /** Points placed by hand. */
  added: Point[];
}

export interface ShotData {
  image: ShotImageInfo | null;
  /** Rotation applied to the image before everything else, degrees clockwise. */
  rotation: number;
  /** Area of the rotated image that holds the plot; null means the whole image. */
  crop: Rect | null;
  marks: Record<MarkId, AxisMark>;
  yScale: AxisScale;
  curve: CurveSettings;
  /** Name the curve gets in the analysis tool. */
  name: string;
  plot: PlotSettings;
}

export const EMPTY_MARKS: Record<MarkId, AxisMark> = {
  x1: { at: null, value: null },
  x2: { at: null, value: null },
  y1: { at: null, value: null },
  y2: { at: null, value: null },
};

export const DEFAULT_CURVE: CurveSettings = {
  color: null,
  tolerance: 110,
  removeLines: true,
  seeds: [],
  erased: [],
  added: [],
};

export const initialShotData: ShotData = {
  image: null,
  rotation: 0,
  crop: null,
  marks: EMPTY_MARKS,
  yScale: 'linear',
  curve: DEFAULT_CURVE,
  name: '',
  plot: { normalise: false, offsetPercent: 20, export: DEFAULT_EXPORT_SETTINGS },
};

export const SHOT_STATE_VERSION = 1;
