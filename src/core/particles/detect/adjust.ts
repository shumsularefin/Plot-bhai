import type { Rect } from '../geometry';
import { gaussianBlurExact, invertGray } from './image';
import { histogram } from './threshold';

/**
 * Image adjustments made before the threshold, in the order they are applied: background
 * subtraction, brightness and contrast (display range), histogram equalisation, sharpening.
 * They change only the image the particles are found on; sizes come from the outlines and grey
 * values are always read from the unadjusted image.
 */
export interface AdjustSettings {
  /** Subtract a smooth background: radius of the square window, in pixels of the working copy. */
  background: { enabled: boolean; radius: number };
  /** Grey levels at or below `min` become 0 and at or above `max` 255, linear in between; null leaves them. */
  range: { min: number; max: number } | null;
  equalize: boolean;
  /** Unsharp mask: Gaussian σ in pixels and the weight of the subtracted blur (0 to 0.9). */
  sharpen: { enabled: boolean; sigma: number; weight: number };
}

/** Starting values of my own choosing: nothing is changed; the radius and sharpening match ImageJ's defaults. */
export const DEFAULT_ADJUST: AdjustSettings = {
  background: { enabled: false, radius: 50 },
  range: null,
  equalize: false,
  sharpen: { enabled: false, sigma: 1, weight: 0.6 },
};

/**
 * Minimum (or maximum) over a sliding window of 2r + 1 values along one line of the image, with
 * the window cut at the image edge. A monotonic queue of candidate positions gives every output
 * in constant time on average, so the cost does not grow with r.
 */
function slide(
  src: ArrayLike<number>,
  dst: Uint8Array,
  start: number,
  stride: number,
  n: number,
  radius: number,
  max: boolean,
  queue: Int32Array,
): void {
  let head = 0;
  let tail = 0;
  const value = (i: number) => src[start + i * stride] as number;
  const better = (a: number, b: number) => (max ? a >= b : a <= b);
  let next = 0;
  for (let i = 0; i < n; i++) {
    // Bring every position up to i + r into the queue, dropping those it beats.
    for (; next <= Math.min(n - 1, i + radius); next++) {
      while (tail > head && better(value(next), value(queue[tail - 1] as number))) tail--;
      queue[tail++] = next;
    }
    while ((queue[head] as number) < i - radius) head++;
    dst[start + i * stride] = value(queue[head] as number);
  }
}

/** Grey-level erosion (max = false) or dilation (max = true) with a flat (2r + 1)² square window. */
function rankFilter(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
  max: boolean,
): Uint8Array {
  const rows = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  const queue = new Int32Array(Math.max(width, height));
  for (let y = 0; y < height; y++) slide(src, rows, y * width, 1, width, radius, max, queue);
  for (let x = 0; x < width; x++) slide(rows, out, x, width, height, radius, max, queue);
  return out;
}

/**
 * Background of an image with bright particles on a darker background: the grey-level opening
 * (erosion, then dilation) with a flat (2r + 1) × (2r + 1) square. It follows every part of the
 * background but cannot fit inside anything narrower than the window, so particles smaller
 * than the window are left out of it. This is the flat-element version of the rolling-ball
 * background (S. R. Sternberg, Computer 16 (1983) 22–34), which uses a ball instead of a square.
 */
export function estimateBackground(
  gray: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const r = Math.max(1, Math.round(radius));
  return rankFilter(rankFilter(gray, width, height, r, false), width, height, r, true);
}

/**
 * Subtracts the background: I − opening(I) (the white top-hat), which removes slow changes in
 * brightness such as uneven illumination and leaves particles smaller than the window. When
 * the particles are darker than the background (`darkParticles`) the image is inverted first and
 * inverted back afterwards, so the background becomes white instead of black.
 */
export function subtractBackground(
  gray: Uint8Array,
  width: number,
  height: number,
  radius: number,
  darkParticles: boolean,
): Uint8Array {
  const source = darkParticles ? invertGray(gray) : gray;
  const background = estimateBackground(source, width, height, radius);
  const out = source.map((v, i) => v - (background[i] as number));
  return darkParticles ? invertGray(out) : out;
}

