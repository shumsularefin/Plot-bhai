import { lowerBoundIndex as lowerBound } from '../../core/xrd/peaks/search';

export { lowerBound };

/** Index of the element closest to value in an increasing array. */
export function nearestIndex(values: ArrayLike<number>, value: number): number {
  const i = lowerBound(values, value);
  if (i === 0) return 0;
  if (i >= values.length) return values.length - 1;
  return value - (values[i - 1] as number) <= (values[i] as number) - value ? i - 1 : i;
}

export interface Decimated {
  x: number[];
  y: number[];
}

/**
 * Reduces the points between x0 and x1 to at most about four per bucket (first, minimum,
 * maximum and last), in their original order. With one bucket per pixel column the drawn line
 * looks the same as drawing every point, so 50,000-point scans stay fast. One point either
 * side of the range is kept so the line runs to the plot edge. x must be increasing.
 */
export function decimate(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  x0: number,
  x1: number,
  buckets: number,
): Decimated {
  const start = Math.max(0, lowerBound(x, x0) - 1);
  const end = Math.min(x.length - 1, lowerBound(x, x1));
  const out: Decimated = { x: [], y: [] };
  if (end < start) return out;
  const push = (i: number) => {
    out.x.push(x[i] as number);
    out.y.push(y[i] as number);
  };

  if (end - start + 1 <= 4 * buckets) {
    for (let i = start; i <= end; i++) push(i);
    return out;
  }

  const width = (x1 - x0) / buckets;
  let i = start;
  while (i <= end) {
    const bucket = Math.floor(((x[i] as number) - x0) / width);
    let first = i;
    let minI = i;
    let maxI = i;
    let last = i;
    while (last + 1 <= end && Math.floor(((x[last + 1] as number) - x0) / width) === bucket) {
      last++;
      if ((y[last] as number) < (y[minI] as number)) minI = last;
      if ((y[last] as number) > (y[maxI] as number)) maxI = last;
    }
    const picks = [first, minI, maxI, last].sort((a, b) => a - b);
    picks.forEach((p, k) => {
      if (k === 0 || p !== picks[k - 1]) push(p);
    });
    first = last + 1;
    i = first;
  }
  return out;
}
