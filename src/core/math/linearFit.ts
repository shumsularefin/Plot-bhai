/** Straight-line fit y = intercept + slope · x with standard uncertainties. */
export interface LinearFit {
  intercept: number;
  slope: number;
  /** Standard uncertainties from s² = SSR / (n − 2); NaN with only two points. */
  interceptSigma: number;
  slopeSigma: number;
  /** Coefficient of determination 1 − SSR / SST (NaN when every y is equal). */
  rSquared: number;
  n: number;
}

/**
 * Ordinary (unweighted) least squares, the textbook closed form:
 *   slope = Sxy / Sxx,   intercept = ȳ − slope · x̄,
 *   σ²(slope) = s² / Sxx,   σ²(intercept) = s² (1/n + x̄² / Sxx),   s² = SSR / (n − 2),
 * with Sxx = Σ(x − x̄)² and Sxy = Σ(x − x̄)(y − ȳ). Units follow x and y.
 * Returns null with fewer than two points or when every x is the same.
 */
export function linearFit(x: readonly number[], y: readonly number[]): LinearFit | null {
  const n = x.length;
  if (n < 2) return null;
  const xBar = x.reduce((s, v) => s + v, 0) / n;
  const yBar = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - xBar;
    const dy = (y[i] as number) - yBar;
    sxx += dx * dx;
    sxy += dx * dy;
    sst += dy * dy;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += ((y[i] as number) - intercept - slope * (x[i] as number)) ** 2;
  const s2 = n > 2 ? ssr / (n - 2) : NaN;
  return {
    intercept,
    slope,
    interceptSigma: Math.sqrt(s2 * (1 / n + (xBar * xBar) / sxx)),
    slopeSigma: Math.sqrt(s2 / sxx),
    rSquared: sst > 0 ? 1 - ssr / sst : NaN,
    n,
  };
}
