import type { Domain } from './types';

/** Keeps a view inside the data extent and no narrower than minSpan. */
export function clampDomain([a, b]: Domain, extent: Domain, minSpan: number): Domain {
  const full = extent[1] - extent[0];
  let span = Math.min(Math.max(b - a, minSpan), full);
  if (!(span > 0)) span = full;
  let start = Math.min(Math.max(a, extent[0]), extent[1] - span);
  if (!Number.isFinite(start)) start = extent[0];
  return [start, start + span];
}

/** Zooms by factor (> 1 zooms in) keeping the value at `anchor` in place. */
export function zoomDomain([a, b]: Domain, factor: number, anchor: number): Domain {
  return [anchor - (anchor - a) / factor, anchor + (b - anchor) / factor];
}

export function panDomain([a, b]: Domain, delta: number): Domain {
  return [a + delta, b + delta];
}
