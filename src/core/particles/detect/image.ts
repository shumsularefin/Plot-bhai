/** Grayscale image helpers. Images are row-major Uint8Array with one byte per pixel. */

/**
 * Luminance from red, green and blue: Y = 0.299 R + 0.587 G + 0.114 B (the ITU-R BT.601
 * weights, as used for grayscale conversion in common imaging libraries), rounded to 0 to 255.
 * `rgba` holds four bytes per pixel; alpha is ignored.
 */
export function rgbaToGray(rgba: ArrayLike<number>, pixels: number): Uint8Array {
  const gray = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    gray[i] = Math.round(
      0.299 * (rgba[4 * i] as number) +
        0.587 * (rgba[4 * i + 1] as number) +
        0.114 * (rgba[4 * i + 2] as number),
    );
  }
  return gray;
}

/** 255 − value for every pixel: particles that are darker than the background become brighter. */
export function invertGray(gray: Uint8Array): Uint8Array {
  return gray.map((v) => 255 - v);
}

/**
 * Gaussian blur with standard deviation `sigma` pixels, separable, kernel radius ⌈3σ⌉ (weights
 * proportional to exp(−x² / 2σ²), summing to 1). Pixels beyond the edge repeat the edge value.
 */
export function gaussianBlur(
  src: Uint8Array,
  width: number,
  height: number,
  sigma: number,
): Uint8Array {
  if (!(sigma > 0)) return src.slice();
  return Uint8Array.from(gaussianBlurExact(src, width, height, sigma), (v) => Math.round(v));
}

/** gaussianBlur without rounding: fractional grey levels, so smooth slopes have no flat steps. */
export function gaussianBlurExact(
  src: Uint8Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  if (!(sigma > 0)) return Float32Array.from(src);
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = (kernel[i] as number) / sum;

  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += (kernel[k + radius] as number) * (src[row + xx] as number);
      }
      tmp[row + x] = acc;
    }
  }
  const out = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += (kernel[k + radius] as number) * (tmp[yy * width + x] as number);
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/** hist[value] += by (typed-array element access is checked, so this keeps the loops readable). */
function bump(hist: Int32Array, value: number, by: number): void {
  hist[value] = (hist[value] as number) + by;
}

/**
 * Median filter over a (2r + 1) × (2r + 1) window; pixels beyond the edge repeat the edge value.
 * It removes isolated noise (salt and pepper) while keeping edges sharp. Uses a sliding
 * histogram along each row, so the cost grows with r, not with the window area.
 */
export function medianFilter(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius < 1) return src.slice();
  const out = new Uint8Array(width * height);
  const half = ((2 * radius + 1) ** 2 - 1) / 2; // median is the value with `half` pixels below or equal before it
  const clampX = (x: number) => Math.min(width - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(height - 1, Math.max(0, y));
  const hist = new Int32Array(256);
  for (let y = 0; y < height; y++) {
    hist.fill(0);
    for (let dy = -radius; dy <= radius; dy++) {
      const row = clampY(y + dy) * width;
      for (let dx = -radius; dx <= radius; dx++) bump(hist, src[row + clampX(dx)] as number, 1);
    }
    let median = 0;
    let below = 0; // pixels in the window with value < median
    // Find the first median for this row.
    let cumulative = 0;
    for (let v = 0; v < 256; v++) {
      if (cumulative + (hist[v] as number) > half) {
        median = v;
        below = cumulative;
        break;
      }
      cumulative += hist[v] as number;
    }
    out[y * width] = median;
    for (let x = 1; x < width; x++) {
      const leaving = clampX(x - 1 - radius);
      const entering = clampX(x + radius);
      for (let dy = -radius; dy <= radius; dy++) {
        const row = clampY(y + dy) * width;
        const outV = src[row + leaving] as number;
        const inV = src[row + entering] as number;
        bump(hist, outV, -1);
        bump(hist, inV, 1);
        if (outV < median) below--;
        if (inV < median) below++;
      }
      while (below > half) {
        median--;
        below -= hist[median] as number;
      }
      while (below + (hist[median] as number) <= half) {
        below += hist[median] as number;
        median++;
      }
      out[y * width + x] = median;
    }
  }
  return out;
}
