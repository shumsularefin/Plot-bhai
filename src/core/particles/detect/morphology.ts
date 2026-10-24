/** Binary images are row-major Uint8Array with 1 for foreground (particle) and 0 for background. */

const INF = 1e20;

/** One-dimensional squared distance transform of f (Felzenszwalb and Huttenlocher, 2012). */
function transform1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k] as number;
      s = ((f[q] as number) + q * q - ((f[p] as number) + p * p)) / (2 * q - 2 * p);
      if (s <= (z[k] as number) && k > 0) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const p = v[k] as number;
    d[q] = (q - p) ** 2 + (f[p] as number);
  }
}

/**
 * Exact Euclidean distance transform: for every foreground pixel the distance, in pixels, from
 * its centre to the centre of the nearest background pixel; 0 for background pixels. Computed
 * as two passes of a one-dimensional transform (columns, then rows). The image edge is not
 * treated as background, so a particle cut by the edge is not eroded there. An image without any
 * background gives the largest possible value, width + height.
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < mask.length; i++) grid[i] = mask[i] ? INF : 0;
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x] as number;
    transform1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y] as number;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x] as number;
    transform1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x] as number;
  }
  const out = new Float32Array(width * height);
  // With no background pixel at all the distance is meaningless; cap it so later steps stay bounded.
  const cap = width + height;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(Math.sqrt(grid[i] as number), cap);
  return out;
}

/** Erosion by a disc of the given radius: keeps pixels whose nearest background pixel is farther than `radius`. */
export function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const dist = distanceTransform(mask, width, height);
  return mask.map((_, i) => ((dist[i] as number) > radius ? 1 : 0));
}

/** Dilation by a disc of the given radius: adds pixels within `radius` of a foreground pixel. */
export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask.slice();
  const inverse = mask.map((v) => (v ? 0 : 1));
  const dist = distanceTransform(inverse, width, height);
  return mask.map((v, i) => (v || (dist[i] as number) <= radius ? 1 : 0));
}

/** Opening (erosion then dilation): removes specks smaller than the disc and thin bridges between particles. */
export function open(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return radius <= 0
    ? mask.slice()
    : dilate(erode(mask, width, height, radius), width, height, radius);
}

/** Closing (dilation then erosion): fills small gaps and dents smaller than the disc. */
export function close(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return radius <= 0
    ? mask.slice()
    : erode(dilate(mask, width, height, radius), width, height, radius);
}

/**
 * Fills holes: background pixels that cannot be reached from the image edge through background
 * pixels (4-connected, so that diagonal gaps in a ring still count as closed) become foreground.
 */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  const push = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const i = stack[--top] as number;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < width * (height - 1)) push(i + width);
  }
  return mask.map((v, i) => (v || !outside[i] ? 1 : 0));
}
