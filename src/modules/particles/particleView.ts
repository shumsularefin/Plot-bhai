import {
  outerLoop,
  outlineLoops,
  shapeOf,
  touchesEdge,
  type Runs,
  type Shape,
} from '../../core/particles/detect/regions';
import { NM_PER_UNIT, type Rect } from '../../core/particles/geometry';
import type { Particle, ParticleFilters } from './data';

/** A particle's measurements in pixels of the ORIGINAL image (lengths) and px² (area). */
export interface ParticleSizes {
  area: number;
  eqDiameter: number;
  feretMax: number;
  feretMin: number;
  aspect: number;
  circularity: number;
  cx: number;
  cy: number;
}

const shapes = new WeakMap<Runs, Shape>();

/** Shape of the particle on the working grid, remembered per particle. */
export function shapeFor(runs: Runs): Shape {
  let shape = shapes.get(runs);
  if (!shape) {
    shape = shapeOf(runs);
    shapes.set(runs, shape);
  }
  return shape;
}

/**
 * Sizes mapped back to the original image: lengths divided by the working scale, areas by its
 * square. `scale` is the working copy size divided by the original size (1 when they are equal).
 */
export function sizesOf(runs: Runs, scale: number): ParticleSizes {
  const s = shapeFor(runs);
  return {
    area: s.area / scale ** 2,
    eqDiameter: s.eqDiameter / scale,
    feretMax: s.feretMax / scale,
    feretMin: s.feretMin / scale,
    aspect: s.aspect,
    circularity: s.circularity,
    cx: s.cx / scale,
    cy: s.cy / scale,
  };
}

const paths = new WeakMap<Runs, string>();

/** SVG path of the particle's outer outline, in working grid pixels. */
export function outlinePath(runs: Runs): string {
  let d = paths.get(runs);
  if (d === undefined) {
    const loop = outerLoop(outlineLoops(runs)) ?? [];
    d = loop.length > 0 ? `M${loop.map((p) => `${p.x} ${p.y}`).join('L')}Z` : '';
    paths.set(runs, d);
  }
  return d;
}

export interface FilterContext {
  /** Working copy size divided by original size. */
  scale: number;
  /** Nanometres per original pixel, or null without a scale. */
  nmPerPixel: number | null;
  /** The area that counts as the image edge, on the working grid (the crop, or the whole copy). */
  edgeArea: Rect;
}

/** Why a particle is left out, or null when it is kept. */
export type FilterReason = 'small' | 'large' | 'shape' | 'edge';

export function filterReason(
  particle: Particle,
  filters: ParticleFilters,
  context: FilterContext,
): FilterReason | null {
  const sizes = sizesOf(particle.runs, context.scale);
  let diameter = sizes.eqDiameter;
  if (filters.unit !== 'px') {
    if (context.nmPerPixel === null) diameter = Number.NaN;
    else diameter = (diameter * context.nmPerPixel) / NM_PER_UNIT[filters.unit];
  }
  if (Number.isFinite(diameter)) {
    if (filters.minDiameter !== null && diameter < filters.minDiameter) return 'small';
    if (filters.maxDiameter !== null && diameter > filters.maxDiameter) return 'large';
  }
  if (filters.minCircularity !== null && sizes.circularity < filters.minCircularity) return 'shape';
  if (filters.excludeEdge && touchesEdge(particle.runs, context.edgeArea)) return 'edge';
  return null;
}

export interface Filtered {
  kept: Particle[];
  counts: Record<FilterReason, number>;
}

/** Splits the particles into those kept and counts of those left out, by reason. */
export function applyFilters(
  particles: readonly Particle[],
  filters: ParticleFilters,
  context: FilterContext,
): Filtered {
  const kept: Particle[] = [];
  const counts: Record<FilterReason, number> = { small: 0, large: 0, shape: 0, edge: 0 };
  for (const particle of particles) {
    const reason = filterReason(particle, filters, context);
    if (reason) counts[reason]++;
    else kept.push(particle);
  }
  return { kept, counts };
}
