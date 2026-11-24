/*
 * Further statistics of a size distribution (sub-stage 19f): the standard error and confidence
 * interval of the mean, the coefficient of variation, moment-ratio mean diameters, volume-weighted
 * percentiles and the Anderson–Darling goodness of fit. Inputs are sorted, cleaned diameters
 * (`cleanSizes` in ./distribution) in one unit; outputs are in that unit unless stated.
 */
import { lnGamma } from '../math/gamma';

/** Composite Simpson's rule of f on [a, b] with `intervals` (even) sub-intervals. */
function simpson(f: (x: number) => number, a: number, b: number, intervals: number): number {
  const h = (b - a) / intervals;
  let sum = f(a) + f(b);
  for (let i = 1; i < intervals; i++) sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

/**
 * Upper tail of the standard normal distribution, Q(z) = 1 − Φ(z) = ∫_z^∞ φ(x) dx with
 * φ(x) = exp(−x²/2)/√(2π), for z ≥ 0, by Simpson's rule over [z, z + L]. L shrinks as z grows
 * (L = 10 up to z = 3, then 30/z) because φ falls off over about 1/z; the part beyond z + L is
 * below 1e-20 of Q(z). Relative error below 1e-9 (checked against SciPy in the tests).
 */
/** Complementary error function erfc(x) for x >= 0 (Cody 1969 rational Chebyshev, rel err < 1e-15). */
function erfcPos(x: number): number {
  if (x < 0.46875) {
    const a = [
      3.16112374387057, 113.86415415105, 377.485237685302, 3209.37758913847, 0.185777706184603,
    ];
    const b = [23.6012909523441, 244.024637934444, 1282.61652607737, 2844.23683343917];
    const y = x * x;
    let num = a[4] as number;
    let den = 1;
    for (let i = 0; i < 4; i++) {
      num = num * y + (a[i] as number);
      den = den * y + (b[i] as number);
    }
    return 1 - (x * num) / den;
  }
  if (x <= 4) {
    const c = [
      0.56418849698867, 8.88314979438838, 66.1191906371416, 298.6351381974, 881.952221241769,
      1712.04761263407, 2051.07837782607, 1230.339354798, 2.15311535474404e-8,
    ];
    const d = [
      15.7449261107098, 117.693950891312, 537.18110186201, 1621.38957456669, 3290.79923573346,
      4362.61909014325, 3439.36767414372, 1230.33935480375,
    ];
    let num = c[8] as number;
    let den = 1;
    for (let i = 0; i < 8; i++) {
      num = num * x + (c[i] as number);
      den = den * x + (d[i] as number);
    }
    return (Math.exp(-x * x) * num) / den;
  }
  const p = [
    0.305326634961232, 0.360344899949804, 0.125781726111229, 0.0160837851487423,
    0.000658749161529838, 0.0163153871373021,
  ];
  const q = [
    2.56852019228982, 1.87295284992346, 0.527905102951428, 0.0605183413124413, 0.00233520497626869,
  ];
  const y = 1 / (x * x);
  let num = p[5] as number;
  let den = 1;
  for (let i = 0; i < 5; i++) {
    num = num * y + (p[i] as number);
    den = den * y + (q[i] as number);
  }
  return (Math.exp(-x * x) * (1 / Math.sqrt(Math.PI) - (y * num) / den)) / x;
}

function upperNormalTail(z: number): number {
  return 0.5 * erfcPos(z / Math.SQRT2);
}

/**
 * ln Φ(z) and ln(1 − Φ(z)) of the standard normal distribution, each computed from the tail on
 * its own side so that neither loses precision far from the centre (needed by Anderson–Darling).
 */
export function logNormalCdfs(z: number): { logCdf: number; logSf: number } {
  const zz = Math.max(-37, Math.min(37, z));
  const tail = upperNormalTail(Math.abs(zz));
  return zz >= 0
    ? { logCdf: Math.log1p(-tail), logSf: Math.log(tail) }
    : { logCdf: Math.log(tail), logSf: Math.log1p(-tail) };
}

/**
 * Quantile t(p, ν) of Student's t distribution, p in (0.5, 1), ν > 0 degrees of freedom.
 * Density (NIST/SEMATECH e-Handbook of Statistical Methods, §1.3.6.6.4):
 *   f(x) = (1 + x²/ν)^(−(ν+1)/2) / (B(½, ν/2) √ν),  B(a, b) = Γ(a)Γ(b)/Γ(a + b).
 * The distribution is symmetric, so P(T ≤ t) = ½ + ∫₀ᵗ f(x) dx; the integral is taken by Simpson's
 * rule and t found by Newton's method. Checked against the NIST table of critical values (§1.3.6.7.2:
 * 12.706 for ν = 1, 1.984 for ν = 100 at p = 0.975) and SciPy in the tests.
 */
export function studentTQuantile(p: number, nu: number): number {
  if (!(p > 0.5 && p < 1) || !(nu > 0)) return NaN;
  const logB = lnGamma(0.5) + lnGamma(nu / 2) - lnGamma(0.5 + nu / 2);
  const scale = Math.exp(-logB) / Math.sqrt(nu);
  const density = (x: number) => scale * Math.pow(1 + (x * x) / nu, -(nu + 1) / 2);
  const target = p - 0.5;
  const excess = (t: number) => simpson(density, 0, t, 4000) - target;
  // Newton's method: the derivative of P(T ≤ t) is f(t). Starts at 2 and stays above 0.
  let t = 2;
  for (let i = 0; i < 100; i++) {
    const step = excess(t) / density(t);
    const next = t - step > 0 ? t - step : t / 2;
    if (Math.abs(next - t) <= 1e-12 * next) return next;
    t = next;
  }
  return NaN;
}

export interface MeanInterval {
  /** Standard error of the mean, SEM = s/√n with s the sample SD (divisor n − 1). */
  sem: number;
  /** Confidence level as a fraction, for example 0.95. */
  level: number;
  /** Student t quantile used, t(1 − α/2, n − 1). */
  t: number;
  lower: number;
  upper: number;
}

/**
 * Confidence interval of the mean (NIST/SEMATECH e-Handbook of Statistical Methods, §1.3.5.2):
 *   Ȳ ± t(1 − α/2, N − 1) · s/√N,
 * with Ȳ the mean, s the sample standard deviation (divisor N − 1) and N the count. It assumes
 * the particles are a random sample; it says how well the mean is known, not how wide the
 * distribution is. Takes the summary numbers, so a published example can be checked directly.
 * Needs n ≥ 2 and a finite s; null otherwise.
 */
export function meanConfidenceInterval(
  mean: number,
  sd: number,
  n: number,
  level = 0.95,
): MeanInterval | null {
  if (!(n >= 2) || !Number.isFinite(sd) || !Number.isFinite(mean)) return null;
  const sem = sd / Math.sqrt(n);
  const t = studentTQuantile(1 - (1 - level) / 2, n - 1);
  return { sem, level, t, lower: mean - t * sem, upper: mean + t * sem };
}

/**
 * Coefficient of variation, CV = s / x̄ (sample standard deviation over the mean, NIST SP 960-1,
 * glossary), as a fraction; multiply by 100 for percent. NaN with fewer than two values.
 */
export const coefficientOfVariation = (sd: number, mean: number): number =>
  mean > 0 && Number.isFinite(sd) ? sd / mean : NaN;

export interface MomentMeans {
  /** D[1,0] = Σd / n, the number-weighted (arithmetic) mean. */
  d10: number;
  /** D[3,2] = Σd³ / Σd², the surface-weighted (Sauter) mean. */
  d32: number;
  /** D[4,3] = Σd⁴ / Σd³, the volume-weighted (De Brouckere) mean. */
  d43: number;
}

/**
 * Moment-ratio mean diameters from individual particle diameters d. A. Virden, "D[3,2] vs.
 * D[4,3]: which parameter should you choose to report particle size?" (Malvern Panalytical,
 * 7 May 2026) writes them from volumes V_i in size classes d_i:
 *   D[3,2] = ΣV_i / Σ(V_i/d_i),  D[4,3] = ΣV_i d_i / ΣV_i.
 * For spheres V_i ∝ d_i³, which gives Σd³/Σd² and Σd⁴/Σd³ here, one term per particle. The
 * volume and surface weighting assume each particle is a sphere of its measured diameter.
 */
export function momentMeans(sorted: ArrayLike<number>): MomentMeans | null {
  const n = sorted.length;
  if (n === 0) return null;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  for (let i = 0; i < n; i++) {
    const d = sorted[i] as number;
    const d2 = d * d;
    s1 += d;
    s2 += d2;
    s3 += d2 * d;
    s4 += d2 * d2;
  }
  return { d10: s1 / n, d32: s3 / s2, d43: s4 / s3 };
}

export interface VolumePercentiles {
  /** 10 %, 50 % and 90 % of the total particle volume is in particles no larger than these. */
  dv10: number;
  dv50: number;
  dv90: number;
  /** (Dv90 − Dv10) / Dv50. */
  span: number;
}

/**
 * Volume-weighted percentiles, treating each particle as a sphere of its measured diameter d, so
 * its weight is d³ (the factor π/6 cancels). Dv(p) is the smallest diameter at which the
 * cumulative volume share reaches p: with the sorted d_i and C_i = Σ_{j ≤ i} d_j³ / Σ d_j³,
 * Dv(p) = d_k for the first k with C_k ≥ p. This is the "inverted CDF" percentile, the only
 * weighted method of numpy.percentile (NumPy 2), which the validation uses as the reference.
 * No interpolation: a few large particles hold most of the volume, so Dv values jump between
 * measured sizes and are only as reliable as the count of large particles.
 */
export function volumePercentiles(sorted: ArrayLike<number>): VolumePercentiles | null {
  const n = sorted.length;
  if (n === 0) return null;
  const cumulative = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += (sorted[i] as number) ** 3;
    cumulative[i] = total;
  }
  const at = (p: number) => {
    for (let i = 0; i < n; i++)
      if ((cumulative[i] as number) / total >= p) return sorted[i] as number;
    return sorted[n - 1] as number;
  };
  const dv10 = at(0.1);
  const dv50 = at(0.5);
  const dv90 = at(0.9);
  return { dv10, dv50, dv90, span: (dv90 - dv10) / dv50 };
}

