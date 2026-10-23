import { solve } from '../../math/linear';

/**
 * Iterative polynomial background ("modified polyfit", C. A. Lieber and A. Mahadevan-Jansen,
 * Applied Spectroscopy 57 (2003) 1363–1367; checked against the paper).
 *
 *   1. Fit a polynomial of degree `degree` to the data by least squares.
 *   2. Replace every point above the fit by the fit value (peaks are clipped).
 *   3. Repeat until the clipped data change by less than `tolerance` (relative, root-sum-square)
 *      or `maxIterations` is reached.
 *
 * The final polynomial is the background, in the same units as y. x is 2θ in degrees, scaled
 * to −1…1 internally for numerical stability.
 */
export function polynomialBackground(
  x: Float64Array,
  y: Float64Array,
  degree: number,
  maxIterations = 100,
  tolerance = 1e-3,
): Float64Array {
  const n = x.length;
  const lo = x[0] as number;
  const span = (x[n - 1] as number) - lo || 1;
  const t = x.map((v) => (2 * (v - lo)) / span - 1);
  const terms = degree + 1;

  // AᵀA depends only on x, so it is built once: entry (i, j) is Σ t^(i+j).
  const powerSums = new Array<number>(2 * degree + 1).fill(0);
  for (const v of t) {
    let p = 1;
    for (let k = 0; k <= 2 * degree; k++) {
      powerSums[k] = (powerSums[k] as number) + p;
      p *= v;
    }
  }
  const ata = Array.from({ length: terms }, (_, i) =>
    Array.from({ length: terms }, (_, j) => powerSums[i + j] as number),
  );

  const evaluate = (coefficients: number[]) =>
    t.map((v) => coefficients.reduceRight((acc, c) => acc * v + c, 0));

  let work = y.slice();
  let fit = new Float64Array(n);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const aty = new Array<number>(terms).fill(0);
    for (let i = 0; i < n; i++) {
      let p = 1;
      for (let k = 0; k < terms; k++) {
        aty[k] = (aty[k] as number) + p * (work[i] as number);
        p *= t[i] as number;
      }
    }
    const coefficients = solve(ata, aty);
    if (!coefficients) break;
    fit = evaluate(coefficients);
    let change = 0;
    let size = 0;
    const next = work.map((v, i) => Math.min(v, fit[i] as number));
    for (let i = 0; i < n; i++) {
      change += ((next[i] as number) - (work[i] as number)) ** 2;
      size += (work[i] as number) ** 2;
    }
    work = next;
    if (Math.sqrt(change) <= tolerance * Math.sqrt(size)) break;
  }
  return fit;
}

/**
 * SNIP background (Statistics-sensitive Non-linear Iterative Peak-clipping), in the variant
 * used by common implementations, which differs from the original paper in two ways.
 *
 * Original (C. G. Ryan, E. Clayton, W. L. Griffin, S. H. Sie and D. R. Cousens, Nucl. Instrum.
 * Methods B 34 (1988) 396–402, checked against the paper): compress with
 * G(y) = log(log(y + 1) + 1), then clip each channel with z(x) ← min(z(x), [z(x+w) + z(x−w)]/2)
 * at a FIXED width w (about twice the peak FWHM) for about 24 passes, reducing w by √2 over
 * the final 8 or so passes.
 *
 * Here instead the width grows from 1 to `halfWidth` points, and the compression adds a square
 * root (the "LLS" operator). Both changes appear in later SNIP implementations; their origin is
 * not checked here. The data are compressed so peaks of very different heights clip alike:
 *   v = ln(ln(√(y + 1) + 1) + 1)  (negative y treated as 0).
 * Then for p = 1 … halfWidth:  v_i ← min(v_i, (v_{i−p} + v_{i+p}) / 2).
 * The inverse operator gives the background:  y = (exp(exp(v) − 1) − 1)² − 1.
 *
 * `halfWidth` (points) should be about the full width of the broadest peak; intensity units
 * are unchanged.
 */
export function snipBackground(y: Float64Array, halfWidth: number): Float64Array {
  const n = y.length;
  let v = y.map((value) => Math.log(Math.log(Math.sqrt(Math.max(value, 0) + 1) + 1) + 1));
  let next = v.slice();
  for (let p = 1; p <= halfWidth; p++) {
    for (let i = p; i < n - p; i++) {
      const mean = ((v[i - p] as number) + (v[i + p] as number)) / 2;
      next[i] = Math.min(v[i] as number, mean);
    }
    [v, next] = [next, v];
    next.set(v);
  }
  return v.map((value) => (Math.exp(Math.exp(value) - 1) - 1) ** 2 - 1);
}

/**
 * Background through user-chosen anchor points by monotone piecewise cubic Hermite
 * interpolation (F. N. Fritsch and R. E. Carlson, SIAM J. Numer. Anal. 17 (1980) 238–246;
 * checked against the paper), which passes through every anchor without overshooting between
 * them. Slopes at the anchors use the weighted harmonic mean of Fritsch and Butland, a later
 * slope rule that meets the Fritsch–Carlson monotonicity conditions (TODO(verify): Fritsch and
 * Butland's own paper has not been read). Outside the first and last anchor the
 * background is held constant. Anchors are [2θ in degrees, intensity] pairs; at least two are
 * needed.
 */
export function anchorBackground(
  x: Float64Array,
  anchors: readonly (readonly [number, number])[],
): Float64Array {
  const points = [...anchors]
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, all) => i === 0 || p[0] > (all[i - 1] as [number, number])[0]);
  const m = points.length;
  if (m < 2) throw new Error('at least two anchors are needed');
  const px = points.map((p) => p[0]);
  const py = points.map((p) => p[1]);
  const h = px.slice(1).map((v, i) => v - (px[i] as number));
  const delta = h.map((hi, i) => ((py[i + 1] as number) - (py[i] as number)) / hi);
  const slope = new Array<number>(m).fill(0);
  for (let i = 1; i < m - 1; i++) {
    const d0 = delta[i - 1] as number;
    const d1 = delta[i] as number;
    if (d0 * d1 > 0) {
      const w1 = 2 * (h[i] as number) + (h[i - 1] as number);
      const w2 = (h[i] as number) + 2 * (h[i - 1] as number);
      slope[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }
  // One-sided slopes at the ends, limited to keep the curve monotone.
  slope[0] = endSlope(h[0] as number, h[1], delta[0] as number, delta[1]);
  slope[m - 1] = endSlope(h[m - 2] as number, h[m - 3], delta[m - 2] as number, delta[m - 3]);

  const out = new Float64Array(x.length);
  let segment = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    if (xi <= (px[0] as number)) {
      out[i] = py[0] as number;
      continue;
    }
    if (xi >= (px[m - 1] as number)) {
      out[i] = py[m - 1] as number;
      continue;
    }
    while (xi > (px[segment + 1] as number)) segment++;
    const hk = h[segment] as number;
    const s = (xi - (px[segment] as number)) / hk;
    const h00 = (1 + 2 * s) * (1 - s) ** 2;
    const h10 = s * (1 - s) ** 2;
    const h01 = s * s * (3 - 2 * s);
    const h11 = s * s * (s - 1);
    out[i] =
      h00 * (py[segment] as number) +
      h10 * hk * (slope[segment] as number) +
      h01 * (py[segment + 1] as number) +
      h11 * hk * (slope[segment + 1] as number);
  }
  return out;
}

function endSlope(h0: number, h1: number | undefined, d0: number, d1: number | undefined): number {
  if (h1 === undefined || d1 === undefined) return d0; // only two anchors: straight line
  const s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(s) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) return 3 * d0;
  return s;
}
