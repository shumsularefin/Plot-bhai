import type { Point } from '../geometry';
import type { Runs } from './regions';

/**
 * Extra measurements of a particle, the ones ImageJ offers under Analyze › Set Measurements that
 * the shape (regions.ts) does not already give. Lengths are in pixels of the grid the runs live
 * on; grey levels are 0 to 255.
 */

export interface EllipseFit {
  /** Full lengths of the major and minor axes, px. */
  major: number;
  minor: number;
  /** Direction of the major axis, degrees from 0 up to 180, counter-clockwise from +x with y up. */
  angle: number;
}

/**
 * The ellipse with the same second moments as the particle, scaled so that its area π·a·b/4
 * equals the particle's pixel count, as ImageJ's "Fit ellipse" does. Each pixel is a unit
 * square, so it adds 1/12 to the variance in x and y. With λ1 ≥ λ2 the eigenvalues of the
 * covariance matrix [[σxx, σxy], [σxy, σyy]], an ellipse of axes A and B has λ = A²/16 and B²/16,
 * so A = 4√λ1 and B = 4√λ2 before the area scaling.
 */
export function fitEllipse(runs: Runs): EllipseFit {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < runs.length; i += 3) {
    const y = (runs[i] as number) + 0.5;
    const x0 = runs[i + 1] as number;
    const x1 = runs[i + 2] as number;
    const count = x1 - x0;
    n += count;
    sx += ((x0 + x1) / 2) * count;
    sy += y * count;
  }
  if (n === 0) return { major: 0, minor: 0, angle: 0 };
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < runs.length; i += 3) {
    const dy = (runs[i] as number) + 0.5 - cy;
    for (let x = runs[i + 1] as number; x < (runs[i + 2] as number); x++) {
      const dx = x + 0.5 - cx;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
  }
  xx = xx / n + 1 / 12;
  yy = yy / n + 1 / 12;
  xy /= n;
  const mean = (xx + yy) / 2;
  const spread = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  const l1 = mean + spread;
  const l2 = Math.max(0, mean - spread);
  let major = 4 * Math.sqrt(l1);
  let minor = 4 * Math.sqrt(l2);
  const scale = Math.sqrt((4 * n) / (Math.PI * major * minor));
  if (Number.isFinite(scale)) {
    major *= scale;
    minor *= scale;
  }
  // Major axis direction in image coordinates (y down), then flipped to y up.
  const theta = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
  const angle = ((-theta % 180) + 180) % 180;
  return { major, minor, angle: angle === 180 ? 0 : angle };
}

export interface GreyStats {
  count: number;
  mean: number;
  /** Sample standard deviation (divides by n − 1), as ImageJ reports it. */
  sd: number;
  min: number;
  max: number;
  /** The middle level; for an even count the upper of the two middle levels, as ImageJ gives for 8-bit images. */
  median: number;
  /** The most frequent level (the darkest one on a tie). */
  mode: number;
  /** Sum of the grey levels (ImageJ's RawIntDen). */
  sum: number;
  /** Skewness from the population moments: E[(g − μ)³] / σ_p³, with σ_p² = E[(g − μ)²]. */
  skewness: number;
  /** Excess kurtosis from the population moments: E[(g − μ)⁴] / σ_p⁴ − 3 (0 for a normal distribution). */
  kurtosis: number;
}

/** Grey-level statistics of the pixels of a particle, read from `gray` (row-major, `width` wide). */
export function greyStats(runs: Runs, gray: Uint8Array, width: number): GreyStats {
  const hist = new Float64Array(256);
  let count = 0;
  for (let i = 0; i < runs.length; i += 3) {
    const row = (runs[i] as number) * width;
    for (let x = runs[i + 1] as number; x < (runs[i + 2] as number); x++) {
      const v = gray[row + x] as number;
      hist[v] = (hist[v] as number) + 1;
      count++;
    }
  }
  if (count === 0) {
    const none = Number.NaN;
    return {
      count,
      mean: none,
      sd: none,
      min: none,
      max: none,
      median: none,
      mode: none,
      sum: 0,
      skewness: none,
      kurtosis: none,
    };
  }
  let sum = 0;
  let min = 255;
  let max = 0;
  let mode = 0;
  for (let v = 0; v < 256; v++) {
    const h = hist[v] as number;
    if (h === 0) continue;
    sum += v * h;
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (h > (hist[mode] as number)) mode = v;
  }
  const mean = sum / count;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let v = min; v <= max; v++) {
    const h = hist[v] as number;
    const d = v - mean;
    m2 += h * d * d;
    m3 += h * d * d * d;
    m4 += h * d * d * d * d;
  }
  m2 /= count;
  m3 /= count;
  m4 /= count;
  let median = min;
  for (let seen = 0, v = 0; v < 256; v++) {
    seen += hist[v] as number;
    if (seen >= (count + 1) / 2) {
      median = v;
      break;
    }
  }
  return {
    count,
    mean,
    sd: count > 1 ? Math.sqrt((m2 * count) / (count - 1)) : 0,
    min,
    max,
    median,
    mode,
    sum,
    skewness: m2 > 0 ? m3 / m2 ** 1.5 : Number.NaN,
    kurtosis: m2 > 0 ? m4 / (m2 * m2) - 3 : Number.NaN,
  };
}

export interface Profile {
  /** Distance from the start of the line, px. */
  distance: Float64Array;
  /** Grey level, interpolated. */
  value: Float64Array;
}

/**
 * Grey levels along the straight line from a to b (ImageJ's Plot Profile), coordinates in pixels
 * of `gray` with pixel centres at half-integers. Samples are one pixel apart (the last one at b),
 * and each is interpolated bilinearly from the four nearest pixel centres; outside the image the
 * edge pixels are repeated.
 */
export function lineProfile(
  gray: Uint8Array,
  width: number,
  height: number,
  a: Point,
  b: Point,
): Profile {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(length) + 1);
  const distance = new Float64Array(n);
  const value = new Float64Array(n);
  const pixel = (x: number, y: number) =>
    gray[
      Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))
    ] as number;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = a.x + t * (b.x - a.x) - 0.5;
    const y = a.y + t * (b.y - a.y) - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    distance[i] = t * length;
    value[i] =
      (1 - fy) * ((1 - fx) * pixel(x0, y0) + fx * pixel(x0 + 1, y0)) +
      fy * ((1 - fx) * pixel(x0, y0 + 1) + fx * pixel(x0 + 1, y0 + 1));
  }
  return { distance, value };
}
