/** Index of the first element ≥ value in an increasing array (binary search). */
export function lowerBoundIndex(values: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