/**
 * Linear brightness and contrast: g' = 255 · (g − min) / (max − min), limited to 0 to 255.
 * Levels at or below min become black and at or above max white.
 */
export function applyRange(gray: Uint8Array, min: number, max: number): Uint8Array {
  if (!(max > min)) return gray.slice();
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++)
    table[v] = Math.round(Math.min(255, Math.max(0, (255 * (v - min)) / (max - min))));
  return gray.map((v) => table[v] as number);
}

/**
 * Automatic display range, as ImageJ's "Enhance Contrast" chooses it: min and max are the grey
 * levels below and above which `saturated` percent of the pixels lie, half on each side (ImageJ's
 * default is 0.35 %). Returns null when the histogram is empty or has a single level.
 */
export function autoRange(hist: Int32Array, saturated = 0.35): { min: number; max: number } | null {
  let total = 0;
  for (let v = 0; v < 256; v++) total += hist[v] as number;
  if (total === 0) return null;
  const limit = (total * saturated) / 100 / 2;
  let min = 0;
  for (let count = 0; min < 255; min++) {
    count += hist[min] as number;
    if (count > limit) break;
  }
  let max = 255;
  for (let count = 0; max > 0; max--) {
    count += hist[max] as number;
    if (count > limit) break;
  }
  return max > min ? { min, max } : null;
}

/**
 * Histogram equalisation (R. C. Gonzalez and R. E. Woods, Digital Image Processing, histogram
 * processing chapter): each level v becomes 255 · (C(v) − C_min) / (N − C_min), rounded, where C
 * is the cumulative histogram of the pixels inside `area`, N their number and C_min the count of
 * the darkest level present. This is the classic form, not ImageJ's square-root variant.
 */
export function equalize(gray: Uint8Array, width: number, area?: Rect | null): Uint8Array {
  const hist = histogram(gray, width, area);
  const cumulative = new Float64Array(256);
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    sum += hist[v] as number;
    cumulative[v] = sum;
  }
  let first = 0;
  while (first < 255 && hist[first] === 0) first++;
  const cMin = cumulative[first] as number;
  if (sum - cMin <= 0) return gray.slice();
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++)
    table[v] = Math.round(
      Math.min(255, Math.max(0, (255 * ((cumulative[v] as number) - cMin)) / (sum - cMin))),
    );
  return gray.map((v) => table[v] as number);
}

/**
 * Unsharp mask, in the form ImageJ uses: g' = (g − w · G_σ(g)) / (1 − w), limited to 0 to 255,
 * where G_σ is a Gaussian blur of standard deviation σ pixels and w the mask weight (0 ≤ w < 1).
 * Edges get steeper; a larger w sharpens more and also amplifies noise.
 */
export function unsharpMask(
  gray: Uint8Array,
  width: number,
  height: number,
  sigma: number,
  weight: number,
): Uint8Array {
  if (!(sigma > 0) || !(weight > 0) || weight >= 1) return gray.slice();
  const blurred = gaussianBlurExact(gray, width, height, sigma);
  return gray.map((v, i) =>
    Math.round(Math.min(255, Math.max(0, (v - weight * (blurred[i] as number)) / (1 - weight)))),
  );
}

export interface Adjusted {
  image: Uint8Array;
  /**
   * Histogram (inside the analysis area) of the image after background subtraction and before
   * the display range: the one "Auto" brightness and contrast is chosen from.
   */
  rangeHistogram: Int32Array;
}

/** All adjustments in order. `darkParticles` decides which way the background is subtracted. */
export function adjustImage(
  gray: Uint8Array,
  width: number,
  height: number,
  settings: AdjustSettings,
  darkParticles: boolean,
  area?: Rect | null,
): Adjusted {
  let image = gray;
  if (settings.background.enabled)
    image = subtractBackground(image, width, height, settings.background.radius, darkParticles);
  const rangeHistogram = histogram(image, width, area);
  if (settings.range) image = applyRange(image, settings.range.min, settings.range.max);
  if (settings.equalize) image = equalize(image, width, area);
  if (settings.sharpen.enabled)
    image = unsharpMask(image, width, height, settings.sharpen.sigma, settings.sharpen.weight);
  return { image, rangeHistogram };
}
