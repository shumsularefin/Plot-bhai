import type { Point } from '../geometry';
import { normaliseRuns, type Runs } from './regions';

/**
 * Runs of the pixels whose centres lie inside an ellipse with centre (cx, cy), semi-axes rx and
 * ry (axes parallel to the pixel grid), limited to a width × height image. Used to add particles
 * the automatic detection missed: a circle is the case rx = ry.
 */
export function ellipseRuns(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  width: number,
  height: number,
): Runs {
  const out: number[] = [];
  const yStart = Math.max(0, Math.floor(cy - ry));
  const yEnd = Math.min(height - 1, Math.ceil(cy + ry));
  for (let y = yStart; y <= yEnd; y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.max(0, Math.ceil(cx - half - 0.5));
    const x1 = Math.min(width, Math.floor(cx + half - 0.5) + 1);
    if (x1 > x0) out.push(y, x0, x1);
  }
  return Int32Array.from(out);
}

/**
 * Cuts a particle along the straight line through p1 and p2: the pixels whose centres lie on one
 * side go to the first result and the others to the second. Returns null when the line does not
 * pass through the particle (one side would be empty).
 */
export function splitRunsByLine(runs: Runs, p1: Point, p2: Point): [Runs, Runs] | null {
  const left: number[] = [];
  const right: number[] = [];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  for (let i = 0; i < runs.length; i += 3) {
    const y = runs[i] as number;
    for (let x = runs[i + 1] as number; x < (runs[i + 2] as number); x++) {
      const side = dx * (y + 0.5 - p1.y) - dy * (x + 0.5 - p1.x);
      (side > 0 ? left : right).push(y, x, x + 1);
    }
  }
  if (left.length === 0 || right.length === 0) return null;
  return [normaliseRuns(left), normaliseRuns(right)];
}

/** Distance from a point to the segment a–b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when some pixel centre of the particle lies within `tolerance` pixels of the segment a–b. */
export function segmentTouches(runs: Runs, a: Point, b: Point, tolerance = 1): boolean {
  for (let i = 0; i < runs.length; i += 3) {
    const y = runs[i] as number;
    for (let x = runs[i + 1] as number; x < (runs[i + 2] as number); x++) {
      if (distanceToSegment({ x: x + 0.5, y: y + 0.5 }, a, b) <= tolerance) return true;
    }
  }
  return false;
}

/**
 * Cuts every particle that the drawn segment a–b passes through, along the straight line
 * through a and b. Returns the new list of pieces for each cut particle (a particle the line
 * does not divide is not listed). The caller replaces the originals by the pieces.
 */
export function cutAlongSegment(
  particles: readonly { id: number; runs: Runs }[],
  a: Point,
  b: Point,
): { id: number; pieces: [Runs, Runs] }[] {
  const out: { id: number; pieces: [Runs, Runs] }[] = [];
  for (const particle of particles) {
    if (!segmentTouches(particle.runs, a, b)) continue;
    const pieces = splitRunsByLine(particle.runs, a, b);
    if (pieces) out.push({ id: particle.id, pieces });
  }
  return out;
}
