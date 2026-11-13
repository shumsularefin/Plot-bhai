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

/**
 * Least-squares line through the origin, y = slope · x:
 *   slope = Σxy / Σx²,   σ²(slope) = s² / Σx²,   s² = SSR / (n − 1).
 * The intercept is 0 by construction (σ 0). R² is 1 − SSR / SST with SST about the mean of y,
 * so it can be negative when a line through the origin fits worse than a constant.
 * Returns null with fewer than two points or when every x is 0.
 */
export function originFit(x: readonly number[], y: readonly number[]): LinearFit | null {
  const n = x.length;
  if (n < 2) return null;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] as number) ** 2;
    sxy += (x[i] as number) * (y[i] as number);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const yBar = y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    ssr += ((y[i] as number) - slope * (x[i] as number)) ** 2;
    sst += ((y[i] as number) - yBar) ** 2;
  }
  return {
    intercept: 0,
    slope,
    interceptSigma: 0,
    slopeSigma: Math.sqrt(ssr / (n - 1) / sxx),
    rSquared: sst > 0 ? 1 - ssr / sst : NaN,
    n,
  };
}

/** Weighted straight-line fit: the scaled uncertainties, plus those from the weights alone. */
export interface WeightedLinearFit extends LinearFit {
  /** Uncertainties from the σ of the points alone (correct when the σ are the real scatter). */
  slopeSigmaUnscaled: number;
  interceptSigmaUnscaled: number;
  /** χ²_ν = Σ w (y − fit)² / (n − 2); NaN with two points. */
  reducedChi2: number;
}

/**
 * Weighted least squares, y = intercept + slope · x, with weights w = 1/σ². With the weighted
 * means x̄ = Σwx/Σw, ȳ = Σwy/Σw and Sxx = Σw(x − x̄)² (the normal equations in centred form, which
 * keep precision when y changes little against its size, as a lattice parameter does):
 *   slope = Σw(x − x̄)(y − ȳ) / Sxx,   intercept = ȳ − slope · x̄,
 *   σ²(slope) = 1 / Sxx,   σ²(intercept) = 1/Σw + x̄² / Sxx   (from the σ alone, "unscaled").
 * The reported (scaled) uncertainties multiply these variances by χ²_ν = Σw(y − fit)²/(n − 2),
 * so the scatter of the points about the line sets them, as numpy.polyfit(…, w = 1/σ, cov = True)
 * does; refinement s.u. usually underestimate the real scatter. R² is the weighted
 * 1 − Σw(y − fit)² / Σw(y − ȳ)². Units follow x and y; σ has the unit of y.
 * Returns null with fewer than two points, a σ that is not positive, or every x the same.
 */
export function weightedLinearFit(
  x: readonly number[],
  y: readonly number[],
  sigma: readonly number[],
): WeightedLinearFit | null {
  const n = x.length;
  if (n < 2 || sigma.some((s) => !(s > 0) || !Number.isFinite(s))) return null;
  const w = sigma.map((s) => 1 / (s * s));
  const sw = w.reduce((t, v) => t + v, 0);
  const xBar = w.reduce((t, v, i) => t + v * (x[i] as number), 0) / sw;
  const yBar = w.reduce((t, v, i) => t + v * (y[i] as number), 0) / sw;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - xBar;
    const dy = (y[i] as number) - yBar;
    sxx += (w[i] as number) * dx * dx;
    sxy += (w[i] as number) * dx * dy;
    sst += (w[i] as number) * dy * dy;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  let chi2 = 0;
  for (let i = 0; i < n; i++)
    chi2 += (w[i] as number) * ((y[i] as number) - intercept - slope * (x[i] as number)) ** 2;
  const reducedChi2 = n > 2 ? chi2 / (n - 2) : NaN;
  const slopeSigmaUnscaled = Math.sqrt(1 / sxx);
  const interceptSigmaUnscaled = Math.sqrt(1 / sw + (xBar * xBar) / sxx);
  return {
    intercept,
    slope,
    slopeSigma: slopeSigmaUnscaled * Math.sqrt(reducedChi2),
    interceptSigma: interceptSigmaUnscaled * Math.sqrt(reducedChi2),
    slopeSigmaUnscaled,
    interceptSigmaUnscaled,
    reducedChi2,
    rSquared: sst > 0 ? 1 - chi2 / sst : NaN,
    n,
  };
}
