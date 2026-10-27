/*
 * From traced pixels to a diffraction pattern: the user's corrections are applied, the pixels
 * are converted with the axis calibration, and the result is resampled on an even 2θ grid of
 * one pixel's width (what the cleaning and fitting steps expect).
 */

import type { Point, Rect } from '../particles/geometry';
import { degreesPerPixel, toData, type Calibration } from './calibration';

export interface CurveEdits {
  /** Areas whose traced points are removed (image pixels). */
  erased: readonly Rect[];
  /** Points placed by hand; each replaces the traced point of its pixel column. */
  added: readonly Point[];
}

const inside = (p: Point, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Traced points after the corrections, sorted left to right. */
export function applyEdits(points: readonly Point[], edits: CurveEdits): Point[] {
  const columns = new Set(edits.added.map((p) => Math.floor(p.x)));
  const kept = points.filter(
    (p) => !columns.has(Math.floor(p.x)) && !edits.erased.some((r) => inside(p, r)),
  );
  return [...kept, ...edits.added].sort((a, b) => a.x - b.x);
}

export interface DigitizedPattern {
  twoTheta: Float64Array;
  intensity: Float64Array;
  /** Even 2θ step of the grid, degrees (one pixel). */
  step: number;
  /** 2θ ranges with no traced point, bridged by straight lines (degrees). */
  gaps: [number, number][];
}

/** A gap wider than this many grid steps is reported. */
const REPORTED_GAP_STEPS = 3;

/**
 * Converts image points to (2θ, intensity) and resamples them by linear interpolation on an even
 * grid with the step of one pixel along the 2θ axis. Returns null with fewer than 2 points.
 */
export function toPattern(
  points: readonly Point[],
  calibration: Calibration,
): DigitizedPattern | null {
  const values = points
    .map((p) => toData(calibration, p))
    .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y))
    .sort((a, b) => a.x - b.x);
  // Points of the same 2θ (a hand-placed point beside a traced one) are averaged.
  const merged: { x: number; y: number; n: number }[] = [];
  for (const v of values) {
    const last = merged[merged.length - 1];
    if (last && v.x - last.x < 1e-9) {
      last.y = (last.y * last.n + v.y) / (last.n + 1);
      last.n++;
    } else merged.push({ ...v, n: 1 });
  }
  if (merged.length < 2) return null;
  const step = degreesPerPixel(calibration);
  const first = (merged[0] as { x: number }).x;
  const last = (merged[merged.length - 1] as { x: number }).x;
  const n = Math.floor((last - first) / step + 1e-9) + 1;
  const twoTheta = new Float64Array(n);
  const intensity = new Float64Array(n);
  const gaps: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = first + i * step;
    while (j < merged.length - 2 && (merged[j + 1] as { x: number }).x < x) j++;
    const a = merged[j] as { x: number; y: number };
    const b = merged[j + 1] as { x: number; y: number };
    const t = b.x === a.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
    twoTheta[i] = x;
    intensity[i] = a.y + t * (b.y - a.y);
  }
  for (let k = 1; k < merged.length; k++) {
    const a = merged[k - 1] as { x: number };
    const b = merged[k] as { x: number };
    if (b.x - a.x > REPORTED_GAP_STEPS * step) gaps.push([a.x, b.x]);
  }
  return { twoTheta, intensity, step, gaps };
}
