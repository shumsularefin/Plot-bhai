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
