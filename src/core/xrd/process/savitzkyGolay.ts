import { invert } from '../../math/linear';

/**
 * Savitzky–Golay smoothing (A. Savitzky and M. J. E. Golay, Anal. Chem. 36 (1964) 1627–1639).
 *
 * Each point is replaced by the value at that point of the least-squares polynomial of degree
 * `order` fitted to the `window` points centred on it (window odd, order < window). For the
 * first and last half-window the polynomial fitted to the first or last full window is
 * evaluated at each point instead, so the ends are smoothed without losing points.
 *
 * Assumes evenly spaced points; intensity units are unchanged. Polynomials up to degree
 * `order` pass through unchanged, which is why peak heights and positions are kept far better
 * than with a moving average of the same width.
 */
export function savitzkyGolay(y: Float64Array, window: number, order: number): Float64Array {
  const n = y.length;
  if (window % 2 === 0 || window < 3) throw new Error('window must be odd and at least 3');
  if (order < 0 || order >= window) throw new Error('order must be between 0 and window − 1');
  if (n < window) return y.slice();

  const half = (window - 1) / 2;
  const g = projection(window, order, half);
  // Weights to evaluate the fitted polynomial at offset t (−half … half) from the window centre.
  const weightsAt = (t: number) => {
    const w = new Float64Array(window);
    for (let k = 0; k < window; k++) {
      let sum = 0;
      let power = 1;
      for (let j = 0; j <= order; j++) {
        sum += power * (g[j]?.[k] as number);
        power *= t / half;
      }
      w[k] = sum;
    }
    return w;
  };

  const out = new Float64Array(n);
  const centre = weightsAt(0);
  for (let i = half; i < n - half; i++) {
    let sum = 0;
    for (let k = 0; k < window; k++) sum += (centre[k] as number) * (y[i - half + k] as number);
    out[i] = sum;
  }
  for (let t = -half; t < 0; t++) {
    const w = weightsAt(t);
    let head = 0;
    let tail = 0;
    for (let k = 0; k < window; k++) {
      head += (w[k] as number) * (y[k] as number);
      // By symmetry, weights for offset t applied to the reversed last window give the value
      // at offset −t from that window's centre.
      tail += (w[k] as number) * (y[n - 1 - k] as number);
    }
    out[t + half] = head;
    out[n - 1 - (t + half)] = tail;
  }
  return out;
}

/**
 * Savitzky–Golay derivative of order `derivative` (1 or 2, or 0 for smoothing) for points spaced
 * `step` apart: the same local polynomial as savitzkyGolay, differentiated at each point.
 * With s = t / half the scaled offset of a point t samples from the window centre and c_j the
 * fitted coefficients of p(s) = Σ c_j s^j, the derivative with respect to x is
 *   d^k p / dx^k = (1 / (half · step))^k · Σ_{j ≥ k} j! / (j − k)! · c_j · s^(j − k).
 * The ends use the first and last full window, as in savitzkyGolay. Units: y units per x unit^k.
 * Needs order ≥ derivative and evenly spaced points.
 */
export function savitzkyGolayDerivative(
  y: Float64Array,
  window: number,
  order: number,
  derivative: number,
  step: number,
): Float64Array {
  const n = y.length;
  if (window % 2 === 0 || window < 3) throw new Error('window must be odd and at least 3');
  if (order < derivative || order >= window)
    throw new Error('order must be at least the derivative and below the window');
  const out = new Float64Array(n);
  if (n < window) return out.fill(NaN);
  const half = (window - 1) / 2;
  const g = projection(window, order, half);
  const scale = (1 / (half * step)) ** derivative;
  const falling = (j: number) => {
    let f = 1;
    for (let r = 0; r < derivative; r++) f *= j - r;
    return f;
  };
  const weightsAt = (t: number) => {
    const s = t / half;
    const w = new Float64Array(window);
    for (let k = 0; k < window; k++) {
      let sum = 0;
      for (let j = derivative; j <= order; j++)
        sum += falling(j) * s ** (j - derivative) * (g[j]?.[k] as number);
      w[k] = sum * scale;
    }
    return w;
  };
  const centre = weightsAt(0);
  for (let i = half; i < n - half; i++) {
    let sum = 0;
    for (let k = 0; k < window; k++) sum += (centre[k] as number) * (y[i - half + k] as number);
    out[i] = sum;
  }
  for (let t = -half; t < 0; t++) {
    const head = weightsAt(t);
    const tail = weightsAt(-t);
    let a = 0;
    let b = 0;
    for (let k = 0; k < window; k++) {
      a += (head[k] as number) * (y[k] as number);
      b += (tail[k] as number) * (y[n - window + k] as number);
    }
    out[t + half] = a;
    out[n - 1 - (t + half)] = b;
  }
  return out;
}

/**
 * Least-squares projection G = (AᵀA)⁻¹Aᵀ for A[k][j] = (s_k)^j, with s_k = (k − half)/half
 * scaled to −1…1 for numerical stability. Row j of G gives the j-th polynomial coefficient.
 */
function projection(window: number, order: number, half: number): number[][] {
  const s = Array.from({ length: window }, (_, k) => (k - half) / half);
  const ata = Array.from({ length: order + 1 }, (_, i) =>
    Array.from({ length: order + 1 }, (_, j) => s.reduce((sum, v) => sum + v ** (i + j), 0)),
  );
  const inverse = invert(ata);
  if (!inverse) throw new Error('Savitzky–Golay system is singular');
  return inverse.map((row) =>
    s.map((_, k) => row.reduce((sum, value, j) => sum + value * (s[k] as number) ** j, 0)),
  );
}
