/*
 * Axis calibration of a plot image. All positions are image pixels (x to the right, y down).
 *
 * The user marks two points on the x axis with known values (x₁ at P₁, x₂ at P₂) and two on
 * the y axis (y₁ at Q₁, y₂ at Q₂). With u = P₂ − P₁ and v = Q₂ − Q₁ the axis directions, any
 * pixel p is written in the basis (u, v):
 *   p = P₁ + a u + b v   ⇒   x = x₁ + a (x₂ − x₁)
 *   p = Q₁ + c u + d v   ⇒   y = y₁ + d (y₂ − y₁)            (linear intensity axis)
 *                             log₁₀ y = log₁₀ y₁ + d (log₁₀ y₂ − log₁₀ y₁)   (log axis)
 * This is an affine map, so it stays exact when the image is rotated or slightly sheared, as
 * long as the plot's axes are straight lines.
 */

import type { Point } from '../particles/geometry';

export type AxisScale = 'linear' | 'log';

/** A marked point on an axis and the value the user typed for it. */
export interface AxisPoint {
  at: Point;
  value: number;
}

export interface Calibration {
  x: readonly [AxisPoint, AxisPoint];
  y: readonly [AxisPoint, AxisPoint];
  yScale: AxisScale;
}

/** Points closer than this (pixels) give too coarse a scale. */
const MIN_SPAN_PX = 20;
/** Tilt of the x axis (degrees) above which the image should be straightened first. */
export const MAX_TILT_DEG = 1;
/** Departure of the axes from a right angle (degrees) above which the marks are suspect. */
const MAX_SKEW_DEG = 2;

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const length = (a: Point) => Math.hypot(a.x, a.y);

/** Coefficients (a, b) with w = a u + b v, or null when u and v are parallel. */
function decompose(w: Point, u: Point, v: Point): [number, number] | null {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) < 1e-9 * Math.max(1, length(u) * length(v))) return null;
  return [(w.x * v.y - w.y * v.x) / det, (u.x * w.y - u.y * w.x) / det];
}

const toAxis = (value: number, scale: AxisScale) => (scale === 'log' ? Math.log10(value) : value);
const fromAxis = (value: number, scale: AxisScale) => (scale === 'log' ? 10 ** value : value);

/** A plain-language reason the calibration cannot be used, or null when it can. */
export function calibrationError(c: Calibration): string | null {
  const [x1, x2] = c.x;
  const [y1, y2] = c.y;
  const finite = [x1.value, x2.value, y1.value, y2.value].every(Number.isFinite);
  if (!finite) return 'Type a number for each of the four marked points.';
  if (x1.value === x2.value) return 'The two 2θ points need different values.';
  if (y1.value === y2.value) return 'The two intensity points need different values.';
  if (c.yScale === 'log' && (y1.value <= 0 || y2.value <= 0))
    return 'On a logarithmic axis the intensity values must be above zero.';
  if (length(sub(x2.at, x1.at)) < 1 || length(sub(y2.at, y1.at)) < 1)
    return 'Each pair of points must be at two different places on the image.';
  if (!decompose({ x: 0, y: 0 }, sub(x2.at, x1.at), sub(y2.at, y1.at)))
    return 'The x and y points lie along the same line. Mark two points along the 2θ axis and two along the intensity axis.';
  return null;
}

/** Things that work but make the result less accurate, in plain language. */
export function calibrationWarnings(c: Calibration): string[] {
  const out: string[] = [];
  const u = sub(c.x[1].at, c.x[0].at);
  const v = sub(c.y[1].at, c.y[0].at);
  if (length(u) < MIN_SPAN_PX || length(v) < MIN_SPAN_PX)
    out.push(
      'Two of the marked points are very close together, so a small clicking error changes the scale a lot. Use ticks far apart, near the ends of each axis.',
    );
  const tilt = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  const tiltFromLevel = Math.abs(((tilt + 90) % 180) - 90);
  if (tiltFromLevel > MAX_TILT_DEG)
    out.push(
      `The 2θ axis is tilted by ${tiltFromLevel.toFixed(1)}°. The values are still mapped correctly, but the curve is read column by column, so straighten the image in step 1 for a cleaner trace.`,
    );
  const angle = (Math.acos((u.x * v.x + u.y * v.y) / (length(u) * length(v))) * 180) / Math.PI;
  if (Math.abs(angle - 90) > MAX_SKEW_DEG)
    out.push(
      `The two axes meet at ${angle.toFixed(1)}°, not 90°. Check that the 2θ points are on the horizontal axis and the intensity points on the vertical one.`,
    );
  if (Math.sign(c.x[1].value - c.x[0].value) !== Math.sign(u.x))
    out.push(
      '2θ increases to the left on this calibration. Check the values typed for the 2θ points.',
    );
  return out;
}

/** The data value (2θ, intensity) at an image pixel. Call only with a calibration without error. */
export function toData(c: Calibration, p: Point): { x: number; y: number } {
  const u = sub(c.x[1].at, c.x[0].at);
  const v = sub(c.y[1].at, c.y[0].at);
  const [a] = decompose(sub(p, c.x[0].at), u, v) ?? [NaN];
  const [, d] = decompose(sub(p, c.y[0].at), u, v) ?? [NaN, NaN];
  const y0 = toAxis(c.y[0].value, c.yScale);
  const y1 = toAxis(c.y[1].value, c.yScale);
  return {
    x: c.x[0].value + a * (c.x[1].value - c.x[0].value),
    y: fromAxis(y0 + d * (y1 - y0), c.yScale),
  };
}

/** The image pixel of a data value, the inverse of toData (for drawing ticks and curves). */
export function toPixel(c: Calibration, value: { x: number; y: number }): Point {
  const u = sub(c.x[1].at, c.x[0].at);
  const v = sub(c.y[1].at, c.y[0].at);
  const a = (value.x - c.x[0].value) / (c.x[1].value - c.x[0].value);
  const y0 = toAxis(c.y[0].value, c.yScale);
  const d = (toAxis(value.y, c.yScale) - y0) / (toAxis(c.y[1].value, c.yScale) - y0);
  // Q₁ − P₁ = α u + β v, and p = P₁ + a u + b v = Q₁ + c u + d v gives b = d + β.
  const [, beta] = decompose(sub(c.y[0].at, c.x[0].at), u, v) ?? [NaN, NaN];
  const b = d + beta;
  return { x: c.x[0].at.x + a * u.x + b * v.x, y: c.x[0].at.y + a * u.y + b * v.y };
}

/** Degrees 2θ covered by one pixel along the 2θ axis. */
export function degreesPerPixel(c: Calibration): number {
  const u = sub(c.x[1].at, c.x[0].at);
  return Math.abs(c.x[1].value - c.x[0].value) / length(u);
}
