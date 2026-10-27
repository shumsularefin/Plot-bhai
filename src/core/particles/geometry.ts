/*
 * Geometry of particle measurements. Everything is stored in pixels of the ORIGINAL image
 * (x to the right, y down, origin at the top left corner of the image); lengths in nm or µm come
 * from the scale calibration. Pixels are assumed square.
 */

export interface Point {
  x: number;
  y: number;
}

/** Pixel rectangle: x and y of the top left corner, width and height. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LengthUnit = 'nm' | 'um';

/** Nanometres in one unit: 1 µm = 1000 nm by definition of the prefix. */
export const NM_PER_UNIT: Record<LengthUnit, number> = { nm: 1, um: 1000 };

export const UNIT_LABELS: Record<LengthUnit, string> = { nm: 'nm', um: 'µm' };

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The scale bar the user drew (two points in original pixels) and the length it stands for. */
export interface Calibration {
  p1: Point;
  p2: Point;
  /** Real length of the bar in `unit`. */
  length: number;
  unit: LengthUnit;
}

/**
 * Pixels per nanometre of a calibration: (distance between the two points in pixels) divided by
 * (bar length converted to nm). Returns null when the points coincide or the length is not
 * positive, so no scale can be derived.
 */
export function pixelsPerNm(calibration: Calibration): number | null {
  const pixels = distance(calibration.p1, calibration.p2);
  const nm = calibration.length * NM_PER_UNIT[calibration.unit];
  return pixels > 0 && nm > 0 && Number.isFinite(pixels / nm) ? pixels / nm : null;
}

/** Pixels per `unit` (for example px/µm), or null without a usable calibration. */
export function pixelsPerUnit(calibration: Calibration, unit: LengthUnit): number | null {
  const perNm = pixelsPerNm(calibration);
  return perNm === null ? null : perNm * NM_PER_UNIT[unit];
}

/** Length of one pixel in nm, or null without a usable calibration. */
export function nmPerPixel(calibration: Calibration): number | null {
  const perNm = pixelsPerNm(calibration);
  return perNm === null ? null : 1 / perNm;
}

/** A length in pixels as nm, or null without a usable calibration. */
export function pixelsToNm(pixels: number, calibration: Calibration | null): number | null {
  const factor = calibration ? nmPerPixel(calibration) : null;
  return factor === null ? null : pixels * factor;
}

/** A length given in nm shown in the unit that reads best: µm from 1000 nm upwards. */
export function bestUnit(nm: number): LengthUnit {
  return Math.abs(nm) >= 1000 ? 'um' : 'nm';
}

export type MeasurementKind = 'line' | 'circle' | 'ellipse';

/**
 * A manual measurement. A line is its two end points. A circle is drawn along one diameter: a
 * and b are the two ends of the diameter. An ellipse is drawn as its bounding box: a and b are
 * opposite corners, and the axes are parallel to the image edges.
 */
export interface Measurement {
  id: number;
  kind: MeasurementKind;
  a: Point;
  b: Point;
}

export interface MeasuredSizes {
  /** Line length, or circle diameter, or the longer ellipse axis, in px. */
  major: number;
  /** The shorter ellipse axis (equal to major for lines and circles), in px. */
  minor: number;
  /** Area in px² (0 for a line). Circle π d²/4; ellipse π · major · minor / 4. */
  area: number;
  /** Diameter of the circle with the same area, in px: √(4 · area / π); the line length for a line. */
  equivalentDiameter: number;
  /** major / minor, 1 for lines and circles. */
  aspectRatio: number;
}

/** Sizes of a measurement in pixels of the original image. */
export function measure(m: Measurement): MeasuredSizes {
  if (m.kind === 'line') {
    const length = distance(m.a, m.b);
    return { major: length, minor: length, area: 0, equivalentDiameter: length, aspectRatio: 1 };
  }
  if (m.kind === 'circle') {
    const d = distance(m.a, m.b);
    return {
      major: d,
      minor: d,
      area: (Math.PI * d * d) / 4,
      equivalentDiameter: d,
      aspectRatio: 1,
    };
  }
  const w = Math.abs(m.b.x - m.a.x);
  const h = Math.abs(m.b.y - m.a.y);
  const major = Math.max(w, h);
  const minor = Math.min(w, h);
  return {
    major,
    minor,
    area: (Math.PI * major * minor) / 4,
    equivalentDiameter: Math.sqrt(major * minor),
    aspectRatio: minor > 0 ? major / minor : Number.POSITIVE_INFINITY,
  };
}

