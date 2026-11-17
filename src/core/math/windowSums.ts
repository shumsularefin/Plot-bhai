/*
 * Straight-line fits over many windows [start, end] of one data set, each in constant time, from
 * prefix sums of x, y, x², xy and y². Plain prefix sums lose precision: Σ(x − x̄)² is the small
 * difference of two large numbers. Here every product is exact (Dekker's TwoProduct) and every sum
 * is kept as an unevaluated pair hi + lo of doubles ("double-double", about 32 significant
 * digits; Knuth's TwoSum), so a window's sums and centred sums are correct to about one rounding
 * of a double, more accurate than the sequential sums of `linearFit`.
 *
 * Sources: T. J. Dekker, "A floating-point technique for extending the available precision",
 * Numer. Math. 18 (1971) 224–242 (split and TwoProduct); D. E. Knuth, The Art of Computer
 * Programming vol. 2, 4.2.2 (TwoSum); Y. Hida, X. S. Li and D. H. Bailey, "Algorithms for
 * quad-double precision floating point arithmetic", ARITH-15 (2001) (double-double add and
 * multiply). The results are close to `linearFit`, not bit-identical: callers that need its exact
 * numbers use these to decide, and call `linearFit` when a decision is too close to call.
 *
 * The double-double functions return the high word and leave the low word in `low`, so that the
 * hundreds of thousands of windows of a search allocate nothing.
 */

/** Low word of the last double-double result. */
let low = 0;

/** (ah + al) + (bh + bl) in double-double (Hida, Li and Bailey, accurate addition). */
function add(ah: number, al: number, bh: number, bl: number): number {
  const s = ah + bh;
  let v = s - ah;
  let e = ah - (s - v) + (bh - v);
  const t = al + bl;
  v = t - al;
  const f = al - (t - v) + (bl - v);
  e += t;
  const s2 = s + e;
  e = e - (s2 - s) + f;
  const hi = s2 + e;
  low = e - (hi - s2);
  return hi;
}

const SPLITTER = 134217729; // 2^27 + 1, Dekker's split; |values| must stay well below 1e300

/** (ah + al)·(bh + bl) in double-double; exact for al = bl = 0 (TwoProduct). */
function mul(ah: number, al: number, bh: number, bl: number): number {
  const p = ah * bh;
  const ca = SPLITTER * ah;
  const ahh = ca - (ca - ah);
  const ahl = ah - ahh;
  const cb = SPLITTER * bh;
  const bhh = cb - (cb - bh);
  const bhl = bh - bhh;
  const e = ahh * bhh - p + ahh * bhl + ahl * bhh + ahl * bhl + (ah * bl + al * bh);
  const hi = p + e;
  low = e - (hi - p);
  return hi;
}

/** Line y = intercept + slope·x over a window, with the sums the caller needs to judge it. */
export interface WindowLine {
  /** Points in the window. */
  n: number;
  slope: number;
  intercept: number;
  /** Sxy² / (Sxx·Syy) = 1 − SSR/SST; NaN when every y is equal (as `linearFit`). */
  rSquared: number;
  xMean: number;
  yMean: number;
  /** Sxx = Σ(x − x̄)², Syy = Σ(y − ȳ)² and Σy² over the window. */
  sxx: number;
  syy: number;
  sumYY: number;
}

const SUMS = 5; // x, y, x², xy, y²

export class WindowSums {
  /** Prefix sums: entry k·(n + 1) + i holds the sum of quantity k over the first i points. */
  private readonly hi: Float64Array;
  private readonly lo: Float64Array;
  private readonly stride: number;

  /** x and y must be finite and of equal length. */
  constructor(x: ArrayLike<number>, y: ArrayLike<number>) {
    const n = x.length;
    this.stride = n + 1;
    this.hi = new Float64Array(SUMS * this.stride);
    this.lo = new Float64Array(SUMS * this.stride);
    const termHi = new Float64Array(SUMS);
    const termLo = new Float64Array(SUMS);
    for (let i = 0; i < n; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      termHi[0] = xi;
      termHi[1] = yi;
      termHi[2] = mul(xi, 0, xi, 0);
      termLo[2] = low;
      termHi[3] = mul(xi, 0, yi, 0);
      termLo[3] = low;
      termHi[4] = mul(yi, 0, yi, 0);
      termLo[4] = low;
      for (let k = 0; k < SUMS; k++) {
        const at = k * this.stride + i;
        this.hi[at + 1] = add(
          this.hi[at] as number,
          this.lo[at] as number,
          termHi[k] as number,
          termLo[k] as number,
        );
        this.lo[at + 1] = low;
      }
    }
  }

