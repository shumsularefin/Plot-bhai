import { distanceTransform } from './morphology';
import type { Labels } from './label';

/**
 * Splits touching particles: a marker-based watershed on the distance transform.
 *
 * Every local maximum of the distance transform (the centre of a blob) starts a basin. Pixels are
 * taken in order of decreasing distance and join the basin of a neighbour that is already
 * labelled, so each basin grows outwards from its centre until it meets another one. Where two
 * basins meet, the distance value is the width of the neck between them (its half-width, in
 * pixels). Basins are then merged again when the neck is not clearly narrower than the blobs: two
 * basins are joined when the neck's half-width is at least `neckFraction` times the smaller of
 * their two centre distances (the radius of the smaller blob). Largest necks are examined first
 * and merged basins keep the larger centre distance.
 *
 * A neckFraction near 1 splits only the thinnest contacts, near 0.3 splits even wide ones.
 * Returns one label per pixel (0 for background) and the number of particles.
 */
export function splitTouching(
  mask: Uint8Array,
  width: number,
  height: number,
  neckFraction: number,
): Labels {
  const dist = distanceTransform(mask, width, height);
  const n = width * height;

  // Counting sort of foreground pixels by decreasing distance (resolution 1/16 pixel).
  let maxKey = 0;
  let foreground = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    foreground++;
    maxKey = Math.max(maxKey, Math.round((dist[i] as number) * 16));
  }
  const counts = new Int32Array(maxKey + 2);
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      const key = maxKey - Math.round((dist[i] as number) * 16);
      counts[key + 1] = (counts[key + 1] as number) + 1;
    }
  }
  for (let k = 1; k < counts.length; k++)
    counts[k] = (counts[k] as number) + (counts[k - 1] as number);
  const order = new Int32Array(foreground);
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      const key = maxKey - Math.round((dist[i] as number) * 16);
      order[counts[key] as number] = i;
      counts[key] = (counts[key] as number) + 1;
    }
  }

  const basin = new Int32Array(n);
  const peaks: number[] = [0]; // peaks[label] = centre distance of the basin
  const necks = new Map<number, number>(); // pair key -> widest neck half-width
  const pairKey = (a: number, b: number) => (a < b ? a * 4_000_003 + b : b * 4_000_003 + a);
  for (const i of order) {
    const x = i % width;
    const y = (i - x) / width;
    let own = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
        const other = basin[yy * width + xx] as number;
        if (!other) continue;
        if (!own) own = other;
        else if (other !== own) {
          const key = pairKey(own, other);
          necks.set(key, Math.max(necks.get(key) ?? 0, dist[i] as number));
        }
      }
    }
    if (!own) {
      own = peaks.length;
      peaks.push(dist[i] as number);
    }
    basin[i] = own;
  }

  // Merge basins whose neck is wide compared with the smaller blob.
  const parent = peaks.map((_, k) => k);
  const peak = [...peaks];
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[a] !== r) {
      const next = parent[a] as number;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const edges = [...necks.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, neck] of edges) {
    const a = find(Math.floor(key / 4_000_003));
    const b = find(key % 4_000_003);
    if (a === b) continue;
    if (neck >= neckFraction * Math.min(peak[a] as number, peak[b] as number)) {
      parent[b] = a;
      peak[a] = Math.max(peak[a] as number, peak[b] as number);
    }
  }

  const final = new Map<number, number>();
  const labels = new Int32Array(n);
  for (const i of order) {
    const root = find(basin[i] as number);
    let id = final.get(root);
    if (id === undefined) {
      id = final.size + 1;
      final.set(root, id);
    }
    labels[i] = id;
  }
  return { labels, count: final.size };
}
