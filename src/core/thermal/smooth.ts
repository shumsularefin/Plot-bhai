import { solve } from '../math/linear';

/**
 * Local polynomial smoothing and slope on unevenly spaced x (a Savitzky–Golay filter that uses
 * the true x values). For every point i a polynomial of the given order is fitted by least
 * squares to the 2h + 1 points around it (the window is shifted, not shortened, at the ends):
 *   y ≈ c₀ + c₁·(x − xᵢ) + c₂·(x − xᵢ)² + …
 * The smoothed value is c₀ and the slope dy/dx is c₁, both at xᵢ.
 * x must be strictly increasing. Units of the results: y for `value`, y per x for `slope`.
 */
export function localPolynomial(
  x: Float64Array,
  y: Float64Array,
  halfWindow: number,
  order = 2,
): { value: Float64Array; slope: Float64Array } {
  const n = x.length;
  const value = new Float64Array(y);
  const slope = new Float64Array(n);
  const h = Math.floor(halfWindow);
  const size = 2 * h + 1;
  if (h < 1 || size > n || size <= order) {
    // Too few points to fit: fall back to plain differences for the slope.
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      slope[i] =
        b > a ? ((y[b] as number) - (y[a] as number)) / ((x[b] as number) - (x[a] as number)) : 0;
    }
    return { value, slope };
  }
  const terms = order + 1;
  const power = new Array<number>(2 * order + 1).fill(0);
  const rhs = new Array<number>(terms).fill(0);
  for (let i = 0; i < n; i++) {
    const start = Math.min(Math.max(i - h, 0), n - size);
    const xi = x[i] as number;
    const scale = Math.max(xi - (x[start] as number), (x[start + size - 1] as number) - xi) || 1;
    power.fill(0);
    rhs.fill(0);
    for (let j = start; j < start + size; j++) {
      const u = ((x[j] as number) - xi) / scale;
      const yj = y[j] as number;
      let p = 1;
      for (let k = 0; k <= 2 * order; k++) {
        power[k] = (power[k] as number) + p;
        if (k < terms) rhs[k] = (rhs[k] as number) + p * yj;
        p *= u;
      }
    }
    const matrix = Array.from({ length: terms }, (_, r) =>
      Array.from({ length: terms }, (_, c) => power[r + c] as number),
    );
    const c = solve(matrix, rhs);
    if (c) {
      value[i] = c[0] as number;
      slope[i] = ((c[1] as number) ?? 0) / scale;
    }
  }
  return { value, slope };
}

/** Typical spacing of x: the median of the differences between neighbours. */
export function medianSpacing(x: Float64Array): number {
  if (x.length < 2) return NaN;
  const d = Array.from({ length: x.length - 1 }, (_, i) => (x[i + 1] as number) - (x[i] as number));
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] as number;
}

/** Half window in points for a window `widthC` wide (°C), at least 2 points, at most what fits. */
export function halfWindowFor(x: Float64Array, widthC: number): number {
  const spacing = medianSpacing(x);
  if (!(spacing > 0) || !(widthC > 0)) return 0;
  const maxHalf = Math.floor((x.length - 1) / 2);
  return Math.min(maxHalf, Math.max(2, Math.round(widthC / spacing / 2)));
}

/** Smooths y(x) with a window `widthC` wide (°C); a width of 0 leaves the data unchanged. */
export function smooth(x: Float64Array, y: Float64Array, widthC: number): Float64Array {
  const half = widthC > 0 ? halfWindowFor(x, widthC) : 0;
  return half >= 2 ? localPolynomial(x, y, half, 2).value : new Float64Array(y);
}

/**
 * Derivative thermogravimetry: DTG(T) = −dm/dT, with m the mass in % of the reference mass and
 * T in °C, so DTG is in %/°C and is positive where mass is lost. The slope comes from a local
 * quadratic fit over a window `widthC` wide (°C). Multiply by the heating rate (K/min) to get %/min.
 */
export function dtg(
  temperatureC: Float64Array,
  massPct: Float64Array,
  widthC: number,
): Float64Array {
  const half = Math.max(2, halfWindowFor(temperatureC, widthC));
  const { slope } = localPolynomial(temperatureC, massPct, half, 2);
  return slope.map((s) => -s);
}