  /** Sum of quantity k over the points start…end, high word (low word in `low`). */
  private sum(k: number, start: number, end: number): number {
    const a = k * this.stride + end + 1;
    const b = k * this.stride + start;
    return add(
      this.hi[a] as number,
      this.lo[a] as number,
      -(this.hi[b] as number),
      -(this.lo[b] as number),
    );
  }

  /** n·Σpq − Σp·Σq in double-double, from the sums (high, low) given; result as a double. */
  private static centred(
    n: number,
    pqH: number,
    pqL: number,
    pH: number,
    pL: number,
    qH: number,
    qL: number,
  ): number {
    const aH = mul(n, 0, pqH, pqL);
    const aL = low;
    const bH = mul(pH, pL, qH, qL);
    const bL = low;
    return add(aH, aL, -bH, -bL) + low;
  }

  /**
   * Least-squares line through the points start…end (inclusive):
   *   slope = Sxy / Sxx,   intercept = (Σy·Σx² − Σx·Σxy) / (n·Sxx),   R² = Sxy² / (Sxx·Syy),
   * with the centred sums n·Sxx = n·Σx² − (Σx)², n·Sxy = n·Σxy − Σx·Σy, n·Syy = n·Σy² − (Σy)², all
   * formed in double-double. Null when the window has fewer than two points or every x is equal.
   */
  line(start: number, end: number): WindowLine | null {
    const n = end - start + 1;
    if (n < 2) return null;
    const xH = this.sum(0, start, end);
    const xL = low;
    const yH = this.sum(1, start, end);
    const yL = low;
    const xxH = this.sum(2, start, end);
    const xxL = low;
    const xyH = this.sum(3, start, end);
    const xyL = low;
    const yyH = this.sum(4, start, end);
    const yyL = low;
    const cxx = WindowSums.centred(n, xxH, xxL, xH, xL, xH, xL);
    if (!(cxx > 0)) return null;
    const cxy = WindowSums.centred(n, xyH, xyL, xH, xL, yH, yL);
    const cyy = WindowSums.centred(n, yyH, yyL, yH, yL, yH, yL);
    // Σy·Σx² − Σx·Σxy, the numerator of the intercept.
    const pH = mul(yH, yL, xxH, xxL);
    const pL = low;
    const qH = mul(xH, xL, xyH, xyL);
    const qL = low;
    const numerator = add(pH, pL, -qH, -qL) + low;
    return {
      n,
      slope: cxy / cxx,
      intercept: numerator / cxx,
      rSquared: cyy > 0 ? (cxy / cxx) * (cxy / cyy) : NaN,
      xMean: (xH + xL) / n,
      yMean: (yH + yL) / n,
      sxx: cxx / n,
      syy: cyy / n,
      sumYY: yyH + yyL,
    };
  }
}

/** Smallest relative margin of `linearFitMargin`. */
const MARGIN_FLOOR = 1e-8;

/**
 * A relative margin larger than the rounding error of `linearFit` on the same window, so that a
 * comparison of a `line` value that clears this margin (times the scale of the value) is decided
 * the same way as with `linearFit`. `linearFit` sums n terms one after another (error up to about
 * n·ε of each sum) and then centres them on means that are κ = |x̄|/σx + |ȳ|/σy times larger than
 * the spread, so its slope and R² can be off by about n·ε·κ: on x ≈ 10⁴ with a spread of 3·10⁻⁴ its
 * R² was off by 2.8·10⁻⁷ (exact rational arithmetic, tests/uvvis-tauc-speed.test.ts). The margin is
 * 64·n·ε·κ, at least 10⁻⁸ (own choice, a wide factor over the errors seen); infinite when every y
 * is equal, so such a window is always decided with `linearFit`.
 */
export function linearFitMargin(line: WindowLine): number {
  const sx = Math.sqrt(line.sxx / line.n);
  const sy = Math.sqrt(line.syy / line.n);
  const kappa = Math.abs(line.xMean) / sx + Math.abs(line.yMean) / sy;
  return Math.max(MARGIN_FLOOR, 64 * line.n * Number.EPSILON * kappa);
}
