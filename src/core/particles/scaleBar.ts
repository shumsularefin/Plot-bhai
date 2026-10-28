import type { Point } from './geometry';

/** A scale bar found in the image: the ends of its middle row, in pixels of the searched image. */
export interface FoundBar {
  p1: Point;
  p2: Point;
  /** Rows the bar is thick. */
  thickness: number;
  /** 'bright' for a white bar, 'dark' for a black one. */
  tone: 'bright' | 'dark';
}

/** Grey levels at or above this count as white, at or below 255 minus it as black. */
const EXTREME = 200;

interface Run {
  y: number;
  x0: number;
  x1: number;
  tone: FoundBar['tone'];
}

/** Runs of white or black pixels in one row that are long enough to be a bar. */
function rowRuns(gray: Uint8Array, width: number, y: number, minLength: number, out: Run[]) {
  const classOf = (v: number) => (v >= EXTREME ? 1 : v <= 255 - EXTREME ? 2 : 0);
  let x = 0;
  while (x < width) {
    const c = classOf(gray[y * width + x] as number);
    const start = x;
    while (x < width && classOf(gray[y * width + x] as number) === c) x++;
    if (c && x - start >= minLength)
      out.push({ y, x0: start, x1: x, tone: c === 1 ? 'bright' : 'dark' });
  }
}

/** Share of the pixels of row y over [x0, x1) that are not of the bar's tone. */
function contrastRow(gray: Uint8Array, width: number, y: number, run: Run): number {
  let other = 0;
  for (let x = run.x0; x < run.x1; x++) {
    const v = gray[y * width + x] as number;
    if (run.tone === 'bright' ? v < EXTREME : v > 255 - EXTREME) other++;
  }
  return other / (run.x1 - run.x0);
}

/**
 * Centre of the first run of the bar's tone in row y within [from, to), or null. Used to find
 * the end ticks of a bar such as |———|.
 */
function tickCentre(
  gray: Uint8Array,
  width: number,
  y: number,
  tone: FoundBar['tone'],
  from: number,
  to: number,
  fromRight: boolean,
): number | null {
  const isTone = (x: number) => {
    const v = gray[y * width + x] as number;
    return tone === 'bright' ? v >= EXTREME : v <= 255 - EXTREME;
  };
  const step = fromRight ? -1 : 1;
  let x = fromRight ? to - 1 : from;
  while (x >= from && x < to && !isTone(x)) x += step;
  if (x < from || x >= to) return null;
  const first = x;
  while (x >= from && x < to && isTone(x)) x += step;
  return (first + x - step + 1) / 2;
}

/**
 * Looks for the scale bar of an electron micrograph: a thin, straight, uniformly white or black
 * rectangle in the bottom part of the image. Rows are scanned for long runs of white or black
 * pixels; runs that line up in neighbouring rows (within 2 px at each end) form a bar. A bar must
 * be 2 px or more thick, thinner than 6 % of the image height, between 3 % and 70 % of the width
 * long, and stand out from the rows just above and below it (at least 80 % of those pixels of the
 * other tone). The longest such bar wins. When the bar has end ticks (marks rising above it
 * within the outer tenth at each end), its ends are put at the tick centres, as the printed
 * length usually runs from tick to tick. This is a heuristic: the user checks the ends and types
 * the printed length. Returns null when nothing bar-like is found.
 *
 * gray: 8-bit grey levels, row by row. `fromRow` limits the search to rows at or below it
 * (default: the bottom 40 % of the image).
 */
export function findScaleBar(
  gray: Uint8Array,
  width: number,
  height: number,
  fromRow = Math.floor(height * 0.6),
): FoundBar | null {
  const minLength = Math.max(8, Math.ceil(width * 0.03));
  const maxLength = width * 0.7;
  const maxThickness = Math.max(2, Math.floor(height * 0.06));
  const start = Math.max(0, Math.min(height - 1, fromRow));
  const runs: Run[][] = [];
  for (let y = start; y < height; y++) {
    const row: Run[] = [];
    rowRuns(gray, width, y, minLength, row);
    runs.push(row.filter((r) => r.x1 - r.x0 <= maxLength));
  }
  const near = (a: Run, b: Run) =>
    a.tone === b.tone && Math.abs(a.x0 - b.x0) <= 2 && Math.abs(a.x1 - b.x1) <= 2;
  let best: FoundBar | null = null;
  let bestLength = 0;
  runs.forEach((row, r) => {
    for (const run of row) {
      // Start a bar only at its top row.
      if (r > 0 && (runs[r - 1] as Run[]).some((above) => near(above, run))) continue;
      let thickness = 1;
      while (
        r + thickness < runs.length &&
        (runs[r + thickness] as Run[]).some((b) => near(b, run))
      )
        thickness++;
      if (thickness < 2 || thickness > maxThickness) continue;
      const top = run.y - 1;
      const bottom = run.y + thickness;
      if (top < 0 || bottom >= height) continue;
      if (contrastRow(gray, width, top, run) < 0.8 || contrastRow(gray, width, bottom, run) < 0.8)
        continue;
      const length = run.x1 - run.x0;
      if (length <= bestLength) continue;
      bestLength = length;
      const y = run.y + (thickness - 1) / 2;
      const reach = Math.max(2, Math.round(length / 10));
      const left = tickCentre(gray, width, top, run.tone, run.x0, run.x0 + reach, false);
      const right = tickCentre(gray, width, top, run.tone, run.x1 - reach, run.x1, true);
      const ticks = left !== null && right !== null;
      best = {
        p1: { x: ticks ? left : run.x0, y },
        p2: { x: ticks ? right : run.x1, y },
        thickness,
        tone: run.tone,
      };
    }
  });
  return best;
}
