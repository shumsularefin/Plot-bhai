import { polynomialBackground } from '../xrd/process/background';

/**
 * Rubber-band baseline: the lower convex hull of the spectrum, as if a rubber band were
 * stretched under it, then straight lines between the hull's vertices. x must increase.
 * Same units as y. Suitable for absorbance spectra with peaks pointing up; it never lies above
 * the data.
 */
export function rubberBandBaseline(x: Float64Array, y: Float64Array): Float64Array {
  const n = x.length;
  const hull: number[] = [];
  for (let i = 0; i < n; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2] as number;
      const b = hull[hull.length - 1] as number;
      // Remove b when it lies on or above the line from a to i (cross product ≤ 0).
      const cross =
        ((x[b] as number) - (x[a] as number)) * ((y[i] as number) - (y[a] as number)) -
        ((y[b] as number) - (y[a] as number)) * ((x[i] as number) - (x[a] as number));
      if (cross <= 0) hull.pop();
      else break;
    }
    hull.push(i);
  }
  const out = new Float64Array(n);
  for (let h = 0; h < hull.length - 1; h++) {
    const a = hull[h] as number;
    const b = hull[h + 1] as number;
    for (let i = a; i <= b; i++) {
      const t = ((x[i] as number) - (x[a] as number)) / ((x[b] as number) - (x[a] as number));
      out[i] = (y[a] as number) * (1 - t) + (y[b] as number) * t;
    }
  }
  return out;
}

/** Iterative polynomial baseline (Lieber and Mahadevan-Jansen); see polynomialBackground. */
export function polynomialBaseline(x: Float64Array, y: Float64Array, degree: number): Float64Array {
  return polynomialBackground(x, y, degree);
}
