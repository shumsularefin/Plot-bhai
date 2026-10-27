import { gaussianBlurExact } from './image';
import type { Labels } from './label';
import { distanceTransform } from './morphology';

/**
 * Typical particle diameter, in pixels, estimated from a binary mask: twice the median of the
 * local maxima of the distance transform (the radii of the largest circles that fit inside the
 * blobs at their centres). Maxima below 2 pixels are ignored as noise. Inside a large clump the
 * inscribed circles are wider than one particle, so the estimate is high when most particles sit
 * in clumps; drawing a line across a typical particle is then the better choice. Returns null
 * when no maximum was found.
 */
export function estimateDiameter(mask: Uint8Array, width: number, height: number): number | null {
  const dist = distanceTransform(mask, width, height);
  const radii: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const d = dist[i] as number;
      if (d >= 2 && isLocalMax(dist, width, i)) radii.push(d);
    }
  }
  if (radii.length === 0) return null;
  radii.sort((a, b) => a - b);
  return 2 * (radii[Math.floor(radii.length / 2)] as number);
}

/** True when no 8-neighbour of pixel i (not on the image edge) is larger. */
function isLocalMax(values: Float32Array, width: number, i: number): boolean {
  const v = values[i] as number;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((values[i + dy * width + dx] as number) > v) return false;
    }
  }
  return true;
}

/** Radii voted for, as fractions of the typical radius: particles may be 30 % smaller or larger. */
const RADIUS_RANGE = [0.7, 1.3] as const;

/**
 * Votes for circle centres (a circular Hough transform using the edge direction, as in
 * D. H. Ballard, Pattern Recognit. 13 (1981) 111–122). The image is first blurred with σ = r / 10,
 * at least 1 pixel. Every pixel then casts votes along its gradient, which points into the
 * brighter particle, at distances 0.7 r to 1.3 r, each vote weighted by the brightness change
 * per pixel (the Sobel magnitude / 8). The edges of one circle all vote for its centre, also when
 * part of its outline is hidden by a neighbour. The votes are smoothed with σ = r / 20, at least
 * 1 pixel.
 */
function voteCentres(image: Uint8Array, width: number, height: number, r: number): Float32Array {
  const g = gaussianBlurExact(image, width, height, Math.max(1, r / 10));
  const votes = new Float32Array(width * height);
  const from = Math.max(1, Math.round(RADIUS_RANGE[0] * r));
  const to = Math.max(from, Math.round(RADIUS_RANGE[1] * r));
  const v = (k: number) => g[k] as number;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const up = i - width;
      const down = i + width;
      const gx = v(up + 1) + 2 * v(i + 1) + v(down + 1) - v(up - 1) - 2 * v(i - 1) - v(down - 1);
      const gy = v(down - 1) + 2 * v(down) + v(down + 1) - v(up - 1) - 2 * v(up) - v(up + 1);
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 1e-3) continue;
      const ux = gx / magnitude;
      const uy = gy / magnitude;
      const weight = magnitude / 8;
      for (let rho = from; rho <= to; rho++) {
        const cx = Math.round(x + ux * rho);
        const cy = Math.round(y + uy * rho);
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) break;
        const c = cy * width + cx;
        votes[c] = (votes[c] as number) + weight;
      }
    }
  }
  return smooth(votes, width, height, Math.max(1, r / 20));
}

/** Gaussian smoothing of a float image (separable, kernel radius ⌈3σ⌉, edges repeated). */
function smooth(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const radius = Math.ceil(3 * sigma);
  const kernel: number[] = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const weights = kernel.map((w) => w / sum);
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
          acc += (weights[k + radius] as number) * (input[yy * width + xx] as number);
        }
        out[y * width + x] = acc;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/**
 * The votes the centre of one whole, isolated particle of radius r gets at a contrast of 255
 * grey levels: the same voting on a drawn disc. Votes grow in proportion to the contrast, so the
 * votes a centre gets, divided by this scaled to the image's contrast, are the share of a whole,
 * clear outline that was found.
 */
function fullOutlineVotes(r: number): number {
  const half = Math.ceil(2 * r) + 4;
  const size = 2 * half + 1;
  const disc = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - half, y - half) <= r) disc[y * size + x] = 255;
    }
  }
  return voteCentres(disc, size, size, r)[half * size + half] as number;
}

/** The median of the grey levels of the pixels where `inMask` says so (NaN when none). */
function medianWhere(image: Uint8Array, mask: Uint8Array, inMask: boolean): number {
  const hist = new Int32Array(256);
  let total = 0;
  for (let i = 0; i < image.length; i++) {
    if ((mask[i] === 1) !== inMask) continue;
    hist[image[i] as number] = (hist[image[i] as number] as number) + 1;
    total++;
  }
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v] as number;
    if (seen > total / 2) return v;
  }
  return Number.NaN;
}

