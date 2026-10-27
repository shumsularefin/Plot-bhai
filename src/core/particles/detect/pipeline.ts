import type { Rect } from '../geometry';
import { gaussianBlur, invertGray, medianFilter } from './image';
import { connectedComponents } from './label';
import { close, fillHoles, open } from './morphology';
import { labelsToRuns, type Runs } from './regions';
import { adaptiveThreshold, applyThreshold, histogram, otsuThreshold } from './threshold';
import { estimateDiameter, splitClusters } from './clusters';
import { splitTouching } from './watershed';

export type DenoiseMethod = 'none' | 'gaussian' | 'median';
export type ThresholdMethod = 'otsu' | 'adaptive' | 'manual';
/** How touching particles are separated: by narrow necks only, or as clumps of a typical size. */
export type SplitMethod = 'necks' | 'clumps';

/** Everything the detection pipeline can be told. All lengths are pixels of the image given to it. */
export interface DetectSettings {
  /** True when particles are darker than the background. */
  invert: boolean;
  denoise: { method: DenoiseMethod; /** Gaussian σ, or median radius, in pixels. */ size: number };
  threshold: {
    method: ThresholdMethod;
    /** Manual threshold, grey level 0 to 255: brighter pixels are particles. */
    manual: number;
    /** Adaptive: radius of the neighbourhood and the offset above its mean, in grey levels. */
    adaptiveRadius: number;
    adaptiveOffset: number;
  };
  /** Morphological opening and closing radii in pixels (0 switches the step off). */
  open: number;
  close: number;
  fillHoles: boolean;
  split: {
    enabled: boolean;
    method: SplitMethod;
    /** Necks: merge blobs whose neck is at least this percent of the smaller radius. */
    neckPercent: number;
    /** Clumps: typical particle diameter in pixels; null estimates it from the mask. */
    diameter: number | null;
    /** Clumps: least share of a whole, clear outline a particle centre needs, percent. */
    outlinePercent: number;
  };
}

/** Starting values of my own choosing: gentle denoising, Otsu, light clean-up, splitting on. */
export const DEFAULT_DETECT_SETTINGS: DetectSettings = {
  invert: false,
  denoise: { method: 'gaussian', size: 1 },
  threshold: { method: 'otsu', manual: 128, adaptiveRadius: 40, adaptiveOffset: 0 },
  open: 1,
  close: 1,
  fillHoles: true,
  split: {
    enabled: true,
    method: 'necks',
    neckPercent: 70,
    diameter: null,
    outlinePercent: 5,
  },
};

export interface Segmentation {
  /** 1 for particle pixels. */
  mask: Uint8Array;
  /** The grey level used (for Otsu the computed one, for adaptive the offset is not a level: NaN). */
  threshold: number;
  /** The image after inverting and denoising, the one the threshold was applied to. */
  image: Uint8Array;
}

/**
 * Steps up to the binary mask, in order: invert (if particles are dark), denoise, threshold,
 * keep only the analysis area, opening, closing, fill holes. For Otsu the histogram is taken
 * from the analysis area only, so a black data bar does not pull the threshold down.
 */
export function segment(
  gray: Uint8Array,
  width: number,
  height: number,
  settings: DetectSettings,
  area?: Rect | null,
): Segmentation {
  let image = settings.invert ? invertGray(gray) : gray;
  const { denoise, threshold } = settings;
  if (denoise.method === 'gaussian') image = gaussianBlur(image, width, height, denoise.size);
  else if (denoise.method === 'median')
    image = medianFilter(image, width, height, Math.round(denoise.size));

  let mask: Uint8Array;
  let used = Number.NaN;
  if (threshold.method === 'adaptive') {
    mask = adaptiveThreshold(
      image,
      width,
      height,
      Math.round(threshold.adaptiveRadius),
      threshold.adaptiveOffset,
    );
  } else {
    used =
      threshold.method === 'otsu' ? otsuThreshold(histogram(image, width, area)) : threshold.manual;
    mask = applyThreshold(image, used);
  }
  if (area) {
    const x0 = Math.round(area.x);
    const y0 = Math.round(area.y);
    const x1 = Math.round(area.x + area.width);
    const y1 = Math.round(area.y + area.height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < x0 || x >= x1 || y < y0 || y >= y1) mask[y * width + x] = 0;
      }
    }
  }
  mask = open(mask, width, height, settings.open);
  mask = close(mask, width, height, settings.close);
  if (settings.fillHoles) mask = fillHoles(mask, width, height);
  return { mask, threshold: used, image };
}

/**
 * Finds the particles of a grayscale image: segmentation, then labelling. With splitting on,
 * touching particles are separated either at narrow necks, by a watershed on the distance
 * transform (see splitTouching), or as clumps of particles of a typical diameter, from the
 * visible arcs of their outlines (see splitClusters); otherwise every connected blob is one particle.
 * Returns each particle as pixel runs on the image grid, and the diameter used for clumps (null
 * otherwise). Filtering by size, shape or edge contact is done afterwards, from the measurements.
 */
export function detectParticles(
  gray: Uint8Array,
  width: number,
  height: number,
  settings: DetectSettings,
  area?: Rect | null,
): { particles: Runs[]; threshold: number; diameter: number | null } {
  const { mask, threshold, image } = segment(gray, width, height, settings, area);
  const { split } = settings;
  let diameter: number | null = null;
  let result;
  if (!split.enabled) result = connectedComponents(mask, width, height);
  else if (split.method === 'necks')
    result = splitTouching(mask, width, height, split.neckPercent / 100);
  else {
    diameter = split.diameter ?? estimateDiameter(mask, width, height);
    result =
      diameter === null
        ? connectedComponents(mask, width, height)
        : splitClusters(mask, image, width, height, diameter, split.outlinePercent / 100);
  }
  return {
    particles: labelsToRuns(result.labels, width, height, result.count),
    threshold,
    diameter,
  };
}
