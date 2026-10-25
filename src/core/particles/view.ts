import type { Point, Rect } from './geometry';

/** How the image sits in its box: screen = image · scale + (tx, ty), all in CSS pixels. */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** Zoom limits relative to the fitted view. */
export const MAX_ZOOM_FACTOR = 40;

/** The transform that fits the whole image inside a box, centred, never enlarged beyond 1:1 unless asked. */
export function fitView(
  boxWidth: number,
  boxHeight: number,
  imageWidth: number,
  imageHeight: number,
): ViewTransform {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  return {
    scale,
    tx: (boxWidth - imageWidth * scale) / 2,
    ty: (boxHeight - imageHeight * scale) / 2,
  };
}

/**
 * The transform that fits one rectangle of the image (for example the crop area, in image
 * pixels) inside a box, centred.
 */
export function fitRect(boxWidth: number, boxHeight: number, rect: Rect): ViewTransform {
  const scale = Math.min(boxWidth / rect.width, boxHeight / rect.height);
  return {
    scale,
    tx: (boxWidth - rect.width * scale) / 2 - rect.x * scale,
    ty: (boxHeight - rect.height * scale) / 2 - rect.y * scale,
  };
}

export const toScreen = (p: Point, v: ViewTransform): Point => ({
  x: p.x * v.scale + v.tx,
  y: p.y * v.scale + v.ty,
});

export const toImage = (p: Point, v: ViewTransform): Point => ({
  x: (p.x - v.tx) / v.scale,
  y: (p.y - v.ty) / v.scale,
});

/**
 * Zooms by `factor` keeping the image point under the screen point (cx, cy) fixed. The scale is
 * kept between `minScale` and `minScale · MAX_ZOOM_FACTOR`.
 */
export function zoomAt(
  v: ViewTransform,
  factor: number,
  cx: number,
  cy: number,
  minScale: number,
): ViewTransform {
  const scale = Math.min(Math.max(v.scale * factor, minScale), minScale * MAX_ZOOM_FACTOR);
  const k = scale / v.scale;
  return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
}

export const pan = (v: ViewTransform, dx: number, dy: number): ViewTransform => ({
  ...v,
  tx: v.tx + dx,
  ty: v.ty + dy,
});
