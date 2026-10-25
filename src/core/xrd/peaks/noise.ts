/**
 * Local noise level of a signal, from its second differences.
 *
 * For independent noise of standard deviation σ, the second difference
 * d_i = y_{i−1} − 2 y_i + y_{i+1} has standard deviation σ √6, while a smooth curve (background,
 * broad peaks) contributes almost nothing to it. The noise is therefore estimated robustly as
 *   σ ≈ 1.4826 · median(|d − median(d)|) / √6
 * (1.4826 · MAD is the standard deviation of normally distributed values; the median ignores the
 * few large second differences at sharp peak tops). The estimate is made in blocks of `block`
 * points and interpolated linearly between block centres, so it follows noise that changes along
 * the scan (counting noise grows with intensity). Units are those of y. Needs at least 5 points;
 * returns zeros otherwise.
 */
export function localNoise(y: Float64Array, block = 201): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  if (n < 5) return out;
  const d = new Float64Array(n - 2);
  for (let i = 1; i < n - 1; i++)
    d[i - 1] = (y[i - 1] as number) - 2 * (y[i] as number) + (y[i + 1] as number);
  const size = Math.max(5, Math.min(block, d.length));
  const starts: number[] = [];
  for (let s = 0; s + size <= d.length; s += size) starts.push(s);
  const last = starts[starts.length - 1] ?? 0;
  if (last + size < d.length) starts.push(d.length - size);
  const centres: number[] = [];
  const levels: number[] = [];
  for (const s of starts) {
    const part = Array.from(d.subarray(s, s + size)).sort((a, b) => a - b);
    const med = median(part);
    const mad = median(part.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
    centres.push(s + 1 + (size - 1) / 2);
    levels.push((1.4826 * mad) / Math.sqrt(6));
  }
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < centres.length - 1 && (centres[k + 1] as number) < i) k++;
    const c0 = centres[k] as number;
    const c1 = centres[Math.min(k + 1, centres.length - 1)] as number;
    const l0 = levels[k] as number;
    const l1 = levels[Math.min(k + 1, levels.length - 1)] as number;
    out[i] = c1 === c0 || i <= c0 ? l0 : i >= c1 ? l1 : l0 + ((l1 - l0) * (i - c0)) / (c1 - c0);
  }
  return out;
}

function median(sorted: readonly number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[m] as number)
    : ((sorted[m - 1] as number) + (sorted[m] as number)) / 2;
}
