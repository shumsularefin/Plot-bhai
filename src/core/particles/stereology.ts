import type { Rect } from './geometry';
import type { Runs } from './detect/regions';

/**
 * Stereology of a segmented micrograph: area fraction and mean lineal intercept length.
 *
 * Every length here is in pixels of the grid the regions are on; the caller converts to nm.
 * Sources (checked against the text): ASTM E112-13, "Standard Test Methods for Determining
 * Average Grain Size", §3.2.5 and §13.3 (intercept counting, half intercepts at line ends),
 * §13.1 (at least 50 intercepts), eq. 25 (two-phase structures) and Table 6 (grain size number).
 */

/** The analysed area as whole pixels: x0, y0 inclusive, x1, y1 one past the last. */
function pixelBox(area: Rect) {
  const x0 = Math.max(0, Math.round(area.x));
  const y0 = Math.max(0, Math.round(area.y));
  return {
    x0,
    y0,
    x1: Math.max(x0, Math.round(area.x + area.width)),
    y1: Math.max(y0, Math.round(area.y + area.height)),
  };
}

/**
 * Area fraction A_A = (area of the regions inside the analysed area) / (analysed area), 0 to 1.
 * By the Delesse principle A_A is an unbiased estimate of the volume fraction V_V of the phase
 * in a random section. When the regions are pores this is the areal porosity. Regions must not
 * overlap (detected particles never do).
 */
export function areaFraction(regions: readonly Runs[], area: Rect): number {
  const { x0, y0, x1, y1 } = pixelBox(area);
  const total = (x1 - x0) * (y1 - y0);
  if (total === 0) return 0;
  let inside = 0;
  for (const runs of regions) {
    for (let i = 0; i < runs.length; i += 3) {
      const y = runs[i] as number;
      if (y < y0 || y >= y1) continue;
      inside += Math.max(
        0,
        Math.min(x1, runs[i + 2] as number) - Math.max(x0, runs[i + 1] as number),
      );
    }
  }
  return inside / total;
}

export type LineDirection = 'horizontal' | 'vertical';

/** Counts along the test lines of one direction. */
export interface InterceptCounts {
  direction: LineDirection;
  lines: number;
  /** Total test line length L_T (pixels). */
  lineLength: number;
  /** Length of test line lying inside the regions (pixels). */
  insideLength: number;
  /**
   * Number of intercepts N: one for every segment of line over one region, one half for a segment
   * at an end of a test line (ASTM E112 §13.3).
   */
  intercepts: number;
}

/**
 * Places `lines` evenly spaced test lines across the analysed area (at the centres of equal
 * strips) and counts the intercepts. A segment is a run of pixels of one region; neighbouring
 * regions that touch give separate segments, as grains separated by a boundary do. Only the pixels
 * on the test lines are looked at, so the cost does not grow with the image area.
 */
export function countIntercepts(
  regions: readonly Runs[],
  area: Rect,
  direction: LineDirection,
  lines: number,
): InterceptCounts {
  const { x0, y0, x1, y1 } = pixelBox(area);
  const horizontal = direction === 'horizontal';
  const across = horizontal ? y1 - y0 : x1 - x0;
  const along = horizontal ? x1 - x0 : y1 - y0;
  const out: InterceptCounts = {
    direction,
    lines: 0,
    lineLength: 0,
    insideLength: 0,
    intercepts: 0,
  };
  if (across <= 0 || along <= 0 || lines < 1) return out;
  const count = Math.min(lines, across);
  // Line j sits at offset positions[j] across the area; slot[offset] gives j or -1.
  const slot = new Int32Array(across).fill(-1);
  for (let j = 0; j < count; j++)
    slot[Math.min(across - 1, Math.floor(((j + 0.5) * across) / count))] = j;
  const labels = Array.from({ length: count }, () => new Int32Array(along));
  regions.forEach((runs, k) => {
    for (let i = 0; i < runs.length; i += 3) {
      const y = (runs[i] as number) - y0;
      if (y < 0 || y >= y1 - y0) continue;
      const from = Math.max(0, (runs[i + 1] as number) - x0);
      const to = Math.min(x1 - x0, (runs[i + 2] as number) - x0);
      if (to <= from) continue;
      if (horizontal) {
        const j = slot[y] as number;
        if (j >= 0) (labels[j] as Int32Array).fill(k + 1, from, to);
      } else {
        for (let x = from; x < to; x++) {
          const j = slot[x] as number;
          if (j >= 0) (labels[j] as Int32Array)[y] = k + 1;
        }
      }
    }
  });
  for (const line of labels) {
    out.lines++;
    out.lineLength += along;
    let i = 0;
    while (i < along) {
      const label = line[i] as number;
      if (!label) {
        i++;
        continue;
      }
      const start = i;
      while (i < along && line[i] === label) i++;
      out.insideLength += i - start;
      out.intercepts += start === 0 || i === along ? 0.5 : 1;
    }
  }
  return out;
}

/** How the regions relate to the structure, which decides the intercept formula. */
export type InterceptStructure = 'grains' | 'phase';

/**
 * Mean lineal intercept length ℓ̄ (pixels), or null without intercepts.
 *  - 'grains' (single phase, the regions fill the image): ℓ̄ = L_T / N (ASTM E112 Table 6, A1.1.1.3).
 *  - 'phase' (the regions are one phase among others, for example particles on a background):
 *    ℓ̄_α = V_V·L_T / N_α (E112 eq. 25), with V_V taken as the line fraction L_L = L_α / L_T
 *    measured on the same lines, so ℓ̄_α = L_α / N_α, the mean chord length of the phase.
 */
export function meanIntercept(
  counts: Pick<InterceptCounts, 'lineLength' | 'insideLength' | 'intercepts'>,
  structure: InterceptStructure,
): number | null {
  if (!(counts.intercepts > 0)) return null;
  return (structure === 'grains' ? counts.lineLength : counts.insideLength) / counts.intercepts;
}

/** Adds the counts of several directions or images. */
export function sumCounts(
  parts: readonly Pick<InterceptCounts, 'lineLength' | 'insideLength' | 'intercepts'>[],
) {
  return parts.reduce(
    (sum, p) => ({
      lineLength: sum.lineLength + p.lineLength,
      insideLength: sum.insideLength + p.insideLength,
      intercepts: sum.intercepts + p.intercepts,
    }),
    { lineLength: 0, insideLength: 0, intercepts: 0 },
  );
}

/**
 * ASTM micro-grain size number from the mean lineal intercept length, ASTM E112-13 Table 6:
 *   G = −6.643856 · log10(ℓ̄) − 3.288, with ℓ̄ in millimetres at 1×.
 * (Base: ℓ̄ = 32.00 mm at 100× for G = 0; G rises by 2 when ℓ̄ halves.)
 */
export function astmGrainSize(meanInterceptMm: number): number | null {
  if (!(meanInterceptMm > 0)) return null;
  return -6.643856 * Math.log10(meanInterceptMm) - 3.288;
}

/** ASTM E112 §13.1 asks for at least this many intercepts for a grain size estimate. */
export const MIN_INTERCEPTS = 50;