/** Upper 5 % point of A² for a normal sample with mean and SD estimated (Stephens 1974). */
const AD_NORMAL_5_PERCENT = 0.752;

export interface AndersonDarling {
  /** The statistic A². */
  a2: number;
  /** 5 % critical value adjusted for the count, 0.752 / (1 + 0.75/N + 2.25/N²). */
  critical5: number;
  /** A² is above the 5 % critical value: the data are unlikely to come from this distribution. */
  rejected: boolean;
}

/**
 * Anderson–Darling statistic for a normal distribution whose mean and standard deviation are
 * estimated from the same data (NIST/SEMATECH e-Handbook of Statistical Methods, §1.3.5.14):
 *   A² = −N − Σ_{i=1..N} (2i − 1)/N · [ln F(Y_i) + ln(1 − F(Y_{N+1−i}))],
 * Y sorted, F the normal CDF with mean x̄ and SD s (divisor N − 1). The 5 % critical value for
 * this case is 0.752 (the same section), divided by (1 + 0.75/N + 2.25/N²) for the count as in
 * M. A. Stephens, J. Am. Stat. Assoc. 69 (1974) 730–737 and scipy.stats.anderson. NIST prefers it
 * to the Kolmogorov–Smirnov test, whose critical values are not valid once the parameters are
 * estimated from the data. For a lognormal fit pass ln(d). Needs two or more different values.
 */
