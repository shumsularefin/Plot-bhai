import type { Rect } from '../geometry';

/** Histogram of the pixels inside `area` (the whole image when omitted). */
export function histogram(gray: Uint8Array, width: number, area?: Rect | null): Int32Array {
  const hist = new Int32Array(256);
  const rect = area ?? { x: 0, y: 0, width, height: gray.length / width };
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(gray.length / width, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = gray[y * width + x] as number;
      hist[v] = (hist[v] as number) + 1;
    }
  }
  return hist;
}

/**
 * Otsu's threshold (N. Otsu, IEEE Trans. Syst. Man Cybern. 9 (1979) 62–66): the grey level t that
 * maximises the between-class variance σ_b² = ω0 ω1 (μ0 − μ1)² of the dark class (values ≤ t)
 * and the bright class (values > t). Returns the first t reaching the maximum. Pixels with a value
 * above the returned threshold are foreground. With one grey level only, returns that level.
 */
export function otsuThreshold(hist: Int32Array): number {
  let total = 0;
  let weighted = 0;
  for (let v = 0; v < 256; v++) {
    total += hist[v] as number;
    weighted += v * (hist[v] as number);
  }
  let w0 = 0;
  let sum0 = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    w0 += hist[t] as number;
    if (w0 === 0) continue;
    const w1 = total - w0;
    if (w1 === 0) break;
    sum0 += t * (hist[t] as number);
    const mu0 = sum0 / w0;
    const mu1 = (weighted - sum0) / w1;
    const variance = w0 * w1 * (mu0 - mu1) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/** 1 where the pixel is brighter than the threshold, else 0. */
export function applyThreshold(gray: Uint8Array, threshold: number): Uint8Array {
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) mask[i] = (gray[i] as number) > threshold ? 1 : 0;
  return mask;
}

/**
 * Local mean over a (2r + 1) square window (edge pixels use the part of the window that lies in
 * the image), by running sums along rows and then columns.
 */
export function boxMean(
  gray: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) {
      sum += gray[row + x] as number;
      count++;
    }
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / count;
      const add = x + radius + 1;
      const drop = x - radius;
      if (add < width) {
        sum += gray[row + add] as number;
        count++;
      }
      if (drop >= 0) {
        sum -= gray[row + drop] as number;
        count--;
      }
    }
  }
  const out = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) {
      sum += horizontal[y * width + x] as number;
      count++;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / count;
      const add = y + radius + 1;
      const drop = y - radius;
      if (add < height) {
        sum += horizontal[add * width + x] as number;
        count++;
      }
      if (drop >= 0) {
        sum -= horizontal[drop * width + x] as number;
        count--;
      }
    }
  }
  return out;
}

/**
 * Adaptive (local) threshold: a pixel is foreground when it is brighter than the mean of its
 * (2r + 1) square neighbourhood plus `offset` grey levels. It copes with an uneven background.
 * Choose r larger than the particles.
 */
export function adaptiveThreshold(
  gray: Uint8Array,
  width: number,
  height: number,
  radius: number,
  offset: number,
): Uint8Array {
  const mean = boxMean(gray, width, height, radius);
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    mask[i] = (gray[i] as number) > (mean[i] as number) + offset ? 1 : 0;
  }
  return mask;
}
