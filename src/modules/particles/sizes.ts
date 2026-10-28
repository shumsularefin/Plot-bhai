import { calibrationOf, type ParticleData, type PoolEntry, type SizeMeasure } from './data';
import { measure, nmPerPixel, workingScale } from '../../core/particles/geometry';
import { applyFilters, sizesOf } from './particleView';

/** The three diameters of every particle of the image on screen, in nm (with a scale) or px. */
export interface ImageSizes {
  unit: 'nm' | 'px';
  equalArea: number[];
  longest: number[];
  shortest: number[];
  /** How many of them are hand measurements (the rest are detected particles). */
  hand: number;
}

/**
 * The detected particles that pass the filters of the detection step, with what is needed to
 * measure them. `keepEdge` keeps the particles cut by the edge of the analysis area even when the
 * filters leave them out; area fractions and line intercepts must count them.
 */
export function keptParticles(data: ParticleData, keepEdge = false) {
  const info = data.image;
  const calibration = calibrationOf(data.scale);
  const perPixelNm = calibration ? nmPerPixel(calibration) : null;
  const scale = info ? workingScale(info.width, info.height) : 1;
  const crop = data.crop;
  const edgeArea = crop
    ? {
        x: crop.x * scale,
        y: crop.y * scale,
        width: crop.width * scale,
        height: crop.height * scale,
      }
    : { x: 0, y: 0, width: (info?.width ?? 0) * scale, height: (info?.height ?? 0) * scale };
  const filters = keepEdge ? { ...data.detect.filters, excludeEdge: false } : data.detect.filters;
  const { kept } = applyFilters(data.detect.particles, filters, {
    scale,
    nmPerPixel: perPixelNm,
    edgeArea,
  });
  return { kept, scale, perPixelNm, edgeArea };
}

/**
 * Diameters of the particles of the image on screen: the detected particles that pass the
 * filters of step 3 and, when asked, the hand measurements made in the same step. A line gives the same
 * value for all three diameters. Lengths are mapped from the working copy back to original pixels
 * and then to nm when the image has a scale.
 */
export function imageSizes(data: ParticleData, includeHand: boolean): ImageSizes {
  const { kept, scale, perPixelNm } = keptParticles(data);
  const factor = perPixelNm ?? 1;
  const out: ImageSizes = {
    unit: perPixelNm === null ? 'px' : 'nm',
    equalArea: [],
    longest: [],
    shortest: [],
    hand: 0,
  };
  if (!data.image) return out;
  for (const particle of kept) {
    const s = sizesOf(particle.runs, scale);
    out.equalArea.push(s.eqDiameter * factor);
    out.longest.push(s.feretMax * factor);
    out.shortest.push(s.feretMin * factor);
  }
  if (includeHand) {
    for (const m of data.measurements) {
      const s = measure(m);
      out.equalArea.push(s.equivalentDiameter * factor);
      out.longest.push(s.major * factor);
      out.shortest.push(s.minor * factor);
      out.hand++;
    }
  }
  return out;
}

const pick = (
  sizes: Pick<PoolEntry, 'equalArea' | 'longest' | 'shortest'>,
  measure: SizeMeasure,
) =>
  measure === 'longest' ? sizes.longest : measure === 'shortest' ? sizes.shortest : sizes.equalArea;

/** An entry to add to the pool from the image on screen. */
export function poolEntryOf(id: string, name: string, sizes: ImageSizes): PoolEntry {
  return {
    id,
    name,
    unit: sizes.unit,
    equalArea: sizes.equalArea,
    longest: sizes.longest,
    shortest: sizes.shortest,
  };
}

export interface Collected {
  unit: 'nm' | 'px';
  /** All diameters in `unit`. */
  values: number[];
  /** Where they came from, in order. */
  sources: { name: string; count: number }[];
  /** Pool entries left out because their unit differs from the others. */
  skipped: PoolEntry[];
}

/**
 * All diameters of the distribution: the image on screen (if chosen) and the pooled images.
 * Images with a scale (nm) and without (px) cannot be combined, so the kind of the first source
 * decides and the others are listed as skipped. A saved image with the name of the image on
 * screen is not counted again while the image on screen is used.
 */
export function collectSizes(data: ParticleData): Collected {
  const { distribution: settings, pool } = data;
  const current = settings.useCurrent ? imageSizes(data, settings.includeHand) : null;
  const first = current && pick(current, settings.measure).length > 0 ? current : null;
  const unit = first?.unit ?? pool[0]?.unit ?? current?.unit ?? 'px';
  const values: number[] = [];
  const sources: Collected['sources'] = [];
  const skipped: PoolEntry[] = [];
  if (current && current.unit === unit) {
    const own = pick(current, settings.measure);
    if (own.length > 0) {
      values.push(...own);
      sources.push({ name: data.image?.name ?? 'Image on screen', count: own.length });
    }
  }
  for (const entry of pool) {
    // The image on screen is the live version of its own saved copy: count it once.
    if (current && entry.name === data.image?.name) continue;
    if (entry.unit !== unit) {
      skipped.push(entry);
      continue;
    }
    const own = pick(entry, settings.measure);
    values.push(...own);
    sources.push({ name: entry.name, count: own.length });
  }
  return { unit, values, sources, skipped };
}