export function andersonDarlingNormal(values: ArrayLike<number>): AndersonDarling | null {
  const n = values.length;
  if (n < 2) return null;
  const y = Float64Array.from(values).sort();
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(y.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (!(sd > 0)) return null;
  const logs = Array.from(y, (v) => logNormalCdfs((v - mean) / sd));
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    const low = logs[i - 1] as { logCdf: number };
    const high = logs[n - i] as { logSf: number };
    sum += ((2 * i - 1) / n) * (low.logCdf + high.logSf);
  }
  const a2 = -n - sum;
  const critical5 = AD_NORMAL_5_PERCENT / (1 + 0.75 / n + 2.25 / (n * n));
  return { a2, critical5, rejected: a2 > critical5 };
}

/** Everything above for one set of sizes, as shown in the results and written in the methods text. */
export interface SizeStatistics {
  interval: MeanInterval | null;
  cv: number;
  moments: MomentMeans;
  volume: VolumePercentiles;
  /** Anderson–Darling for the normal fit (on the sizes) and the lognormal fit (on ln of the sizes). */
  adNormal: AndersonDarling | null;
  adLognormal: AndersonDarling | null;
}

/** All further statistics of sorted, cleaned sizes with their mean and sample SD; null when empty. */
export function sizeStatistics(
  sorted: Float64Array,
  mean: number,
  sd: number,
): SizeStatistics | null {
  const moments = momentMeans(sorted);
  const volume = volumePercentiles(sorted);
  if (!moments || !volume) return null;
  return {
    interval: meanConfidenceInterval(mean, sd, sorted.length),
    cv: coefficientOfVariation(sd, mean),
    moments,
    volume,
    adNormal: andersonDarlingNormal(sorted),
    adLognormal: andersonDarlingNormal(Array.from(sorted, Math.log)),
  };
}
