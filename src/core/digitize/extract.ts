/*
 * Reading a curve off a plot image.
 *
 * 1. Mask: pixels whose colour is within a tolerance of the curve's colour (Euclidean distance
 *    in RGB, 0–255 per channel).
 * 2. Straight lines: a row (or column) whose longest run of masked pixels (bridging breaks of a
 *    few pixels, where another curve crosses it) spans most of the area is an axis line or a
 *    gridline, not the curve, and is removed. A real pattern's baseline leaves the row at every
 *    peak, so it is kept.
 * 3. Tracing: the mask is split into vertical runs per column (runs 1–2 px apart are joined). From a seed point the trace walks
 *    left and right, taking in each column the run that touches the previous one (a drawn line is
 *    connected), or, across a gap of a few columns, the nearest run within a jump limit.
 * 4. Values: where the curve is flat, the middle of each column's run. Where it is steep (a run
 *    over twice the line width), the stroke is read across rows instead, at the middle of its
 *    horizontal extent in each row; this follows the centre of a thick line on a flank and finds
 *    the apex of a sharp peak, where the middle of a column would cut the peak short. Where the
 *    two flanks of a narrow peak run together into one wide segment, each edge gives a point.
 * Positions are image pixels with pixel i covering [i, i + 1), so a pixel's centre is i + 0.5.
 */

import type { Point, Rect } from '../particles/geometry';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row by row, as in ImageData. */
  data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

export interface ExtractOptions {
  /** Colour of the curve. */
  color: Rgb;
  /** Largest colour distance (0–442) still counted as the curve. */
  tolerance: number;
  /** Remove rows and columns that are one straight unbroken line (axes, gridlines). */
  removeStraightLines: boolean;
  /** Where to read, in image pixels; the whole image when missing. */
  region?: Rect;
  /** Points on the curve to start tracing from (image pixels). Later seeds fill what earlier ones missed. */
  seeds: readonly Point[];
}

export interface ExtractResult {
  /** Points on the curve, left to right (image pixels): one per flat column, one per row on steep parts. */
  points: Point[];
  /** Typical thickness of the drawn line, pixels. */
  lineWidth: number;
  /** Columns of the region that the trace did not reach. */
  missingColumns: number;
  /** Rows and columns removed as straight lines. */
  removedLines: number;
}

/** A straight line covers at least this fraction of the region's width (or height) without a break. */
const STRAIGHT_FRACTION = 0.85;
/** A straight line stays one line across breaks this short (pixels), where another curve crosses it. */
const LINE_BREAK_PX = 3;
/** Runs of one column at most this many pixels apart are one stroke. */
const SPLIT_PX = 2;
/** Columns without a curve pixel the trace jumps across. */
const MAX_GAP = 12;

export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pixel(img: RgbaImage, x: number, y: number): Rgb {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  // Transparent pixels count as white, the usual page colour.
  const alpha = (d[i + 3] as number) / 255;
  const mix = (c: number) => Math.round(c * alpha + 255 * (1 - alpha));
  return [mix(d[i] as number), mix(d[i + 1] as number), mix(d[i + 2] as number)];
}

const clampRegion = (img: RgbaImage, r?: Rect): Rect => {
  const x0 = Math.max(0, Math.floor(r?.x ?? 0));
  const y0 = Math.max(0, Math.floor(r?.y ?? 0));
  const x1 = Math.min(img.width, Math.ceil((r?.x ?? 0) + (r?.width ?? img.width)));
  const y1 = Math.min(img.height, Math.ceil((r?.y ?? 0) + (r?.height ?? img.height)));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
};

/**
 * The most common colour of the region (in steps of 16 per channel, then averaged), taken as
 * the background.
 */
export function backgroundColor(img: RgbaImage, region?: Rect): Rgb {
  const r = clampRegion(img, region);
  const bins = new Map<number, { n: number; sum: [number, number, number] }>();
  const stride = Math.max(1, Math.floor(Math.sqrt((r.width * r.height) / 200_000)));
  for (let y = r.y; y < r.y + r.height; y += stride)
    for (let x = r.x; x < r.x + r.width; x += stride) {
      const c = pixel(img, x, y);
      const key = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const bin = bins.get(key) ?? { n: 0, sum: [0, 0, 0] };
      bin.n++;
      bin.sum[0] += c[0];
      bin.sum[1] += c[1];
      bin.sum[2] += c[2];
      bins.set(key, bin);
    }
  let best = { n: 0, sum: [255, 255, 255] as [number, number, number] };
  for (const bin of bins.values()) if (bin.n > best.n) best = bin;
  const n = Math.max(best.n, 1);
  return [best.sum[0] / n, best.sum[1] / n, best.sum[2] / n].map(Math.round) as unknown as Rgb;
}

/**
 * The curve pixel the user meant when clicking near it: within `radius` pixels, the one whose
 * colour differs most from the background. Returns its position (pixel centre) and colour.
 */