/** Largest long side of the working copy, px: a limit of mine so canvases stay light, not a standard. */
export const MAX_WORKING_SIDE = 4096;

/**
 * Scale factor from original pixels to the working copy used on screen and for analysis: 1 for
 * images that fit, otherwise the long side is brought down to `maxSide`. Results measured on the
 * working copy are mapped back with `toOriginal`.
 */
export function workingScale(width: number, height: number, maxSide = MAX_WORKING_SIDE): number {
  const longSide = Math.max(width, height);
  return longSide > maxSide ? maxSide / longSide : 1;
}

export const toWorking = (p: Point, scale: number): Point => ({ x: p.x * scale, y: p.y * scale });
export const toOriginal = (p: Point, scale: number): Point => ({ x: p.x / scale, y: p.y / scale });

/** The rectangle between two corners, limited to the image and at least one pixel in size. */
export function rectFromCorners(a: Point, b: Point, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(width, Math.max(a.x, b.x));
  const y1 = Math.min(height, Math.max(a.y, b.y));
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Which part of a rectangle a drag holds: the whole of it, or one or two of its edges. */
export type RectGrab = 'move' | { left: boolean; right: boolean; top: boolean; bottom: boolean };

/**
 * The part of `rect` under point p: an edge (or a corner, two edges) within `tolerance` of p,
 * else 'move' when p is inside, else null. All in the same units (for example screen pixels).
 */
export function grabAt(rect: Rect, p: Point, tolerance: number): RectGrab | null {
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;
  const withinX = p.x >= rect.x - tolerance && p.x <= x1 + tolerance;
  const withinY = p.y >= rect.y - tolerance && p.y <= y1 + tolerance;
  if (!withinX || !withinY) return null;
  const grab = {
    left: Math.abs(p.x - rect.x) <= tolerance,
    right: Math.abs(p.x - x1) <= tolerance,
    top: Math.abs(p.y - rect.y) <= tolerance,
    bottom: Math.abs(p.y - y1) <= tolerance,
  };
  // A rectangle narrower than twice the tolerance: take the nearer edge only.
  if (grab.left && grab.right) grab[p.x - rect.x < x1 - p.x ? 'right' : 'left'] = false;
  if (grab.top && grab.bottom) grab[p.y - rect.y < y1 - p.y ? 'bottom' : 'top'] = false;
  if (grab.left || grab.right || grab.top || grab.bottom) return grab;
  return 'move';
}

/**
 * `start` after a drag by (dx, dy) of the grabbed part, in image pixels: moved whole and kept
 * inside the image, or with the grabbed edges moved, limited to the image and to at least `min`
 * pixels in each direction.
 */
export function dragRect(
  start: Rect,
  grab: RectGrab,
  dx: number,
  dy: number,
  width: number,
  height: number,
  min = 8,
): Rect {
  if (grab === 'move') {
    return {
      ...start,
      x: Math.min(Math.max(0, start.x + dx), width - start.width),
      y: Math.min(Math.max(0, start.y + dy), height - start.height),
    };
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.width;
  let y1 = start.y + start.height;
  if (grab.left) x0 = Math.min(Math.max(0, x0 + dx), x1 - min);
  if (grab.right) x1 = Math.max(Math.min(width, x1 + dx), x0 + min);
  if (grab.top) y0 = Math.min(Math.max(0, y0 + dy), y1 - min);
  if (grab.bottom) y1 = Math.max(Math.min(height, y1 + dy), y0 + min);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The whole image without its bottom `strip` pixels (SEM and TEM data bars are usually at the
 * bottom). Returns null when nothing would be left.
 */
export function cropBottom(strip: number, width: number, height: number): Rect | null {
  const keep = height - Math.max(0, Math.round(strip));
  return keep >= 1 ? { x: 0, y: 0, width, height: keep } : null;
}