/**
 * Separates particles in clumps (agglomerates, where particles touch or overlap) when their
 * typical diameter d is known. Overlapping particles hide only part of each other's outlines,
 * so the visible arcs are used:
 *
 * 1. Centres: edges vote for the centres of circles of radius 0.7 r to 1.3 r (r = d / 2), see
 *    voteCentres. Local maxima of the votes inside the mask become centres, strongest first,
 *    skipping any closer than 0.6 d to one already taken (one particle cannot hold two). A centre
 *    is kept when its votes reach `minOutline` (0 to 1) of what a whole, clear outline would give
 *    at the image's contrast (the median grey level of the mask minus that of the background).
 * 2. Areas: each centre grows through the mask, every pixel joining the nearest centre that
 *    reaches it without leaving the mask. For two equal circles this cuts their overlap along
 *    the chord between the crossing points of the outlines. Mask pieces no centre reaches become
 *    particles of their own.
 *
 * `image` must show the particles brighter than the background (inverted if needed). Returns one
 * label per pixel (0 for background) and the count.
 */
export function splitClusters(
  mask: Uint8Array,
  image: Uint8Array,
  width: number,
  height: number,
  diameter: number,
  minOutline: number,
): Labels {
  const r = Math.max(1, diameter / 2);
  const votes = voteCentres(image, width, height, r);
  const contrast = medianWhere(image, mask, true) - medianWhere(image, mask, false);
  const needed = minOutline * fullOutlineVotes(r) * (contrast > 0 ? contrast / 255 : 1);

  const candidates: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = votes[i] as number;
      if (mask[i] && value > 0 && value >= needed && isLocalMax(votes, width, i))
        candidates.push(i);
    }
  }
  candidates.sort((a, b) => (votes[b] as number) - (votes[a] as number));
  const centres: { x: number; y: number }[] = [];
  const gap = 0.6 * diameter;
  // Centres taken so far, by grid cell of the gap's size: only the 3 × 3 cells around a
  // candidate can hold one that is too close.
  const cell = Math.max(1, gap);
  const columns = Math.ceil(width / cell);
  const grid = new Map<number, { x: number; y: number }[]>();
  for (const i of candidates) {
    const x = i % width;
    const y = (i - x) / width;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let free = true;
    for (let dy = -1; dy <= 1 && free; dy++) {
      for (let dx = -1; dx <= 1 && free; dx++) {
        for (const c of grid.get((cy + dy) * columns + cx + dx) ?? []) {
          if ((c.x - x) ** 2 + (c.y - y) ** 2 < gap * gap) free = false;
        }
      }
    }
    if (!free) continue;
    const centre = { x, y };
    centres.push(centre);
    const key = cy * columns + cx;
    grid.set(key, [...(grid.get(key) ?? []), centre]);
  }
  return growFromCentres(mask, centres, width, height);
}

/** Steps per pixel of the queue that orders the flood by distance: distances are kept to 1/4 px. */
const QUEUE_STEPS = 4;

/**
 * Grows labelled regions from the centres through the mask (8-connected) by a priority flood: the
 * pixel closest to the centre that reaches it is always labelled next (distances rounded to
 * 1/4 pixel), so every pixel joins the nearest centre among those that reach it through the mask
 * (a geodesic Voronoi partition). Unreached mask pieces get labels of their own, one per
 * connected piece.
 */
function growFromCentres(
  mask: Uint8Array,
  centres: readonly { x: number; y: number }[],
  width: number,
  height: number,
): Labels {
  const n = width * height;
  const labels = new Int32Array(n);
  // Bucket queue: buckets[k] holds pixel and label pairs offered at distance k / QUEUE_STEPS.
  const buckets: number[][] = [];
  // The smallest distance step offered to each pixel so far: a farther offer is not queued.
  const best = new Int32Array(n).fill(0x7fffffff);
  const offer = (i: number, label: number, step: number) => {
    if (step >= (best[i] as number)) return;
    best[i] = step;
    (buckets[step] ??= []).push(i, label);
  };
  centres.forEach((c, k) => offer(c.y * width + c.x, k + 1, 0));
  for (let step = 0; step < buckets.length; step++) {
    const bucket = buckets[step];
    if (!bucket) continue;
    for (let q = 0; q < bucket.length; q += 2) {
      const i = bucket[q] as number;
      if (labels[i]) continue;
      const label = bucket[q + 1] as number;
      labels[i] = label;
      const c = centres[label - 1] as { x: number; y: number };
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (!mask[j] || labels[j]) continue;
          // Never earlier than the current step, so the flood does not go back.
          const d = Math.round(Math.hypot(xx - c.x, yy - c.y) * QUEUE_STEPS);
          offer(j, label, Math.max(step, d));
        }
      }
    }
    buckets[step] = [];
  }

  let count = centres.length;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i]) continue;
    count++;
    labels[i] = count;
    const stack = [i];
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const j = yy * width + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = count;
            stack.push(j);
          }
        }
      }
    }
  }
  return { labels, count };
}