export function pickCurve(
  img: RgbaImage,
  at: Point,
  background: Rgb,
  radius = 6,
): { at: Point; color: Rgb } | null {
  let best: { at: Point; color: Rgb; score: number } | null = null;
  const cx = Math.floor(at.x);
  const cy = Math.floor(at.y);
  for (let y = cy - radius; y <= cy + radius; y++)
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const color = pixel(img, x, y);
      // Prefer strong contrast, then nearness to the click.
      const score = colorDistance(color, background) - 2 * Math.hypot(x - cx, y - cy);
      if (!best || score > best.score) best = { at: { x: x + 0.5, y: y + 0.5 }, color, score };
    }
  if (!best || colorDistance(best.color, background) < 40) return null;
  return { at: best.at, color: best.color };
}

/** Masked pixels of the region, row by row (1 = curve colour). */
export function curveMask(img: RgbaImage, region: Rect, color: Rgb, tolerance: number): Uint8Array {
  const mask = new Uint8Array(region.width * region.height);
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++)
      if (colorDistance(pixel(img, region.x + x, region.y + y), color) <= tolerance)
        mask[y * region.width + x] = 1;
  return mask;
}

/** Clears rows and columns whose longest unbroken run spans most of the region. Returns how many. */
export function removeStraightLines(mask: Uint8Array, width: number, height: number): number {
  let removed = 0;
  const clearRun = (start: number, count: number, step: number) => {
    for (let k = 0; k < count; k++) mask[start + k * step] = 0;
  };
  const scan = (lines: number, along: number, index: (line: number, k: number) => number) => {
    const runs: [number, number, number][] = [];
    for (let line = 0; line < lines; line++) {
      // A run may bridge breaks of up to LINE_BREAK_PX, where another curve crosses the line.
      let best = 0;
      let bestStart = 0;
      let start = -1;
      let lastOn = -Infinity;
      for (let k = 0; k < along; k++) {
        if (!mask[index(line, k)]) continue;
        if (k - lastOn > LINE_BREAK_PX + 1) start = k;
        lastOn = k;
        if (k - start + 1 > best) {
          best = k - start + 1;
          bestStart = start;
        }
      }
      if (best >= STRAIGHT_FRACTION * along) runs.push([line, bestStart, best]);
    }
    return runs;
  };
  // Find both directions first, so a horizontal axis does not cut the vertical one before it is seen.
  const rows = scan(height, width, (y, x) => y * width + x);
  const columns = scan(width, height, (x, y) => y * width + x);
  for (const [y, start, count] of rows) clearRun(y * width + start, count, 1);
  for (const [x, start, count] of columns) clearRun(start * width + x, count, width);
  removed += rows.length + columns.length;
  return removed;
}

interface Run {
  top: number;
  bottom: number;
}

function columnRuns(mask: Uint8Array, width: number, height: number): Run[][] {
  const columns: Run[][] = [];
  for (let x = 0; x < width; x++) {
    const runs: Run[] = [];
    let top = -1;
    for (let y = 0; y <= height; y++) {
      const on = y < height && mask[y * width + x] === 1;
      if (on && top < 0) top = y;
      if (!on && top >= 0) {
        runs.push({ top, bottom: y - 1 });
        top = -1;
      }
    }
    // Faint anti-aliased pixels on a steep flank can split one stroke; join runs a pixel or two apart.
    const joined: Run[] = [];
    for (const run of runs) {
      const last = joined[joined.length - 1];
      if (last && run.top - last.bottom <= SPLIT_PX + 1) last.bottom = run.bottom;
      else joined.push(run);
    }
    columns.push(joined);
  }
  return columns;
}

const gapTo = (run: Run, y: number) =>
  y < run.top ? run.top - y : y > run.bottom ? y - run.bottom : 0;

/** The run of a column that continues the trace, or null. */
function nextRun(
  runs: readonly Run[],
  previous: Run | null,
  lastY: number,
  jump: number,
): Run | null {
  if (previous) {
    const touching = runs.filter(
      (r) => r.top <= previous.bottom + 1 && r.bottom >= previous.top - 1,
    );
    if (touching.length > 0)
      return touching.reduce((a, b) => (gapTo(a, lastY) <= gapTo(b, lastY) ? a : b));
  }
  const near = runs.filter((r) => gapTo(r, lastY) <= jump);
  return near.length > 0
    ? near.reduce((a, b) => (gapTo(a, lastY) <= gapTo(b, lastY) ? a : b))
    : null;
}

/** Follows the curve from a seed in one direction, filling `chosen` where it is still empty. */
function walk(
  columns: readonly Run[][],
  chosen: (Run | null)[],
  start: number,
  seed: Run,
  direction: 1 | -1,
  jump: number,
) {
  let previous: Run | null = seed;
  let lastY = (seed.top + seed.bottom) / 2;
  let gap = 0;
  for (let x = start + direction; x >= 0 && x < columns.length; x += direction) {
    if (chosen[x]) break;
    const run = nextRun(
      columns[x] as Run[],
      gap === 0 ? previous : null,
      lastY,
      jump * (1 + gap / 4),
    );
    if (run) {
      chosen[x] = run;
      previous = run;
      lastY = (run.top + run.bottom) / 2;
      gap = 0;
    } else if (++gap > MAX_GAP) break;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/**
 * Tick marks pointing into the plot, or the edge of a label, can touch a flat stretch of the curve
 * and stretch its runs downwards for a column or two. Such a stretch, no wider than `maxWidth`, with
 * the curve at the same height on both sides, is cut back to that height. Narrow upward spikes are
 * left alone: they may be real (if unresolved) peaks.
 */
function trimSpurs(chosen: (Run | null)[], steep: number, maxWidth: number) {
  const long = (r: Run | null | undefined) => !!r && r.bottom - r.top + 1 > steep;
  for (let x = 1; x < chosen.length; x++) {
    if (!long(chosen[x])) continue;
    let end = x;
    while (end + 1 < chosen.length && long(chosen[end + 1])) end++;
    const left = chosen[x - 1];
    const right = chosen[end + 1];
    if (end - x + 1 <= maxWidth && left && right && !long(left) && !long(right)) {
      const top = Math.min(left.top, right.top);
      const bottom = Math.max(left.bottom, right.bottom);
      const level = left.top <= right.bottom + 1 && right.top <= left.bottom + 1;
      if (level)
        for (let i = x; i <= end; i++) {
          const run = chosen[i] as Run;
          if (run.top >= top - 1 && run.bottom > bottom)
            chosen[i] = { top: run.top, bottom: Math.max(run.top, bottom) };
        }
    }
    x = end;
  }
}

/** Reads the curve through the seeds. See the notes at the top of this file. */
export function extractCurve(img: RgbaImage, options: ExtractOptions): ExtractResult {
  const region = clampRegion(img, options.region);
  const { width, height } = region;
  const mask = curveMask(img, region, options.color, options.tolerance);
  const removedLines = options.removeStraightLines ? removeStraightLines(mask, width, height) : 0;
  const columns = columnRuns(mask, width, height);
  const chosen: (Run | null)[] = new Array<Run | null>(width).fill(null);
  const jump = Math.max(6, 0.04 * height);
  for (const s of options.seeds) {
    const x = Math.floor(s.x - region.x);
    const y = s.y - region.y;
    if (x < 0 || x >= width || chosen[x]) continue;
    const runs = columns[x] as Run[];
    const seed =
      runs.length > 0 ? runs.reduce((a, b) => (gapTo(a, y) <= gapTo(b, y) ? a : b)) : null;
    if (!seed || gapTo(seed, y) > jump) continue;
    chosen[x] = seed;
    walk(columns, chosen, x, seed, 1, jump);
    walk(columns, chosen, x, seed, -1, jump);
  }

  // Line width: the typical run length where the curve is flat (shorter half of all runs).
  const lengths = chosen.filter((r): r is Run => r !== null).map((r) => r.bottom - r.top + 1);
  const sorted = [...lengths].sort((a, b) => a - b);
  const lineWidth = median(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))));
  const steep = Number.isFinite(lineWidth) ? 2 * lineWidth : Infinity;
  trimSpurs(chosen, steep, Math.max(3, lineWidth + 2));

  // Where the curve is flat the middle of a column's run is on the curve. Where it is steep the
  // stroke's thickness stretches the run, so the curve is read across rows instead: the middle of
  // the stroke's horizontal extent in each row, which also finds the apex of a sharp peak.
  const covers = (x: number, y: number) => {
    const run = chosen[x];
    return !!run && run.top <= y && y <= run.bottom;
  };
  const points: Point[] = [];
  chosen.forEach((run, x) => {
    if (!run) return;
    if (run.bottom - run.top + 1 <= steep) {
      points.push({ x: region.x + x + 0.5, y: region.y + (run.top + run.bottom) / 2 + 0.5 });
      return;
    }
    for (let y = run.top; y <= run.bottom; y++) {
      if (covers(x - 1, y)) continue; // the row's segment starts further left
      let end = x;
      while (covers(end + 1, y)) end++;
      const span = end - x + 1;
      if (span > 3 * steep) continue; // a flat stretch: its columns give the curve
      if (span <= lineWidth + 1) {
        points.push({ x: region.x + (x + end + 1) / 2, y: region.y + y + 0.5 });
      } else {
        // Both flanks of a narrow peak (or valley) run together in this row: one point on each,
        // half a line width in from the stroke's edges.
        points.push({ x: region.x + x + lineWidth / 2, y: region.y + y + 0.5 });
        points.push({ x: region.x + end + 1 - lineWidth / 2, y: region.y + y + 0.5 });
      }
    }
  });
  points.sort((a, b) => a.x - b.x);
  return {
    points,
    lineWidth: Number.isFinite(lineWidth) ? lineWidth : 0,
    missingColumns: chosen.filter((r) => r === null).length,
    removedLines,
  };
}
